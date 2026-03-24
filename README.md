# Linear Whiteboard

A Chrome extension that displays Linear Custom Views as a kanban-style whiteboard. Built for daily standups and team-wide progress overview.

## Features

- **Whiteboard view** - Grid layout with issues as rows and sub-issue statuses as columns
- **Drag & drop** - Move cards between status columns to update state
- **Cycle filter** - Filter by cycle period (auto-detects the active cycle)
- **Assignee highlight** - Highlight cards for a specific team member
- **Grouping & pager** - Supports Custom View grouping settings
- **Zoom** - Adjust text and card size from 50% to 150%
- **Priority & label colors** - Left border shows priority color, background shows label color
- **Days-in-progress indicator** - Ring visualization for time spent in Started state

## Setup

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

Enable developer mode at `chrome://extensions` and load the `dist/` folder.

### Build

```bash
npm run build
```

## Usage

1. Get a Personal API Key from Linear Settings > Account > Security
2. Configure the API Key in the extension's Settings page
3. Open a Linear Custom View page
4. Click the "Whiteboard" button in the header

## Deploy

Publishing to the Chrome Web Store is automated via GitHub Actions.

### Prerequisites

Set up the following in [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project and enable the **Chrome Web Store API**
2. Create an OAuth 2.0 client ID (Desktop app)
3. Add `https://www.googleapis.com/auth/chromewebstore` scope to the OAuth consent screen
4. Obtain a refresh token:
   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=<CLIENT_ID>&redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```
   Exchange the authorization code for a token:
   ```bash
   curl -X POST "https://oauth2.googleapis.com/token" \
     -d "client_id=<CLIENT_ID>" \
     -d "client_secret=<CLIENT_SECRET>" \
     -d "code=<AUTH_CODE>" \
     -d "grant_type=authorization_code" \
     -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"
   ```

5. Add the following secrets in GitHub repository Settings > Secrets:

   | Secret | Description |
   |--------|-------------|
   | `CHROME_EXTENSION_ID` | Extension ID on Chrome Web Store |
   | `CHROME_CLIENT_ID` | OAuth client ID |
   | `CHROME_CLIENT_SECRET` | OAuth client secret |
   | `CHROME_REFRESH_TOKEN` | Refresh token |

### Publishing

1. Go to the Actions tab and select **Publish Chrome Extension**
2. Click "Run workflow" and enter the version number (e.g. `0.2.0`)
3. The workflow automatically builds, uploads, and submits for review

The publish target is restricted to trusted testers only.

## Tech Stack

- TypeScript / Vanilla DOM
- Vite + [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin)
- Chrome Manifest V3
- Linear GraphQL API
