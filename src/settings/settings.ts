import { getApiKey, setApiKey, getTeamId, setTeam, getColorLabels, setColorLabels } from "../lib/storage";
import { fetchTeams } from "../lib/linear-api";
import type { Team } from "../lib/types";

const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const toggleBtn = document.getElementById("toggle-visibility") as HTMLButtonElement;
const verifyBtn = document.getElementById("verify-save") as HTMLButtonElement;
const apiStatus = document.getElementById("api-status") as HTMLDivElement;
const teamSection = document.getElementById("team-section") as HTMLElement;
const teamSelect = document.getElementById("team-select") as HTMLSelectElement;
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
    const teams = await fetchTeams(apiKey);
    await setApiKey(apiKey);
    showStatus(apiStatus, "API Key verified successfully.", "success");
    populateTeams(teams);
  } catch (e) {
    showStatus(apiStatus, `Error: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.textContent = "Verify & Save";
  }
});

async function populateTeams(teams: Team[]) {
  teamSection.hidden = false;
  teamSelect.innerHTML = '<option value="">Select a team...</option>';

  const savedTeamId = await getTeamId();
  for (const team of teams) {
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = team.name;
    if (team.id === savedTeamId) {
      option.selected = true;
    }
    teamSelect.appendChild(option);
  }

  if (savedTeamId) {
    showPostTeamSections();
  }
}

function showPostTeamSections() {
  colorLabelsSection.hidden = false;
  usageSection.hidden = false;
}

// Save team selection
teamSelect.addEventListener("change", async () => {
  const selectedOption = teamSelect.selectedOptions[0];
  if (selectedOption && selectedOption.value) {
    await setTeam(selectedOption.value, selectedOption.textContent ?? "");
    showPostTeamSections();
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
      const teams = await fetchTeams(apiKey);
      await populateTeams(teams);
    } catch {
      // API key might be invalid, let user re-enter
    }
  }
}

init();
