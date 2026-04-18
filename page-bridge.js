(() => {
  if (window.__nostrMapSignerInjected) return;
  window.__nostrMapSignerInjected = true;

  const pending = new Map();
  let requestCounter = 0;

  function request(method, params = {}) {
    return new Promise((resolve, reject) => {
      requestCounter += 1;
      const requestId = `nms-${Date.now()}-${requestCounter}`;
      pending.set(requestId, { resolve, reject });
      window.postMessage(
        {
          __nostrMapSigner: true,
          direction: "page-to-content",
          requestId,
          method,
          params,
        },
        "*"
      );
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const payload = event.data;
    if (!payload || payload.__nostrMapSigner !== true || payload.direction !== "content-to-page") return;

    const deferred = pending.get(payload.requestId);
    if (!deferred) return;
    pending.delete(payload.requestId);

    if (payload.ok) {
      deferred.resolve(payload.result);
      return;
    }

    deferred.reject(new Error(payload.error || "Requete refusee."));
  });

  if (!window.nostr) {
    window.nostr = {
      getPublicKey() {
        return request("getPublicKey");
      },
      signEvent(event) {
        return request("signEvent", { event });
      },
      nip44: {
        encrypt(pubkey, plaintext) {
          return request("nip44.encrypt", { pubkey, plaintext });
        },
        decrypt(pubkey, ciphertext) {
          return request("nip44.decrypt", { pubkey, ciphertext });
        },
      },
    };
  }

  if (!window.nostrMapSigner) {
    window.nostrMapSigner = {
      requestZap(payload) {
        return request("requestZap", payload);
      },
      resolveInvoice(payload) {
        return request("resolveInvoice", payload);
      },
    };
  }

  if (!window.webln) {
    window.webln = {
      enable() {
        return request("webln.enable");
      },
      sendPayment(paymentRequest) {
        return request("webln.sendPayment", { paymentRequest });
      },
      makeInvoice(args) {
        return request("webln.makeInvoice", args || {});
      },
      keysend(args) {
        return request("webln.keysend", args || {});
      },
      signMessage() {
        return Promise.reject(new Error("signMessage non supporté."));
      },
    };
  }
})();
