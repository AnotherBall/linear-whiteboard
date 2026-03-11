function get<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(key, (result) => {
      resolve(result[key] as T | undefined);
    });
  });
}

function set(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(items, resolve);
  });
}

export async function getApiKey(): Promise<string | undefined> {
  return get<string>("apiKey");
}

export async function setApiKey(apiKey: string): Promise<void> {
  return set({ apiKey });
}

const DEFAULT_COLOR_LABELS = [
  "Server", "Gurren", "Gurren Lagann", "Lagann",
  "Android", "Design", "iOS", "KMM", "Unity",
];

export async function getColorLabels(): Promise<string[]> {
  const labels = await get<string[]>("colorLabels");
  return labels ?? DEFAULT_COLOR_LABELS;
}

export async function setColorLabels(labels: string[]): Promise<void> {
  return set({ colorLabels: labels });
}

// Extract view ID from Linear Custom View URL
// e.g. https://linear.app/anotherball/view/cycle-planning-backlog-30beca7f44e5
// → "30beca7f44e5"
export function extractViewId(url: string): string | null {
  const match = url.match(/\/view\/.*?-([a-f0-9]+)$/);
  return match ? match[1] : null;
}
