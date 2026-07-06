import { getApiKey, extractViewId, getColorLabels } from "../lib/storage";
import { fetchWorkflowStates, fetchCustomViewFirstPage, fetchCustomViewRemaining, fetchTeamCycles, fetchIssueRelations, updateIssueState } from "../lib/linear-api";
import type { WorkflowState, Issue, SubIssue, BoardData, IssueGroup, Assignee, Project, Cycle, RelatedIssueRef } from "../lib/types";

// Color label whitelist (loaded from storage)
let colorLabelSet: Set<string> = new Set();

// Cached API key for mutations (set during loadBoard)
let cachedApiKey: string | null = null;

// Read viewUrl from query parameter
const params = new URLSearchParams(window.location.search);
const viewUrl = params.get("viewUrl");

// State types to hide from the board (Linear built-in types)
const HIDDEN_STATE_TYPES = new Set(["triage", "backlog", "canceled"]);
// State names to hide (case-insensitive match)
const HIDDEN_STATE_NAMES = new Set([
  "icebox", "canceled", "duplicated", "duplicate", "triage",
  "epic backlog", "epic",
]);

const loadingEl = document.getElementById("loading") as HTMLElement;
const errorEl = document.getElementById("error") as HTMLElement;
const errorTextEl = document.getElementById("error-text") as HTMLElement;
const emptyEl = document.getElementById("empty") as HTMLElement;
const boardEl = document.getElementById("board") as HTMLElement;
const viewNameEl = document.getElementById("view-name") as HTMLElement;
const refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const errorSettingsBtn = document.getElementById("error-settings-btn") as HTMLButtonElement;
const cycleBtnEl = document.getElementById("cycle-btn") as HTMLButtonElement;
const cyclePanelEl = document.getElementById("cycle-panel") as HTMLElement;
const assigneeBtnEl = document.getElementById("assignee-btn") as HTMLButtonElement;
const assigneePanelEl = document.getElementById("assignee-panel") as HTMLElement;
const assigneeNavEl = document.getElementById("assignee-nav") as HTMLElement;
const assigneePrevBtn = document.getElementById("assignee-prev") as HTMLButtonElement;
const assigneeNextBtn = document.getElementById("assignee-next") as HTMLButtonElement;
const assigneeNavInfoEl = document.getElementById("assignee-nav-info") as HTMLElement;
const pagerEl = document.getElementById("pager") as HTMLElement;
const pagerPrevBtn = document.getElementById("pager-prev") as HTMLButtonElement;
const pagerNextBtn = document.getElementById("pager-next") as HTMLButtonElement;
const pagerLabelEl = document.getElementById("pager-label") as HTMLElement;
const pagerInfoEl = document.getElementById("pager-info") as HTMLElement;

function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/settings/settings.html") });
}

settingsBtn.addEventListener("click", openSettings);
errorSettingsBtn.addEventListener("click", openSettings);
refreshBtn.addEventListener("click", () => loadBoard());
closeBtn.addEventListener("click", () => {
  window.parent.postMessage("linear-whiteboard-close", "*");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    window.parent.postMessage("linear-whiteboard-close", "*");
  }
});

// -- Zoom controls --

const zoomBtn = document.getElementById("zoom-btn") as HTMLButtonElement;
const zoomPanel = document.getElementById("zoom-panel") as HTMLElement;
const zoomTextSlider = document.getElementById("zoom-text") as HTMLInputElement;
const zoomCardSlider = document.getElementById("zoom-card") as HTMLInputElement;
const zoomTextVal = document.getElementById("zoom-text-val") as HTMLElement;
const zoomCardVal = document.getElementById("zoom-card-val") as HTMLElement;
const zoomResetBtn = document.getElementById("zoom-reset") as HTMLButtonElement;

zoomBtn.addEventListener("click", () => {
  zoomPanel.hidden = !zoomPanel.hidden;
});

// Close panels when clicking outside
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!zoomPanel.hidden && !target.closest(".zoom-control")) {
    zoomPanel.hidden = true;
  }
  if (!cyclePanelEl.hidden && !target.closest(".cycle-control")) {
    cyclePanelEl.hidden = true;
  }
  if (!assigneePanelEl.hidden && !target.closest(".assignee-control")) {
    assigneePanelEl.hidden = true;
  }
});

function applyZoom() {
  const textScale = Number(zoomTextSlider.value) / 100;
  const cardScale = Number(zoomCardSlider.value) / 100;
  document.documentElement.style.setProperty("--text-scale", String(textScale));
  document.documentElement.style.setProperty("--card-scale", String(cardScale));
  zoomTextVal.textContent = `${zoomTextSlider.value}%`;
  zoomCardVal.textContent = `${zoomCardSlider.value}%`;
}

zoomTextSlider.addEventListener("input", applyZoom);
zoomCardSlider.addEventListener("input", applyZoom);

zoomResetBtn.addEventListener("click", () => {
  zoomTextSlider.value = "100";
  zoomCardSlider.value = "100";
  applyZoom();
});

// -- Cycle filter --

function filterByCycle(issues: Issue[], cycleId: string | null): Issue[] {
  if (!cycleId) return issues;
  return issues.filter((issue) => issue.cycle?.id === cycleId);
}

