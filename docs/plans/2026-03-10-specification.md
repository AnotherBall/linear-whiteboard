# Linear Whiteboard - Specification

## 1. Overview

### Concept

A "standup whiteboard" view for daily scrum. Provides a physical kanban-like matrix view as a Chrome extension, overlaid on the Linear app.

- **Vertical axis** = Issues (parent tasks, typically Epics)
- **Horizontal axis** = Workflow statuses (team's workflow states)
- Each cell displays **sub-issues and grandchildren** as **sticky-note cards**
- Prioritizes overview and visibility at a glance

### Target Users

Team members who review Linear task status during daily standup meetings.

---

## 2. Display Scope

### Vertical Axis (Rows)

- Issues from a Linear Custom View (fetched via Custom View API)
- Filtered by selected **Cycle** (cycle selector in toolbar)
- All matching rows are shown (including those with no sub-issues in visible lanes)

### Horizontal Axis (Columns)

- Team's workflow states fetched from Linear API
- Sorted by workflow type order: `unstarted` → `started` → `completed`, then by `position` within each type
- **Hidden states**: `triage`, `backlog`, `canceled` types and names matching `Icebox`, `Canceled`, `Duplicated`, `Duplicate`, `Triage`, `Epic Backlog`, `Epic` (case-insensitive)

### Cell Contents

- Sub-issues (children) and **grandchildren** (children of children) of each row issue
- Placed in the cell matching their current workflow state

---

## 3. Architecture

### Injection Method

**Content script + iframe overlay** approach.

- A content script (`inject-button.ts`) injects a "Whiteboard" button into Linear's view header
- Clicking the button opens the whiteboard as a **full-screen iframe** overlay on top of Linear
- The iframe loads `whiteboard.html` with the current view URL as a query parameter
- Close via: close button (✕), ESC key, or `postMessage("linear-whiteboard-close")`

Why iframe overlay (not a new tab):
- Stays in context of the Linear page
- Can detect and react to Linear SPA navigation via MutationObserver
- Quick open/close without tab switching

### Tech Stack

| Item | Selection |
| --- | --- |
| Extension format | Chrome Extension (Manifest V3) |
| Language | TypeScript |
| Build | Vite + @crxjs/vite-plugin |
| Framework | None (vanilla TS DOM manipulation) |
| CSS | Plain CSS (CSS Grid layout) |
| API | Linear GraphQL API (`https://api.linear.app/graphql`) |
| Auth | Linear Personal API Key |
| Storage | `chrome.storage.sync` |

### File Structure

```
linear-whiteboard/
├── src/
│   ├── content/
│   │   └── inject-button.ts     # Content script: injects Whiteboard button into Linear UI
│   ├── popup/
│   │   ├── popup.html           # Popup UI (extension icon click)
│   │   ├── popup.ts             # "Open Whiteboard" / "Settings" buttons
│   │   └── popup.css
│   ├── whiteboard/
│   │   ├── whiteboard.html      # Main whiteboard page (loaded in iframe)
│   │   ├── whiteboard.ts        # Matrix view rendering, drag-and-drop, cycle filter, zoom
│   │   └── whiteboard.css       # Sticky-note cards, grid layout, toolbar styles
│   ├── settings/
│   │   ├── settings.html        # API Key config, team selection, color labels
│   │   ├── settings.ts
│   │   └── settings.css
│   └── lib/
│       ├── linear-api.ts        # Linear GraphQL API client (paginated)
│       ├── storage.ts           # chrome.storage wrapper + view ID extraction
│       └── types.ts             # TypeScript type definitions
├── public/
│   └── icons/                   # Extension icons (16, 48, 128px)
├── dist/                        # Build output (gitignored)
├── docs/
│   └── plans/
├── manifest.json                # Manifest V3
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .gitignore
```

### manifest.json

```json
{
  "manifest_version": 3,
  "name": "Linear Whiteboard",
  "version": "0.1.0",
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["https://api.linear.app/*"],
  "action": {
    "default_popup": "src/popup/popup.html"
  },
  "content_scripts": [
    {
      "matches": ["https://linear.app/*"],
      "js": ["src/content/inject-button.ts"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/whiteboard/whiteboard.html", "assets/*"],
      "matches": ["https://linear.app/*"]
    }
  ]
}
```

Key points:
- `content_scripts` injects the button into Linear pages
- `web_accessible_resources` allows the iframe to load whiteboard.html from within Linear's origin
- No background service worker needed

---

## 4. Data Design

### Authentication

- Linear Personal API Key
- Sent via `Authorization: <api-key>` header (no Bearer prefix)
- Stored in `chrome.storage.sync`

### GraphQL Queries

#### Teams (settings)

```graphql
query Teams {
  teams { nodes { id, name } }
}
```

#### Workflow States (columns)

```graphql
query WorkflowStates($teamId: String!) {
  team(id: $teamId) {
    states { nodes { id, name, type, position, color } }
  }
}
```

#### Cycles (cycle selector)

```graphql
query TeamCycles($teamId: String!) {
  team(id: $teamId) {
    cycles(first: 20) {
      nodes { id, name, number, startsAt, endsAt }
    }
  }
}
```

Sorted client-side by `startsAt` descending (most recent first).

#### Custom View Issues (main data, fully paginated)

```graphql
query BoardData($viewId: String!, $first: Int!, $after: String) {
  customView(id: $viewId) {
    id, name
    viewPreferencesValues { issueGrouping }
    issues(first: $first, after: $after) {
      pageInfo { hasNextPage, endCursor }
      nodes {
        id, identifier, title, priority, sortOrder
        state { id, name, type, color }
        cycle { id, name, number, startsAt, endsAt }
        project { id, name }
        assignee { id, name, avatarUrl }
        labels { nodes { id, name, color } }
        children(first: 100) {
          pageInfo { hasNextPage, endCursor }
          nodes {
            id, identifier, title, priority, createdAt
            history(first: 20) { nodes { createdAt, toState { id } } }
            assignee { id, name, avatarUrl }
            state { id, name, type, color }
            labels { nodes { id, name, color } }
            children(first: 100) {
              # Grandchildren with same fields (recursive 1 level)
            }
          }
        }
      }
    }
  }
}
```

- **Full pagination**: Issues and children are paginated with cursor-based pagination (`PAGE_SIZE = 100`)
- Children with more pages trigger additional `MoreChildren` queries
- Issues sorted by `sortOrder` ascending (matching Linear UI order)

#### Update Issue State (drag-and-drop mutation)

```graphql
mutation UpdateIssueState($issueId: String!, $stateId: String!) {
  issueUpdate(id: $issueId, input: { stateId: $stateId }) { success }
}
```

### Data Transformation

API response → Board matrix:

```typescript
interface BoardData {
  columns: BoardColumn[];  // Filtered workflow states
  rows: BoardRow[];        // Issues with cells
}

interface BoardRow {
  issue: BoardRowIssue;
  cells: Record<string, SubIssue[]>;  // stateId → sub-issues in that state
}
```

- Each issue's `children` and `grandchildren` are distributed into cells by their `state.id`
- All rows are shown regardless of whether they have sub-issues in visible lanes

---

## 5. UI Design

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Team]  ViewName  [⟳ Cycle]    Linear Whiteboard    [Aa] [↻] [⚙] [✕] │
├──────────────────────────────────────────────────────────────────────┤
│ [←]  Group Name                               1 / 3           [→]  │  ← Pager (grouping only)
├───────────┬──────────┬──────────┬──────────┬──────────┬─────────────┤
│           │ ● Todo   │ ◐ In Prog│ ◐ Review │ ◐ QA    │ ✓ Done      │  ← Status icons
├───────────┼──────────┼──────────┼──────────┼──────────┼─────────────┤
│ ● Issue A │ ┌──┐┌──┐ │          │ ┌──┐     │          │ ┌──┐        │
│   Project │ │  ││  │ │          │ │  │     │          │ │  │        │
│   👤      │ └──┘└──┘ │          │ └──┘     │          │ └──┘        │
├───────────┼──────────┼──────────┼──────────┼──────────┼─────────────┤
│ ● Issue B │          │ ┌──┐┌──┐ │          │ ┌──┐     │             │
│   Project │          │ │  ││  │ │          │ │  │     │             │
│   👤      │          │ └──┘└──┘ │          │ └──┘     │             │
└───────────┴──────────┴──────────┴──────────┴──────────┴─────────────┘
```

### Theme

- **Linear dark theme**: Background `#191A1F`, Surface `#1F2023`, Border `#2E2F33`
- Text: Primary `#E2E2E3`, Secondary `#8B8C90`
- Accent: `#5E6AD2` (Linear brand color)

