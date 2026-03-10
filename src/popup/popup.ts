import { getApiKey } from "../lib/storage";
import { extractViewId } from "../lib/storage";

const viewDetectedEl = document.getElementById("view-detected") as HTMLElement;
const noViewEl = document.getElementById("no-view") as HTMLElement;
const noApikeyEl = document.getElementById("no-apikey") as HTMLElement;
const viewInfoEl = document.getElementById("view-info") as HTMLElement;
const openWhiteboardBtn = document.getElementById("open-whiteboard") as HTMLButtonElement;
const openSettingsBtn = document.getElementById("open-settings") as HTMLButtonElement;

let currentViewUrl: string | null = null;

// Detect if current tab is a Linear Custom View
async function init() {
  const apiKey = await getApiKey();

  if (!apiKey) {
    noApikeyEl.hidden = false;
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";

  const viewId = extractViewId(url);
  if (viewId) {
    currentViewUrl = url;
    // Extract view name from URL path for display
    const match = url.match(/\/view\/(.+)$/);
    const slug = match ? match[1] : "Custom View";
    viewInfoEl.textContent = slug;
    viewDetectedEl.hidden = false;
  } else {
    noViewEl.hidden = false;
  }
}

openWhiteboardBtn.addEventListener("click", () => {
  if (!currentViewUrl) return;
  const whiteboardUrl = chrome.runtime.getURL("src/whiteboard/whiteboard.html");
  const url = `${whiteboardUrl}?viewUrl=${encodeURIComponent(currentViewUrl)}`;
  chrome.tabs.create({ url });
});

openSettingsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/settings/settings.html") });
});

init();