function detectActiveCycleId(cycles: Cycle[]): string | null {
  if (cycles.length === 0) return null;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // Pick the most recent cycle that has already started
  const active = cycles.find((c) => c.startsAt.slice(0, 10) <= today && c.endsAt.slice(0, 10) >= today);
  return active?.id ?? cycles[0].id;
}

let allCycles: Cycle[] = [];

function populateCycleSelect(cycles: Cycle[], activeCycleId: string | null) {
  allCycles = cycles;
  updateCycleBtnLabel();
  buildCyclePanel();
}

function updateCycleBtnLabel() {
  const active = allCycles.find((c) => c.id === selectedCycleId);
  if (active) {
    const label = active.name ?? `Cycle ${active.number}`;
    cycleBtnEl.textContent = `⟳ ${label}`;
    cycleBtnEl.title = `${label} (${active.startsAt.slice(0, 10)} ~ ${active.endsAt.slice(0, 10)})`;
  } else {
    cycleBtnEl.textContent = "⟳ Cycle";
  }
}

function buildCyclePanel() {
  cyclePanelEl.innerHTML = "";
  for (const cycle of allCycles) {
    const btn = document.createElement("button");
    btn.className = "cycle-option" + (cycle.id === selectedCycleId ? " active" : "");
    const label = cycle.name ?? `Cycle ${cycle.number}`;
    const start = cycle.startsAt.slice(0, 10);
    const end = cycle.endsAt.slice(0, 10);
    btn.textContent = `${label} (${start} ~ ${end})`;
    btn.addEventListener("click", () => {
      selectedCycleId = cycle.id;
      cyclePanelEl.hidden = true;
      updateCycleBtnLabel();
      buildCyclePanel();
      applyFilterAndRender();
    });
    cyclePanelEl.appendChild(btn);
  }
}

cycleBtnEl.addEventListener("click", () => {
  cyclePanelEl.hidden = !cyclePanelEl.hidden;
});

// -- Assignee highlight --

let selectedAssigneeId: string | null = null;

