import { getApiKey, setApiKey, getColorLabels, setColorLabels } from "../lib/storage";
import { fetchTeams } from "../lib/linear-api";

const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const toggleBtn = document.getElementById("toggle-visibility") as HTMLButtonElement;
const verifyBtn = document.getElementById("verify-save") as HTMLButtonElement;
const apiStatus = document.getElementById("api-status") as HTMLDivElement;
const colorLabelsSection = document.getElementById("color-labels-section") as HTMLElement;
const colorLabelsInput = document.getElementById("color-labels") as HTMLTextAreaElement;
const saveColorLabelsBtn = document.getElementById("save-color-labels") as HTMLButtonElement;
const colorLabelsStatus = document.getElementById("color-labels-status") as HTMLDivElement;
const usageSection = document.getElementById("usage-section") as HTMLElement;

function showStatus(el: HTMLElement, message: string, type: "success" | "error") {
  el.textContent = message;
  el.className = `status ${type}`;
  el.hidden = false;
}

// Toggle API key visibility
toggleBtn.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
});

function showPostApiSections() {
  colorLabelsSection.hidden = false;
  usageSection.hidden = false;
}

// Verify and save API key
verifyBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showStatus(apiStatus, "Please enter an API Key.", "error");
    return;
  }

  verifyBtn.disabled = true;
  verifyBtn.textContent = "Verifying...";
  apiStatus.hidden = true;

  try {
    await fetchTeams(apiKey);
    await setApiKey(apiKey);
    showStatus(apiStatus, "API Key verified successfully.", "success");
    showPostApiSections();
  } catch (e) {
    showStatus(apiStatus, `Error: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.textContent = "Verify & Save";
  }
});

// Save color labels
saveColorLabelsBtn.addEventListener("click", async () => {
  const raw = colorLabelsInput.value;
  const labels = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  await setColorLabels(labels);
  showStatus(colorLabelsStatus, `Saved ${labels.length} label(s).`, "success");
});

// Load saved settings on startup
async function init() {
  // Load color labels (always, even without API key)
  const colorLabels = await getColorLabels();
  colorLabelsInput.value = colorLabels.join(", ");

  const apiKey = await getApiKey();
  if (apiKey) {
    apiKeyInput.value = apiKey;
    try {
      await fetchTeams(apiKey);
      showPostApiSections();
    } catch {
      // API key might be invalid, let user re-enter
    }
  }
}

init();
