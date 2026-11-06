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

})();