function collectAssignees(issues: Issue[]): Assignee[] {
  const map = new Map<string, Assignee>();
  for (const issue of issues) {
    for (const child of issue.children.nodes) {
      if (child.assignee && !map.has(child.assignee.id)) {
        map.set(child.assignee.id, child.assignee);
      }
      if (child.children?.nodes) {
        for (const gc of child.children.nodes) {
          if (gc.assignee && !map.has(gc.assignee.id)) {
            map.set(gc.assignee.id, gc.assignee);
          }
        }
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function updateAssigneeBtnLabel() {
  if (!selectedAssigneeId) {
    assigneeBtnEl.textContent = "👤 All";
  } else {
    const allAssignees = collectAssignees(cachedAllIssues);
    const assignee = allAssignees.find((a) => a.id === selectedAssigneeId);
    assigneeBtnEl.textContent = assignee ? `👤 ${assignee.name}` : "👤 All";
  }
}

function buildAssigneePanel() {
  const filteredIssues = filterByCycle(cachedAllIssues, selectedCycleId);
  const assignees = collectAssignees(filteredIssues);
  assigneePanelEl.innerHTML = "";

  // "All" option
  const allBtn = document.createElement("button");
  allBtn.className = "assignee-option" + (selectedAssigneeId === null ? " active" : "");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => {
    selectedAssigneeId = null;
    assigneePanelEl.hidden = true;
    updateAssigneeBtnLabel();
    applyAssigneeHighlight();
    buildAssigneePanel();
  });
  assigneePanelEl.appendChild(allBtn);

  for (const assignee of assignees) {
    const btn = document.createElement("button");
    btn.className = "assignee-option" + (assignee.id === selectedAssigneeId ? " active" : "");

    let avatarHtml = "";
    if (assignee.avatarUrl) {
      avatarHtml = `<img class="assignee-option-avatar" src="${assignee.avatarUrl}" alt="">`;
    } else {
      const initial = assignee.name.charAt(0).toUpperCase();
      avatarHtml = `<div class="assignee-option-initial">${initial}</div>`;
    }
    btn.innerHTML = `${avatarHtml}<span>${escapeHtml(assignee.name)}</span>`;

    btn.addEventListener("click", () => {
      selectedAssigneeId = assignee.id;
      assigneePanelEl.hidden = true;
      updateAssigneeBtnLabel();
      applyAssigneeHighlight();
      buildAssigneePanel();
    });
    assigneePanelEl.appendChild(btn);
  }
}

// -- Assignee card navigation --

let assigneeNavIndex = -1;

function applyAssigneeHighlight() {
  if (!selectedAssigneeId) {
    boardEl.classList.remove("assignee-highlight");
    boardEl.querySelectorAll(".card-highlighted").forEach((el) => el.classList.remove("card-highlighted"));
    assigneeNavEl.hidden = true;
    assigneeNavIndex = -1;
    return;
  }

  boardEl.classList.add("assignee-highlight");
  boardEl.querySelectorAll(".card").forEach((cardEl) => {
    const assigneeId = (cardEl as HTMLElement).dataset.assigneeId;
    if (assigneeId === selectedAssigneeId) {
      cardEl.classList.add("card-highlighted");
    } else {
      cardEl.classList.remove("card-highlighted");
    }
  });

  // Show navigation if there are matching cards
  const cards = getHighlightedCards();
  if (cards.length > 0) {
    assigneeNavEl.hidden = false;
    assigneeNavIndex = 0;
    focusAssigneeCard();
  } else {
    assigneeNavEl.hidden = true;
    assigneeNavIndex = -1;
  }
}

function getHighlightedCards(): HTMLElement[] {
  return Array.from(boardEl.querySelectorAll<HTMLElement>(".card-highlighted"));
}

function focusAssigneeCard() {
  const cards = getHighlightedCards();
  if (cards.length === 0) return;

  // Remove previous focus
  boardEl.querySelectorAll(".card-focused").forEach((el) => el.classList.remove("card-focused"));

  const card = cards[assigneeNavIndex];

  // Expand collapsed wrapper if the card is hidden
  const wrapper = card.closest(".cell-card-wrapper");
  if (wrapper?.classList.contains("collapsed")) {
    wrapper.classList.remove("collapsed");
    const toggleBtn = wrapper.parentElement?.querySelector(".cell-toggle-btn") as HTMLButtonElement | null;
    if (toggleBtn) {
      toggleBtn.textContent = "Show less";
    }
  }

  card.classList.add("card-focused");
  card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });

  updateAssigneeNavInfo(cards.length);
}

function updateAssigneeNavInfo(total: number) {
  assigneeNavInfoEl.textContent = `${assigneeNavIndex + 1} / ${total}`;
}

assigneePrevBtn.addEventListener("click", () => {
  const cards = getHighlightedCards();
  if (cards.length === 0) return;
  assigneeNavIndex = (assigneeNavIndex - 1 + cards.length) % cards.length;
  focusAssigneeCard();
});

assigneeNextBtn.addEventListener("click", () => {
  const cards = getHighlightedCards();
  if (cards.length === 0) return;
  assigneeNavIndex = (assigneeNavIndex + 1) % cards.length;
  focusAssigneeCard();
});

assigneeBtnEl.addEventListener("click", () => {
  assigneePanelEl.hidden = !assigneePanelEl.hidden;
});

function applyFilterAndRender() {
  const filteredIssues = filterByCycle(cachedAllIssues, selectedCycleId);
  if (filteredIssues.length === 0) {
    showView("empty");
    return;
  }
  currentGroups = groupIssues(filteredIssues, cachedGrouping);
  currentGroupIndex = 0;
  renderCurrentGroup();
  buildAssigneePanel();
  applyAssigneeHighlight();
}

// -- Grouping --

function groupIssues(issues: Issue[], grouping: string | null): IssueGroup[] {
  if (!grouping || grouping === "noGrouping") {
    return [{ label: "", issues }];
  }

  const groups = new Map<string, IssueGroup>();
  const ungrouped: Issue[] = [];

  for (const issue of issues) {
    const { key, label } = getGroupKey(issue, grouping);
    if (key) {
      if (!groups.has(key)) {
        groups.set(key, { label, issues: [] });
      }
      groups.get(key)!.issues.push(issue);
    } else {
      ungrouped.push(issue);
    }
  }

  const result: IssueGroup[] = [...groups.values()];
  if (ungrouped.length > 0) {
    result.push({ label: `No ${groupingDisplayName(grouping)}`, issues: ungrouped });
  }

  return result;
}

function getGroupKey(issue: Issue, grouping: string): { key: string | null; label: string } {
  switch (grouping) {
    case "cycle":
      if (issue.cycle) {
        return { key: issue.cycle.id, label: issue.cycle.name ?? `Cycle #${issue.cycle.number}` };
      }
      return { key: null, label: "" };
    case "project":
      if (issue.project) {
        return { key: issue.project.id, label: issue.project.name };
      }
      return { key: null, label: "" };
    case "assignee":
      if (issue.assignee) {
        return { key: issue.assignee.id, label: issue.assignee.name };
      }
      return { key: null, label: "" };
    case "label":
      if (issue.labels.nodes.length > 0) {
        const first = issue.labels.nodes[0];
        return { key: first.id, label: first.name };
      }
      return { key: null, label: "" };
    case "priority":
      return { key: String(issue.priority), label: priorityLabel(issue.priority) };
    case "status":
      return { key: issue.state.id, label: issue.state.name };
    default:
      return { key: null, label: "" };
  }
}

function groupingDisplayName(grouping: string): string {
  switch (grouping) {
    case "cycle": return "Cycle";
    case "project": return "Project";
    case "assignee": return "Assignee";
    case "label": return "Label";
    case "priority": return "Priority";
    case "status": return "Status";
    default: return "Group";
  }
}

// -- Pager state --

let currentGroups: IssueGroup[] = [];
let currentGroupIndex = 0;
let currentStates: WorkflowState[] = [];
let cachedAllIssues: Issue[] = [];
let cachedGrouping: string | null = null;
let selectedCycleId: string | null = null;

function updatePager() {
  if (currentGroups.length <= 1) {
    pagerEl.hidden = true;
    return;
  }
  pagerEl.hidden = false;
  pagerLabelEl.textContent = currentGroups[currentGroupIndex].label;
  pagerInfoEl.textContent = `${currentGroupIndex + 1} / ${currentGroups.length}`;
  pagerPrevBtn.disabled = currentGroupIndex === 0;
  pagerNextBtn.disabled = currentGroupIndex === currentGroups.length - 1;
}

pagerPrevBtn.addEventListener("click", () => {
  if (currentGroupIndex > 0) {
    currentGroupIndex--;
    renderCurrentGroup();
  }
});

pagerNextBtn.addEventListener("click", () => {
  if (currentGroupIndex < currentGroups.length - 1) {
    currentGroupIndex++;
    renderCurrentGroup();
  }
});

function renderCurrentGroup() {
  updatePager();
  const group = currentGroups[currentGroupIndex];
  const boardData = buildBoardData(currentStates, group.issues, selectedCycleId);
  renderBoard(boardData);
  showView("board");
}

// Generate Linear-style workflow state SVG icon
// progress: 0-1, only used for "started" type to control fill amount
function statusIconSvg(type: string, color: string, progress = 0.5): string {
  const size = 14;
  const cx = 7, cy = 7, r = 6;
  const sw = "1.5";

  // Progress circle constants (r=2, stroke-width=4)
  const progDasharray = 11.309733552923255;
  const progDasharrayFull = progDasharray * 2;

  switch (type) {
    case "backlog":
      // Dotted circle
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" class="status-icon"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="1.4 1.74" stroke-dashoffset="0.65"/></svg>`;
    case "unstarted":
      // Solid outline circle
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" class="status-icon"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="3.14 0" stroke-dashoffset="-0.7"/></svg>`;
    case "started": {
      // Circle with progress fill (varies by position among started states)
      const offset = progDasharray * (1 - progress);
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" class="status-icon"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="3.14 0" stroke-dashoffset="-0.7"/><circle cx="${cx}" cy="${cy}" r="2" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="${progDasharray} ${progDasharrayFull}" stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})"/></svg>`;
    }
    case "completed":
      // Filled circle with checkmark
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" class="status-icon"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="3.14 0" stroke-dashoffset="-0.7"/><circle cx="${cx}" cy="${cy}" r="3" fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="18.85 37.7" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})"/><path stroke="none" fill="#fff" d="M10.951 4.249a.85.85 0 010 1.202l-5 5a.85.85 0 01-1.202 0l-2-2a.85.85 0 111.202-1.202L5.35 8.648l4.399-4.399a.85.85 0 011.202 0z"/></svg>`;
    case "canceled":
      // Filled circle with X
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" class="status-icon"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="3.14 0" stroke-dashoffset="-0.7"/><circle cx="${cx}" cy="${cy}" r="3" fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="18.85 37.7" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})"/><path stroke="none" fill="#fff" d="M3.737 3.737a.81.81 0 011.142 0L7 5.858l2.121-2.121a.81.81 0 111.142 1.142L8.142 7l2.121 2.121a.81.81 0 11-1.142 1.142L7 8.142l-2.121 2.121a.81.81 0 11-1.142-1.142L5.858 7 3.737 4.879a.81.81 0 010-1.142z"/></svg>`;
    case "triage":
      // Triage icon
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" class="status-icon"><circle cx="${cx}" cy="${cy}" r="3.5" fill="none" stroke="${color}" stroke-width="7" stroke-dasharray="2 0" stroke-dashoffset="3.2"/><path stroke="none" fill="#fff" d="M8.013 7.982V9.508c0 .421.51.647.838.37l2.975-2.507a.5.5 0 000-.742L8.851 4.121c-.328-.276-.838-.05-.838.371V6.018H5.987V4.492c0-.421-.51-.647-.838-.37L2.174 6.629a.5.5 0 000 .742l2.975 2.508c.328.276.838.05.838-.371V7.982h2.026z"/></svg>`;
    default:
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" class="status-icon"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#8B8C90" stroke-width="${sw}"/></svg>`;
  }
}

// Compute progress (0-1) for each started state based on position among all started states
function computeStartedProgress(columns: { type: string }[]): Map<number, number> {
  const progressMap = new Map<number, number>();
  const startedIndices: number[] = [];
  for (let i = 0; i < columns.length; i++) {
    if (columns[i].type === "started") {
      startedIndices.push(i);
    }
  }
  const total = startedIndices.length;
  for (let j = 0; j < startedIndices.length; j++) {
    progressMap.set(startedIndices[j], (j + 1) / (total + 1));
  }
  return progressMap;
}

// Filter workflow states
function filterStates(states: WorkflowState[]): WorkflowState[] {
  return states.filter((s) => {
    if (HIDDEN_STATE_TYPES.has(s.type)) return false;
    if (HIDDEN_STATE_NAMES.has(s.name.toLowerCase())) return false;
    return true;
  });
}

// Check if a sub-issue matches the selected cycle
function matchesCycle(sub: SubIssue, cycleId: string | null): boolean {
  if (!cycleId) return true;
  return sub.cycle?.id === cycleId;
}

// Sub-issues on the currently rendered board, looked up by delegated event handlers
let subIssueById = new Map<string, SubIssue>();

// Transform API data into board matrix
function buildBoardData(states: WorkflowState[], issues: Issue[], cycleId: string | null): BoardData {
  const filtered = filterStates(states);
  const columns = filtered.map((s) => ({ id: s.id, name: s.name, type: s.type, color: s.color }));

  subIssueById = new Map();
  const rows = issues.map((issue) => {
    const cells: Record<string, SubIssue[]> = {};
    for (const col of columns) {
      cells[col.id] = [];
    }
    // Collect children and grandchildren, filtered by cycle
    for (const child of issue.children.nodes) {
      if (matchesCycle(child, cycleId)) {
        const stateId = child.state.id;
        if (cells[stateId]) {
          cells[stateId].push(child);
          subIssueById.set(child.id, child);
        }
      }
      if (child.children?.nodes) {
        for (const grandchild of child.children.nodes) {
          if (matchesCycle(grandchild, cycleId)) {
            const gcStateId = grandchild.state.id;
            if (cells[gcStateId]) {
              cells[gcStateId].push(grandchild);
              subIssueById.set(grandchild.id, grandchild);
            }
          }
        }
      }
    }
    return {
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        state: issue.state,
        project: issue.project,
        assignee: issue.assignee,
      },
      cells,
    };
  });

  return { columns, rows };
}

// Render the board as a CSS Grid.
// The whole board is built as a single HTML string and inserted with one
// innerHTML assignment; all interactions (tooltip, drag & drop, toggle) are
// handled by delegated listeners on boardEl, so no per-card listeners exist.
function renderBoard(data: BoardData) {
  hideTooltip();

  const parts: string[] = [];

  // Header row
  parts.push(`<div class="board-header-cell corner"></div>`);
  const startedProgress = computeStartedProgress(data.columns);
  for (let colIdx = 0; colIdx < data.columns.length; colIdx++) {
    const col = data.columns[colIdx];
    const progress = startedProgress.get(colIdx) ?? 0.5;
    parts.push(`<div class="board-header-cell">${statusIconSvg(col.type, col.color, progress)} ${escapeHtml(col.name)}</div>`);
  }

  // Data rows
  for (let rowIdx = 0; rowIdx < data.rows.length; rowIdx++) {
    const row = data.rows[rowIdx];
    const issueUrl = `https://linear.app/issue/${row.issue.identifier}`;

    // Build row label: [status-icon] title on first line, metadata below
    const stateIcon = statusIconSvg(row.issue.state.type, row.issue.state.color);
    let labelHtml = `<div class="row-title-line">${stateIcon}<a href="${issueUrl}" target="_blank" title="${escapeHtml(row.issue.title)}">${escapeHtml(row.issue.title)}</a></div>`;
    labelHtml += `<div class="row-meta">`;
    if (row.issue.project) {
      labelHtml += `<span class="row-project">${escapeHtml(row.issue.project.name)}</span>`;
    }
    if (row.issue.assignee) {
      if (row.issue.assignee.avatarUrl) {
        labelHtml += `<img class="row-avatar" src="${escapeHtml(row.issue.assignee.avatarUrl)}" alt="${escapeHtml(row.issue.assignee.name)}" title="${escapeHtml(row.issue.assignee.name)}">`;
      } else {
        const initial = row.issue.assignee.name.charAt(0).toUpperCase();
        labelHtml += `<span class="row-avatar-initial" title="${escapeHtml(row.issue.assignee.name)}">${escapeHtml(initial)}</span>`;
      }
    }
    labelHtml += `</div>`;
    parts.push(`<div class="board-row-label">${labelHtml}</div>`);

    for (const col of data.columns) {
      const subissues = row.cells[col.id] ?? [];
      let cellInner = "";
      if (subissues.length > 0) {
        // Wrap cards in a container, CSS .collapsed limits to 2 rows
        let cardsHtml = "";
        for (const sub of subissues) {
          cardsHtml += cardHtml(sub);
        }
        // Toggle is hidden after render if the content doesn't overflow
        cellInner = `<div class="cell-card-wrapper collapsed">${cardsHtml}</div><button class="cell-toggle-btn" data-count="${subissues.length}">Show all (${subissues.length})</button>`;
      }
      parts.push(`<div class="board-cell" data-state-id="${escapeHtml(col.id)}" data-row-idx="${rowIdx}">${cellInner}</div>`);
    }
  }

  boardEl.style.gridTemplateColumns = `minmax(160px, 200px) repeat(${data.columns.length}, minmax(140px, 1fr))`;
  boardEl.innerHTML = parts.join("");

  scheduleOverflowCheck();
}

// -- Blocking relations (Linear "blocks" issue relations) --

// State types that resolve a blocking relation
const RESOLVED_STATE_TYPES = new Set(["completed", "canceled"]);

// Issues that block this card, ignoring already-resolved blockers
function blockedByOf(sub: SubIssue): RelatedIssueRef[] {
  const result: RelatedIssueRef[] = [];
  for (const rel of sub.inverseRelations?.nodes ?? []) {
    if (rel.type === "blocks" && rel.issue && !RESOLVED_STATE_TYPES.has(rel.issue.state.type)) {
      result.push(rel.issue);
    }
  }
  return result;
}

// Issues this card blocks; a resolved card no longer blocks anything
function blocksOf(sub: SubIssue): RelatedIssueRef[] {
  if (RESOLVED_STATE_TYPES.has(sub.state.type)) return [];
  const result: RelatedIssueRef[] = [];
  for (const rel of sub.relations?.nodes ?? []) {
    if (rel.type === "blocks" && rel.relatedIssue && !RESOLVED_STATE_TYPES.has(rel.relatedIssue.state.type)) {
      result.push(rel.relatedIssue);
    }
  }
  return result;
}

function cardHtml(sub: SubIssue): string {
  // Use first whitelisted label color as card background (25% tint)
  const colorLabel = sub.labels.nodes.find((l) => colorLabelSet.has(l.name));
  const styleAttr = colorLabel
    ? ` style="background-color:${escapeHtml(colorLabel.color)}40;border:1px solid ${escapeHtml(colorLabel.color)}4D"`
    : "";
  const assigneeAttr = sub.assignee ? ` data-assignee-id="${escapeHtml(sub.assignee.id)}"` : "";
  // Striped overlay while the card is blocked by unresolved issues
  const blockedClass = blockedByOf(sub).length > 0 ? " card-blocked" : "";

  // Title only
  let inner = `<div class="card-title">${escapeHtml(sub.title)}</div>`;

  // Avatar overlapping top-right (with elapsed-days ring for started states)
  if (sub.assignee) {
    const stateType = sub.state.type;
    let ringGradient: string | null = null;
    if (stateType !== "unstarted" && stateType !== "completed") {
      const days = daysInCurrentState(sub);
      ringGradient = elapsedRingGradient(days);
    }

    let avatarInner = "";
    if (sub.assignee.avatarUrl) {
      avatarInner = `<div class="card-avatar-wrapper"><img class="card-avatar" src="${escapeHtml(sub.assignee.avatarUrl)}" alt="${escapeHtml(sub.assignee.name)}"></div>`;
    } else {
      const initial = sub.assignee.name.charAt(0).toUpperCase();
      avatarInner = `<div class="card-avatar-wrapper"><div class="card-avatar-initial">${escapeHtml(initial)}</div></div>`;
    }

    if (ringGradient) {
      inner += `<div class="card-avatar-ring" style="background:${ringGradient}">${avatarInner}</div>`;
    } else {
      // No ring — render avatar wrapper in original position
      inner += avatarInner;
    }
  }

  return `<a class="card${blockedClass}" draggable="true" href="https://linear.app/issue/${escapeHtml(sub.identifier)}" target="_blank" data-priority="${sub.priority}" data-issue-id="${escapeHtml(sub.id)}"${assigneeAttr}${styleAttr}>${inner}</a>`;
}

// After render, expand wrappers whose content doesn't overflow and hide their
// toggle. All reads happen before all writes to avoid layout thrashing
// (the previous per-cell rAF callbacks interleaved reads and writes).
function scheduleOverflowCheck() {
  requestAnimationFrame(() => {
    const checks: { wrapper: HTMLElement; toggle: HTMLElement | null }[] = [];
    for (const cell of boardEl.querySelectorAll<HTMLElement>(".board-cell")) {
      const wrapper = cell.querySelector<HTMLElement>(".cell-card-wrapper");
      if (!wrapper || !wrapper.classList.contains("collapsed")) continue;
      checks.push({ wrapper, toggle: cell.querySelector<HTMLElement>(".cell-toggle-btn") });
    }
    // Read phase
    const fits = checks.map(({ wrapper }) => wrapper.scrollHeight <= wrapper.offsetHeight);
    // Write phase
    checks.forEach(({ wrapper, toggle }, i) => {
      if (fits[i]) {
        wrapper.classList.remove("collapsed");
        if (toggle) toggle.hidden = true;
      }
    });
  });
}

// -- Delegated board interactions --

// Show all / Show less toggle, and suppress navigation while dragging
boardEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const toggleBtn = target.closest<HTMLButtonElement>(".cell-toggle-btn");
  if (toggleBtn) {
    const wrapper = toggleBtn.parentElement?.querySelector(".cell-card-wrapper");
    if (wrapper) {
      const collapsed = wrapper.classList.toggle("collapsed");
      toggleBtn.textContent = collapsed ? `Show all (${toggleBtn.dataset.count})` : "Show less";
    }
    return;
  }
  // Prevent navigating to href when dropping
  const card = target.closest<HTMLElement>(".card");
  if (card?.classList.contains("card-dragging")) {
    e.preventDefault();
  }
});

