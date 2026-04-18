(() => {
  const ext = typeof browser !== "undefined" && browser.runtime ? browser : chrome;

  // ── Page bridge ───────────────────────────────
  const script = document.createElement("script");
  script.id = "nostrmap-signer-bridge";
  script.src = chrome.runtime.getURL("page-bridge.js");
  script.async = false;
  script.dataset.extensionId = chrome.runtime.id;
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const payload = event.data;
    if (!payload || payload.__nostrMapSigner !== true || payload.direction !== "page-to-content") return;

    try {
      const response = await ext.runtime.sendMessage({
        action: "pageBridge",
        method: payload.method,
        params: payload.params || {},
      });
      window.postMessage({ __nostrMapSigner: true, direction: "content-to-page",
        requestId: payload.requestId, ok: response.ok, result: response.result, error: response.error }, "*");
    } catch (error) {
      window.postMessage({ __nostrMapSigner: true, direction: "content-to-page",
        requestId: payload.requestId, ok: false, error: error.message || "Erreur de communication avec l'extension." }, "*");
    }
  });

  // ── Confirmation overlay ──────────────────────
  const OVERLAY_ID = "__nostr_map_signer_overlay__";

  function removeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  function showOverlay(confirmUrl) {
    removeOverlay();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483647",
      "background:rgba(0,0,0,0.55)", "backdrop-filter:blur(5px)",
      "-webkit-backdrop-filter:blur(5px)",
      "display:flex", "align-items:center", "justify-content:center",
    ].join(";");

    const frame = document.createElement("iframe");
    frame.src = confirmUrl;
    frame.style.cssText = [
      "width:460px", "height:420px",
      "border:none", "border-radius:20px",
      "box-shadow:0 24px 80px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.08)",
      "display:block",
    ].join(";");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");

    overlay.appendChild(frame);
    document.documentElement.appendChild(overlay);
  }

  ext.runtime.onMessage.addListener((msg) => {
    if (msg.action === "injectConfirmation") {
      showOverlay(msg.confirmUrl);
    } else if (msg.action === "closeConfirmation") {
      removeOverlay();
    }
  });
})();
