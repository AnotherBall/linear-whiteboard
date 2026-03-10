// Content script: inject "Whiteboard" button into Linear's view header

const BUTTON_ID = "linear-whiteboard-btn";
const IFRAME_ID = "linear-whiteboard-iframe";

function isContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function getWhiteboardUrl(): string | null {
  if (!isContextValid()) return null;
  const url = window.location.href;
  const match = url.match(/\/view\/.*?-([a-f0-9]+)$/);
  if (!match) return null;
  return chrome.runtime.getURL(`src/whiteboard/whiteboard.html?viewUrl=${encodeURIComponent(url)}`);
}

function createButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.title = "Open Whiteboard";
  btn.textContent = "📋 Whiteboard";
  Object.assign(btn.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 8px",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "6px",
    background: "rgba(94, 106, 210, 0.15)",
    color: "#9BA1E5",
    fontSize: "12px",
    fontWeight: "500",
    cursor: "pointer",
    marginLeft: "8px",
    fontFamily: "inherit",
    lineHeight: "1",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(94, 106, 210, 0.3)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "rgba(94, 106, 210, 0.15)";
  });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleWhiteboard();
  });
  return btn;
}

function toggleWhiteboard() {
  const existing = document.getElementById(IFRAME_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const url = getWhiteboardUrl();
  if (!url) return;

  const iframe = document.createElement("iframe");
  iframe.id = IFRAME_ID;
  iframe.src = url;
  Object.assign(iframe.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    border: "none",
    zIndex: "99999",
    background: "#191A1F",
  });

  function closeWhiteboard() {
    iframe.remove();
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("message", onMessage);
    // Re-inject button in case Linear's SPA re-rendered the header
    setTimeout(injectButton, 100);
  }

  // Close on Escape key (capture phase to prevent Linear's shortcut from firing)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      closeWhiteboard();
    }
  };
  document.addEventListener("keydown", onKey, true);

  // Close on postMessage from iframe
  const onMessage = (e: MessageEvent) => {
    if (e.data === "linear-whiteboard-close") closeWhiteboard();
  };
  window.addEventListener("message", onMessage);

  document.body.appendChild(iframe);
}

function injectButton() {
  if (document.getElementById(BUTTON_ID)) return;
  if (!getWhiteboardUrl()) return;

  // Find the header area with the view name
  // Target the container with the ••• menu button (aria-label="Issue view options")
  const menuBtn = document.querySelector('button[aria-label="Issue view options"]');
  if (!menuBtn) return;

  const container = menuBtn.closest('[class*="Flex"]');
  if (!container) return;

  container.appendChild(createButton());
}

// Observe DOM changes (Linear is a SPA)
const observer = new MutationObserver(() => {
  // Stop observing if extension context is invalidated (e.g. after extension reload)
  if (!isContextValid()) {
    observer.disconnect();
    document.getElementById(BUTTON_ID)?.remove();
    document.getElementById(IFRAME_ID)?.remove();
    return;
  }
  // Remove button if no longer on a view page
  if (!getWhiteboardUrl()) {
    document.getElementById(BUTTON_ID)?.remove();
    document.getElementById(IFRAME_ID)?.remove();
    return;
  }
  injectButton();
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial inject
injectButton();