// Drag & drop (same-row constraint enforced via data-drag-row on boardEl)
boardEl.addEventListener("dragstart", (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
  if (!card?.dataset.issueId) return;
  e.dataTransfer!.setData("text/plain", card.dataset.issueId);
  e.dataTransfer!.effectAllowed = "move";
  card.classList.add("card-dragging");
  // Record which row this card belongs to (for same-row constraint)
  const parentCell = card.closest<HTMLElement>(".board-cell");
  if (parentCell?.dataset.rowIdx) {
    boardEl.setAttribute("data-drag-row", parentCell.dataset.rowIdx);
  }
  // Hide tooltip during drag
  hideTooltip();
});

boardEl.addEventListener("dragend", (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
  card?.classList.remove("card-dragging");
  boardEl.removeAttribute("data-drag-row");
  // Clear any lingering dragover highlights
  boardEl.querySelectorAll(".board-cell-dragover").forEach((el) => el.classList.remove("board-cell-dragover"));
});

let lastDragOverCell: HTMLElement | null = null;

boardEl.addEventListener("dragover", (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>(".board-cell");
  if (!cell) return;
  e.preventDefault();
  const dragRow = boardEl.getAttribute("data-drag-row");
  if (dragRow !== null && dragRow !== cell.dataset.rowIdx) {
    e.dataTransfer!.dropEffect = "none";
    return;
  }
  e.dataTransfer!.dropEffect = "move";
  if (lastDragOverCell !== cell) {
    lastDragOverCell?.classList.remove("board-cell-dragover");
    lastDragOverCell = cell;
    cell.classList.add("board-cell-dragover");
  }
});