### CSS Approach

- **CSS Grid** for matrix layout (`grid-auto-rows: min-content` for compact rows)
- Header row: `position: sticky; top: 0` (fixed at top)
- Left column (issue names): `position: sticky; left: 0` (fixed at left)
- Corner cell: `z-index: 20` (above both sticky axes)
- CSS `zoom` property for text/card scaling with CSS custom properties

### Toolbar

| Element | Description |
| --- | --- |
| Team badge | Team name in accent-colored badge |
| View name | Custom View name |
| Cycle selector | Custom dropdown (button + panel) to filter by cycle |
| Title | "Linear Whiteboard" centered |
| Zoom control (Aa) | Dropdown with Text and Card size sliders (50%–150%) |
| Refresh (↻) | Manual data refresh |
| Settings (⚙) | Opens settings page |
| Close (✕) | Closes whiteboard (sends postMessage to parent) |

### Cycle Selector

- Custom dropdown panel (not native `<select>`, to avoid rendering issues in extension iframes)
- Lists up to 20 most recent cycles with date ranges
- Auto-selects the currently active cycle on first load (based on today's date)
- Switching cycles re-filters and re-renders without re-fetching API data (cached)
- Closes when clicking outside

### Zoom Control

- Two independent sliders: Text size and Card size
- Default display: 100% (actual base scaling: text=130%, card=80%, via CSS custom properties `--text-base` and `--card-base`)
- Sliders control `--text-scale` and `--card-scale` multipliers
- Board zoom: `zoom: calc(var(--text-base) * var(--text-scale))`
- Card size: `calc(64px * var(--card-base) * var(--card-scale))`
- Reset button returns to 100%

### Grouping + Pager

- If Custom View has `issueGrouping` set (e.g., by cycle, project, assignee, label, priority, status), issues are grouped accordingly
- Pager bar appears below toolbar: `[←] GroupName  1/3  [→]`
- Navigate between groups with prev/next buttons

### Status Icons

Linear-style SVG workflow state icons displayed in header cells and row labels:

| Type | Icon | Description |
| --- | --- | --- |
| `backlog` | Dotted circle | Dashed outline (`stroke-dasharray: 1.4 1.74`) |
| `unstarted` | Empty circle | Solid outline only |
| `started` | Partially filled circle | Progress varies by position among started states |
| `completed` | Filled circle + checkmark | Full fill with white checkmark path |
| `canceled` | Filled circle + X | Full fill with white X path |
| `triage` | Filled circle + arrows | Full fill with triage arrows icon |

For `started` states, the progress fill is computed based on position:
- `progress = (position + 1) / (totalStartedStates + 1)`
- e.g., 4 started states → 20%, 40%, 60%, 80% fill

### Row Labels

Each row shows:
- Status icon (matching the issue's workflow state)
- Issue title (clickable link to Linear)
- Project name (if set)
- Assignee avatar or initial circle

### Sticky Note Cards

```
┌────────┐ 👤  ← Assignee avatar (overlapping top-right, 16px circle)
│ Title  │      ← with elapsed-days ring when applicable
│ (clip) │
└────────┘
 ▲ left border = priority color
```

- **Size**: `var(--card-size)` = `calc(64px * var(--card-base) * var(--card-scale))`
- Title only (overflow hidden)
- **Background color**: First matching color label's color at 16% opacity
- **Left border** (3px): Priority color
  - Urgent: `#E5534B`, High: `#E09B13`, Medium: `#E5C242`, Low: `#5E6AD2`, None: `#4B4C52`
- **Assignee avatar**: 16px circle overlapping top-right corner
- **Elapsed-days ring** (around avatar): For `started` states only, shows conic-gradient ring with 5 segments indicating days in current state (see below)
- **Tooltip on hover**: Shows identifier, full title, assignee, status, priority, days in state, and labels
  - Tooltip rendered as `position: fixed` element appended to `document.body` (avoids `overflow: hidden` clipping)
  - Positioned below card for first row or when near top, above card otherwise

### Elapsed Days Indicator

Visualizes how long a sub-issue has been in its current state. Displayed as a **conic-gradient ring** around the assignee avatar.

- Only shown for `started` state types (not `unstarted` or `completed`)
- Ring has **5 segments** (72° each, with 4° gap)
- Segments fill based on days in current state (1 day = 1 segment, max 5)
- Color progresses with segment count:
  - 1 day: `#4ade80` (green)
  - 2 days: `#a3e635` (lime)
  - 3 days: `#facc15` (yellow)
  - 4 days: `#fb923c` (orange)
  - 5+ days: `#ef4444` (red)
- Unfilled segments shown in `#3B3C42` (dark gray)
- Days calculated from Linear issue `history` (finds the most recent state transition to current state), falls back to `createdAt`

### Cell Collapse

- Cells with many cards show first 2 rows collapsed (with fade mask)
- "Show all (N)" button expands, "Show less" collapses
- If content doesn't overflow 2 rows, collapse is removed automatically (checked via `requestAnimationFrame`)

### Drag and Drop

- Cards can be dragged between cells to change their workflow state
- **Same-row constraint**: Cards can only be moved within the same issue row (horizontal movement only)
  - Implemented via `data-drag-row` attribute on the board during drag
  - Cross-row drops are rejected (different issue hierarchy, not a valid state change)
- On drop: card element moved immediately, then `issueUpdate` mutation called
- On API error: full board reload to restore correct state
- Visual feedback: drop target highlighted with dashed purple outline, dragged card at 40% opacity

### Content Script (inject-button.ts)

- Injects a "📋 Whiteboard" button into Linear's view header
- Targets the container near the "Issue view options" (•••) menu button
- Uses `MutationObserver` to re-inject on SPA navigation
- Button toggles the whiteboard iframe overlay on/off
- Handles extension context invalidation (e.g., after extension reload): disconnects observer and removes injected elements
- After iframe close, re-injects button via `setTimeout` to handle SPA re-renders

### Keyboard Shortcuts

| Key | Action |
| --- | --- |
| Escape | Close whiteboard (both in iframe and parent page) |

---

## 6. Settings Page

### API Key Section
- Password input with show/hide toggle
- "Verify & Save" button: calls `fetchTeams()` to validate the key
- Success/error status messages

### Team Selection
- Dropdown populated after API key verification
- Saved to `chrome.storage.sync`

### Color Labels
- Comma-separated label names
- Cards matching these labels get tinted backgrounds
- Default labels: Server, Gurren, Gurren Lagann, Lagann, Android, Design, iOS, KMM, Unity

### Usage Section
- Brief instructions shown after team is selected

---

## 7. Auto-Refresh

- Board data refreshes every **5 minutes** automatically
- Refresh skipped if cycle panel or zoom panel is open (to avoid disrupting user interaction)
- Manual refresh available via toolbar button

---

## 8. Constraints & Considerations

| Item | Approach |
| --- | --- |
| Pagination | Full cursor-based pagination (100 items per page) for issues and children |
| API Rate Limit | Linear API: 1500 req/hr. 5-min auto-refresh is well within limits |
| Security | API Key stored in `chrome.storage.sync` (plaintext, relies on browser storage encryption) |
| Dark Mode | Linear dark theme only (no light mode) |
| Drag & Drop | Supported for state changes within same row. Cross-row moves blocked |
| Issue Click | Opens Linear issue page in new tab |
| SPA Navigation | MutationObserver detects route changes, re-injects/removes button as needed |
| Extension Reload | Content script detects invalidated context and cleans up |
