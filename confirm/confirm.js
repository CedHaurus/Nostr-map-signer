"use strict";

const ext = typeof browser !== "undefined" && browser.runtime ? browser : chrome;

const params    = new URLSearchParams(window.location.search);
const requestId = params.get("requestId");

function api(msg) {
  return ext.runtime.sendMessage(msg).then((r) => {
    if (!r.ok) throw new Error(r.error || "Erreur.");
    return r.result;
  });
}

// ── Timer ─────────────────────────────────────
function startTimer(expiresAt) {
  const fill  = document.getElementById("timer-fill");
  const total = Math.max(expiresAt - Date.now(), 0);

  function tick() {
    const remaining = Math.max(expiresAt - Date.now(), 0);
    fill.style.transform = `scaleX(${total > 0 ? remaining / total : 0})`;
    if (remaining <= 0) { window.close(); return; }
    requestAnimationFrame(tick);
  }
  tick();
}

// ── Load request ──────────────────────────────
async function load() {
  const req = await api({ action: "getConfirmationRequest", requestId });

  // Top bar label
  document.getElementById("bar-title").textContent =
    req.type === "sign" ? "Demande de signature" : "Accès à la clé publique";

  // Site
  document.getElementById("site-domain").textContent = req.host;

  // Detect payment request (kindLabel starts with ⚡)
  const isPayment = req.type === "sign" && req.kindLabel && req.kindLabel.startsWith("⚡");

  if (isPayment) {
    document.getElementById("bar-title").textContent = "Paiement Lightning";
    document.getElementById("site-avatar").textContent = "⚡";
    document.getElementById("site-avatar").style.background = "rgba(251,191,36,.15)";
    document.getElementById("site-avatar").style.borderColor = "rgba(251,191,36,.35)";
    document.getElementById("site-action").textContent = "demande un paiement Lightning";
    document.getElementById("btn-approve").textContent = "⚡ Zapper";

    document.getElementById("payment-block").classList.remove("hidden");
    document.getElementById("payment-amount").textContent =
      req.amountSats != null ? Number(req.amountSats).toLocaleString("fr-FR") : "?";

  } else if (req.type === "sign") {
    document.getElementById("site-avatar").textContent = "✍️";
    document.getElementById("site-action").textContent = "demande à signer un événement Nostr";
    document.getElementById("btn-approve").textContent = "✓ Signer";

    const detail = document.getElementById("request-detail");
    detail.classList.remove("hidden");
    const kindText = req.kindLabel || `Événement technique (kind ${req.kind})`;
    document.getElementById("detail-kind").textContent = kindText;
    const preview = req.contentPreview || "(contenu vide)";
    document.getElementById("detail-preview").textContent =
      preview.length > 120 ? preview.slice(0, 120) + "…" : preview;

    const tagsEl = document.getElementById("detail-tags");
    if (Array.isArray(req.tags) && req.tags.length > 0) {
      tagsEl.innerHTML = "";
      req.tags.forEach((tag) => {
        if (!Array.isArray(tag) || tag.length === 0) return;
        const row = document.createElement("div");
        row.className = "detail-tag";
        const name = document.createElement("span");
        name.textContent = tag[0];
        row.appendChild(name);
        const val = tag.slice(1).map(v => String(v).slice(0, 60)).join("  ");
        row.appendChild(document.createTextNode(val));
        tagsEl.appendChild(row);
      });
    } else {
      tagsEl.style.display = "none";
    }

  } else {
    document.getElementById("site-avatar").textContent = "🔑";
    document.getElementById("site-action").textContent = "demande votre clé publique Nostr";
  }

  // Always allow checkbox
  const alwaysRow = document.getElementById("always-allow-row");
  if (req.showAlwaysAllow) alwaysRow.classList.remove("hidden");

  startTimer(req.expiresAt);
}

// ── Actions ───────────────────────────────────
document.getElementById("btn-approve").addEventListener("click", async () => {
  document.getElementById("btn-approve").disabled = true;
  await api({
    action: "approveConfirmation",
    requestId,
    alwaysAllow: document.getElementById("always-allow").checked,
  }).catch(() => {});
  window.close();
});

document.getElementById("btn-reject").addEventListener("click", async () => {
  document.getElementById("btn-reject").disabled = true;
  await api({ action: "rejectConfirmation", requestId }).catch(() => {});
  window.close();
});

load().catch(() => window.close());