boardEl.addEventListener("dragleave", (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>(".board-cell");
  if (cell && cell === lastDragOverCell && !cell.contains(e.relatedTarget as Node)) {
    cell.classList.remove("board-cell-dragover");
    lastDragOverCell = null;
  }
});

boardEl.addEventListener("drop", async (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>(".board-cell");
  if (!cell) return;
  e.preventDefault();
  cell.classList.remove("board-cell-dragover");
  lastDragOverCell = null;

  const dragRow = boardEl.getAttribute("data-drag-row");
  if (dragRow !== null && dragRow !== cell.dataset.rowIdx) return;

  const issueId = e.dataTransfer!.getData("text/plain");
  const stateId = cell.dataset.stateId;
  if (!issueId || !stateId || !cachedApiKey) return;

  // Move card element to this cell immediately
  const draggedCard = boardEl.querySelector(`[data-issue-id="${CSS.escape(issueId)}"]`) as HTMLElement | null;
  if (draggedCard) {
    let wrapper = cell.querySelector(".cell-card-wrapper");
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.className = "cell-card-wrapper";
      cell.insertBefore(wrapper, cell.firstChild);
    }
    wrapper.appendChild(draggedCard);
  }

  // Update state via API
  try {
    await updateIssueState(cachedApiKey, issueId, stateId);
  } catch (err) {
    console.error("[whiteboard] Failed to update issue state:", err);
    loadBoard();
  }
});

// -- Tooltip (single reusable element, shown via delegated hover) --

const tooltipEl = document.createElement("div");
tooltipEl.className = "card-tooltip";
document.body.appendChild(tooltipEl);
let tooltipCard: HTMLElement | null = null;

function hideTooltip() {
  tooltipEl.classList.remove("tooltip-visible");
  tooltipCard = null;
}

function showTooltipFor(card: HTMLElement) {
  const sub = subIssueById.get(card.dataset.issueId ?? "");
  if (!sub) return;
  tooltipCard = card;

  let tooltipLabels = "";
  for (const label of sub.labels.nodes) {
    tooltipLabels += `<span class="tooltip-label" style="background:${escapeHtml(label.color)}30;color:${escapeHtml(label.color)}">${escapeHtml(label.name)}</span> `;
  }
  let tooltipDeps = "";
  for (const rel of blockedByOf(sub)) {
    tooltipDeps += `<div class="tooltip-row"><span class="tooltip-dep-blocked">⊘ blocked by</span><span class="tooltip-dep-title">${escapeHtml(rel.title)}</span><span class="tooltip-dep-state">${escapeHtml(rel.state.name)}</span></div>`;
  }
  for (const rel of blocksOf(sub)) {
    tooltipDeps += `<div class="tooltip-row"><span class="tooltip-dep-blocks">→ blocks</span><span class="tooltip-dep-title">${escapeHtml(rel.title)}</span><span class="tooltip-dep-state">${escapeHtml(rel.state.name)}</span></div>`;
  }
  tooltipEl.innerHTML = `
    <div class="tooltip-identifier">${escapeHtml(sub.identifier)}</div>
    <div class="tooltip-title">${escapeHtml(sub.title)}</div>
    ${sub.assignee ? `<div class="tooltip-row">Assignee: ${escapeHtml(sub.assignee.name)}</div>` : ""}
    <div class="tooltip-row">Status: ${escapeHtml(sub.state.name)}</div>
    <div class="tooltip-row">Priority: ${priorityLabel(sub.priority)}</div>
    <div class="tooltip-row">In state: ${daysInCurrentState(sub)}d</div>
    ${tooltipDeps}
    ${tooltipLabels ? `<div class="tooltip-row">${tooltipLabels}</div>` : ""}
  `;
  tooltipEl.classList.add("tooltip-visible");

  const rect = card.getBoundingClientRect();
  const isFirstRow = card.closest<HTMLElement>(".board-cell")?.dataset.rowIdx === "0";
  const showBelow = isFirstRow || rect.top < 150;
  const tipRect = tooltipEl.getBoundingClientRect();

  // Horizontal: center on card, clamp to viewport
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
  tooltipEl.style.left = `${left}px`;

  if (showBelow) {
    tooltipEl.style.top = `${rect.bottom + 6}px`;
    tooltipEl.style.bottom = "auto";
  } else {
    tooltipEl.style.top = "auto";
    tooltipEl.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  }
}

boardEl.addEventListener("mouseover", (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
  if (!card || card === tooltipCard) return;
  if (card.classList.contains("card-dragging")) return;
  showTooltipFor(card);
});

boardEl.addEventListener("mouseout", (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
  if (card && card === tooltipCard && !card.contains(e.relatedTarget as Node)) {
    hideTooltip();
  }
});

// Elapsed days in current state (from history, fallback to createdAt)
function daysInCurrentState(sub: SubIssue): number {
  // Find the most recent history entry where toState matches current state
  if (sub.history?.nodes) {
    for (const entry of sub.history.nodes) {
      if (entry.toState?.id === sub.state.id) {
        return Math.floor((Date.now() - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      }
    }
  }
  // Fallback: use issue createdAt
  return Math.floor((Date.now() - new Date(sub.createdAt).getTime()) / (1000 * 60 * 60 * 24));
}

function elapsedRingGradient(days: number): string | null {
  if (days < 1) return null;
  const segments = Math.min(days, 5);
  const colors: Record<number, string> = {
    1: "#4ade80", // green
    2: "#a3e635", // lime
    3: "#facc15", // yellow
    4: "#fb923c", // orange
    5: "#ef4444", // red
  };
  const color = colors[segments];
  const segDeg = 72; // 360 / 5
  const gapDeg = 4;
  const parts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const start = i * segDeg;
    const fillEnd = start + segDeg - gapDeg;
    const segEnd = start + segDeg;
    if (i < segments) {
      parts.push(`${color} ${start}deg ${fillEnd}deg`);
      parts.push(`transparent ${fillEnd}deg ${segEnd}deg`);
    } else {
      parts.push(`#3B3C42 ${start}deg ${fillEnd}deg`);
      parts.push(`transparent ${fillEnd}deg ${segEnd}deg`);
    }
  }
  return `conic-gradient(from 0deg, ${parts.join(", ")})`;
}

function priorityLabel(priority: number): string {
  switch (priority) {
    case 1: return "Urgent";
    case 2: return "High";
    case 3: return "Medium";
    case 4: return "Low";
    default: return "None";
  }
}

const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(ESCAPE_RE, (c) => ESCAPE_MAP[c]);
}

// Fetch blocking relations for every card on the board and attach them to
// the sub-issue objects (rendered by cardHtml / the tooltip)
async function loadRelations(apiKey: string, issues: Issue[]): Promise<void> {
  const subs: SubIssue[] = [];
  for (const issue of issues) {
    for (const child of issue.children.nodes) {
      subs.push(child);
      if (child.children?.nodes) {
        subs.push(...child.children.nodes);
      }
    }
  }
  if (subs.length === 0) return;

  const ids = Array.from(new Set(subs.map((s) => s.id)));
  const relMap = await fetchIssueRelations(apiKey, ids);

  for (const sub of subs) {
    const rel = relMap.get(sub.id);
    if (rel) {
      sub.relations = { nodes: rel.relations };
      sub.inverseRelations = { nodes: rel.inverseRelations };
    }
  }

  const withDeps = subs.filter((s) => blockedByOf(s).length > 0 || blocksOf(s).length > 0);
  console.log(
    `[whiteboard] relations: fetched for ${relMap.size}/${ids.length} cards, ${withDeps.length} with active blocking relations`,
    withDeps.map((s) => s.identifier)
  );
}

function showView(view: "loading" | "error" | "empty" | "board") {
  loadingEl.hidden = view !== "loading";
  errorEl.hidden = view !== "error";
  emptyEl.hidden = view !== "empty";
  boardEl.hidden = view !== "board";
}

async function loadBoard() {
  showView("loading");

  try {
    // Load color label whitelist and API key in parallel
    const [colorLabels, apiKey] = await Promise.all([getColorLabels(), getApiKey()]);
    colorLabelSet = new Set(colorLabels);
    cachedApiKey = apiKey ?? null;

    if (!apiKey) {
      errorTextEl.textContent = "API Key is not configured. Please set it in Settings.";
      showView("error");
      return;
    }

    if (!viewUrl) {
      errorTextEl.textContent = "Please open a Linear Custom View page and click the extension icon.";
      showView("error");
      return;
    }

    const viewId = extractViewId(viewUrl);
    if (!viewId) {
      errorTextEl.textContent = "Invalid Custom View URL format.";
      showView("error");
      return;
    }

    // Fetch first page to get teamId early
    const firstPage = await fetchCustomViewFirstPage(apiKey, viewId);

    // Detect team from the first page
    const detectedTeam = firstPage.issueNodes.length > 0 ? firstPage.issueNodes[0].team : null;
    if (!detectedTeam) {
      viewNameEl.textContent = firstPage.viewMeta.name;
      showView("empty");
      return;
    }

    const teamId = detectedTeam.id;

    // Fetch remaining issues/children, states, and cycles in parallel
    const [viewData, states, cycles] = await Promise.all([
      fetchCustomViewRemaining(apiKey, viewId, firstPage),
      fetchWorkflowStates(apiKey, teamId),
      fetchTeamCycles(apiKey, teamId),
    ]);

    // Attach blocking relations before rendering so the board renders once.
    // Non-fatal: on failure the board just renders without dependency info.
    try {
      await loadRelations(apiKey, viewData.issues.nodes);
    } catch (e) {
      console.error("[whiteboard] Failed to fetch issue relations:", e);
    }

    cachedAllIssues = viewData.issues.nodes;
    cachedGrouping = viewData.viewPreferencesValues?.issueGrouping ?? null;
    viewNameEl.textContent = viewData.name;
    currentStates = states;

    if (cachedAllIssues.length === 0) {
      showView("empty");
      return;
    }

    // Populate cycle selector and auto-select active cycle
    if (!selectedCycleId) {
      selectedCycleId = detectActiveCycleId(cycles);
    }
    populateCycleSelect(cycles, selectedCycleId);

    applyFilterAndRender();
  } catch (e) {
    errorTextEl.textContent = `Failed to fetch data: ${e instanceof Error ? e.message : String(e)}`;
    showView("error");
  }
}

// Initial load
loadBoard();

