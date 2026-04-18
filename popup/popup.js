"use strict";

const ext = typeof browser !== "undefined" && browser.runtime ? browser : chrome;

// ── DOM refs ──────────────────────────────────
const banner        = document.getElementById("banner");
const btnLock       = document.getElementById("btn-lock");
const viewSetup     = document.getElementById("view-setup");
const viewLocked    = document.getElementById("view-locked");
const viewUnlocked  = document.getElementById("view-unlocked");
const formSetup     = document.getElementById("form-setup");
const formUnlock    = null; // remplacé par PIN pad
const formEditKey   = document.getElementById("form-edit-key");
const formEditNwc   = document.getElementById("form-edit-nwc");

// ── API helper ────────────────────────────────
function api(msg) {
  return ext.runtime.sendMessage(msg).then((r) => {
    if (!r.ok) throw new Error(r.error || "Erreur inconnue.");
    return r.result;
  });
}

// ── Banner ────────────────────────────────────
let bannerTimer = null;

function showBanner(msg, type = "error") {
  clearTimeout(bannerTimer);
  if (!msg) {
    banner.className = "banner hidden";
    banner.textContent = "";
    return;
  }
  banner.className = `banner ${type}`;
  banner.textContent = msg;
  if (type === "success") bannerTimer = setTimeout(() => showBanner(""), 3000);
}

// ── Eye toggle (show/hide password) ──────────
document.addEventListener("click", (e) => {
  if (!e.target || typeof e.target.closest !== "function") return;
  const btn = e.target.closest(".btn-eye");
  if (!btn) return;
  const inp = document.getElementById(btn.dataset.target);
  if (!inp) return;
  inp.type = inp.type === "password" ? "text" : "password";
  btn.textContent = inp.type === "password" ? "👁" : "🙈";
});

// ── Render state ──────────────────────────────
function renderState(state) {
  showBanner("");

  // Hide all views
  viewSetup.classList.add("hidden");
  viewLocked.classList.add("hidden");
  viewUnlocked.classList.add("hidden");
  btnLock.classList.add("hidden");

  if (!state.configured) {
    viewSetup.classList.remove("hidden");
    return;
  }

  if (!state.unlocked) {
    viewLocked.classList.remove("hidden");
    if (state.authMode === "passphrase") {
      document.getElementById("unlock-pin-wrap").classList.add("hidden");
      document.getElementById("unlock-passphrase-wrap").classList.remove("hidden");
      document.getElementById("lock-subtitle").textContent = "Entrez votre passphrase";
      document.getElementById("unlock-passphrase").value = "";
      document.getElementById("unlock-passphrase").focus();
    } else {
      document.getElementById("unlock-pin-wrap").classList.remove("hidden");
      document.getElementById("unlock-passphrase-wrap").classList.add("hidden");
      document.getElementById("lock-subtitle").textContent = "Entrez votre code PIN";
      initUnlockPinPad();
    }
    return;
  }

  // Unlocked
  btnLock.classList.remove("hidden");
  viewUnlocked.classList.remove("hidden");

  document.getElementById("npub-short").textContent = state.npubShort || "";
  document.getElementById("npub-full").textContent  = state.npub || "";
  document.getElementById("nwc-display").textContent =
    state.hasNwc ? state.nwcMasked : "Non configuré";

  const balRow = document.getElementById("balance-row");
  const sendSection    = document.getElementById("send-section");
  const historySection = document.getElementById("history-section");
  if (state.hasNwc) {
    balRow.classList.remove("hidden");
    document.getElementById("balance-val").textContent =
      state.balanceLabel ? `${state.balanceLabel} sats` : "Solde indisponible";
    sendSection    && sendSection.classList.remove("hidden");
    historySection && historySection.classList.remove("hidden");
  } else {
    balRow.classList.add("hidden");
    sendSection    && sendSection.classList.add("hidden");
    historySection && historySection.classList.add("hidden");
  }

  renderSites(state.permissions || []);
}

function renderSites(perms) {
  const list = document.getElementById("sites-list");
  list.innerHTML = "";

  if (!perms.length) {
    const li = document.createElement("li");
    li.className = "sites-empty";
    li.textContent = "Aucun site autorisé pour l'instant.";
    list.appendChild(li);
    return;
  }

  perms.forEach((p) => {
    const li = document.createElement("li");
    li.className = "site-item";
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "site-name";
    name.textContent = p.host;
    const src = document.createElement("div");
    src.className = "site-src";
    src.textContent = p.source === "default" ? "Pré-autorisé par défaut" : "Autorisé via prompt";
    info.appendChild(name);
    info.appendChild(src);
    const btn = document.createElement("button");
    btn.className = "btn-revoke";
    btn.type = "button";
    btn.dataset.host = p.host;
    btn.textContent = "Révoquer";
    li.appendChild(info);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

async function refresh() {
  const state = await api({ action: "getState" });
  renderState(state);
  return state;
}

// ── Setup : toggle PIN / passphrase ──────────
let _setupPin = "";

function initSetupPinPad() {
  _setupPin = "";
  const dotsEl = document.getElementById("s-pin-dots");
  const padEl  = document.getElementById("s-pin-pad");
  if (!dotsEl || !padEl) return;
  dotsEl.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const d = document.createElement("div"); d.className = "pin-dot"; dotsEl.appendChild(d);
  }
  padEl.innerHTML = "";
  ["1","2","3","4","5","6","7","8","9","","0","⌫"].forEach((k) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = k;
    btn.className = k === "" ? "pin-key key-empty" : k === "⌫" ? "pin-key key-del" : "pin-key";
    btn.addEventListener("click", () => {
      if (k === "⌫") { _setupPin = _setupPin.slice(0, -1); }
      else if (k !== "" && _setupPin.length < 6) { _setupPin += k; }
      dotsEl.querySelectorAll(".pin-dot").forEach((d, i) => {
        d.classList.toggle("filled", i < _setupPin.length);
      });
    });
    padEl.appendChild(btn);
  });
}

document.querySelectorAll("[name=s-auth-mode]").forEach((radio) => {
  radio.addEventListener("change", () => {
    const mode = document.querySelector("[name=s-auth-mode]:checked")?.value || "pin";
    document.getElementById("s-pin-field").classList.toggle("hidden", mode !== "pin");
    document.getElementById("s-passphrase-field").classList.toggle("hidden", mode !== "passphrase");
    document.getElementById("s-auth-hint").textContent = mode === "pin"
      ? "Rapide à saisir. Vulnérable si le profil navigateur est volé."
      : "Résiste au brute-force hors ligne. Conseillé si vous stockez des sats importants.";
    if (mode === "pin") initSetupPinPad();
  });
});

// Init PIN pad setup au chargement
initSetupPinPad();

// ── Setup form ────────────────────────────────
formSetup.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = formSetup.querySelector("[type=submit]");
  const authMode = document.querySelector("[name=s-auth-mode]:checked")?.value || "pin";
  const password = authMode === "pin"
    ? _setupPin
    : document.getElementById("s-pass").value;

  btn.disabled = true;
  btn.textContent = "Chiffrement…";
  try {
    await api({
      action: "setupVault",
      payload: {
        privateKey: document.getElementById("s-key").value,
        password,
        authMode,
        nwcUri: document.getElementById("s-nwc").value,
      },
    });
    formSetup.reset();
    _setupPin = "";
    initSetupPinPad();
    showBanner("Configuration enregistrée.", "success");
    await refresh();
  } catch (err) {
    showBanner(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Valider →";
  }
});

// ── Unlock PIN pad ────────────────────────────
let _pinDigits = "";

function initUnlockPinPad() {
  _pinDigits = "";
  const dotsEl = document.getElementById("pin-dots-unlock");
  const padEl  = document.getElementById("pin-pad-unlock");
  if (!dotsEl || !padEl) return;

  dotsEl.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const d = document.createElement("div");
    d.className = "pin-dot";
    dotsEl.appendChild(d);
  }

  padEl.innerHTML = "";
  ["1","2","3","4","5","6","7","8","9","","0","⌫"].forEach((k) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = k;
    btn.className = k === "" ? "pin-key key-empty" : k === "⌫" ? "pin-key key-del" : "pin-key";
    btn.addEventListener("click", () => {
      if (k === "⌫") { _pinDigits = _pinDigits.slice(0, -1); updateDots(); return; }
      if (k === "" || _pinDigits.length >= 6) return;
      _pinDigits += k;
      const idx = _pinDigits.length - 1;
      const dot = dotsEl.querySelectorAll(".pin-dot")[idx];
      dot.classList.add("flash");
      setTimeout(async () => {
        dot.classList.remove("flash");
        updateDots();
        if (_pinDigits.length === 6) {
          const pin = _pinDigits; _pinDigits = ""; updateDots();
          try {
            const state = await api({ action: "unlockVault", password: pin });
            await refresh();
            if (state.hasNwc) api({ action: "refreshWalletBalance" }).then(refresh).catch(() => {});
          } catch (err) { showBanner(err.message); initUnlockPinPad(); }
        }
      }, 120);
    });
    padEl.appendChild(btn);
  });

  function updateDots() {
    dotsEl.querySelectorAll(".pin-dot").forEach((d, i) => {
      d.classList.toggle("filled", i < _pinDigits.length);
      d.classList.remove("flash");
    });
  }
}

// ── Unlock passphrase ─────────────────────────
document.getElementById("form-unlock-passphrase").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("unlock-passphrase");
  const btn = e.target.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const state = await api({ action: "unlockVault", password: input.value });
    await refresh();
    if (state.hasNwc) api({ action: "refreshWalletBalance" }).then(refresh).catch(() => {});
  } catch (err) {
    showBanner(err.message);
    input.value = "";
    input.focus();
  } finally {
    btn.disabled = false;
  }
});

// ── Lock ──────────────────────────────────────
btnLock.addEventListener("click", async () => {
  await api({ action: "lockVault" });
  await refresh();
});

// ── Tabs ──────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.remove("hidden");
  });
});

// ── Edit key ──────────────────────────────────
document.getElementById("btn-edit-key").addEventListener("click", () => {
  formEditKey.classList.toggle("hidden");
});
document.getElementById("btn-cancel-key").addEventListener("click", () => {
  formEditKey.classList.add("hidden");
  formEditKey.reset();
});
formEditKey.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api({
      action: "updatePrivateKey",
      privateKey: document.getElementById("e-key").value,
    });
    formEditKey.reset();
    formEditKey.classList.add("hidden");
    showBanner("Clé mise à jour.", "success");
    await refresh();
  } catch (err) {
    showBanner(err.message);
  }
});

// ── Edit NWC ──────────────────────────────────
document.getElementById("btn-edit-nwc").addEventListener("click", () => {
  formEditNwc.classList.toggle("hidden");
});
document.getElementById("btn-cancel-nwc").addEventListener("click", () => {
  formEditNwc.classList.add("hidden");
  formEditNwc.reset();
});
formEditNwc.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api({
      action: "updateNwcUri",
      nwcUri: document.getElementById("e-nwc").value,
    });
    formEditNwc.classList.add("hidden");
    showBanner("Wallet mis à jour.", "success");
    await refresh();
  } catch (err) {
    showBanner(err.message);
  }
});

// ── Refresh balance ───────────────────────────
document.getElementById("btn-refresh-bal").addEventListener("click", async () => {
  const btn = document.getElementById("btn-refresh-bal");
  btn.style.opacity = ".4";
  try {
    await api({ action: "refreshWalletBalance" });
    await refresh();
  } catch (err) {
    showBanner(err.message);
  } finally {
    btn.style.opacity = "";
  }
});

// ── Copy npub ─────────────────────────────────
document.getElementById("btn-copy-npub").addEventListener("click", async () => {
  try {
    const state = await api({ action: "getState" });
    if (state.npub) {
      await navigator.clipboard.writeText(state.npub);
      showBanner("Clé publique copiée !", "success");
    }
  } catch (err) {
    showBanner("Impossible de copier.");
  }
});

// ── Revoke site ───────────────────────────────
document.getElementById("sites-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-host]");
  if (!btn) return;
  try {
    await api({ action: "revokePermission", host: btn.dataset.host });
    await refresh();
  } catch (err) {
    showBanner(err.message);
  }
});

// ── Reset from locked screen ──────────────────
document.getElementById("btn-reset-from-lock").addEventListener("click", async () => {
  if (!window.confirm("Supprimer la configuration et effacer la clé privée de ce navigateur ?")) return;
  try {
    await api({ action: "resetVault" });
    await refresh();
  } catch (err) { showBanner(err.message); }
});

// ── Open options page ─────────────────────────
document.getElementById("btn-open-options").addEventListener("click", () => {
  ext.runtime.openOptionsPage();
});

// ── Transaction history ───────────────────────
function renderTxHistory(txs) {
  const list = document.getElementById("tx-history-list");
  list.innerHTML = "";
  const recent = (txs || []).slice(0, 10);
  if (!recent.length) {
    const li = document.createElement("li");
    li.className = "tx-empty";
    li.textContent = "Aucune transaction.";
    list.appendChild(li);
    return;
  }
  recent.forEach((tx) => {
    const li = document.createElement("li");
    li.className = "tx-item";
    const date = new Date(tx.timestamp);
    const dateStr = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
      + " " + date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    const iconEl = document.createElement("div");
    iconEl.className = "tx-icon";
    iconEl.textContent = tx.type === "zap" ? "⚡" : "↗";

    const infoEl = document.createElement("div");
    infoEl.className = "tx-info";
    const recipientEl = document.createElement("div");
    recipientEl.className = "tx-recipient";
    recipientEl.textContent = String(tx.recipient || tx.host || "Inconnu").slice(0, 40);
    const metaEl = document.createElement("div");
    metaEl.className = "tx-meta";
    metaEl.textContent = dateStr;
    infoEl.appendChild(recipientEl);
    infoEl.appendChild(metaEl);

    const amountStr = tx.amountSats != null
      ? `${tx.amountSats.toLocaleString("fr-FR")} sats`
      : "? sats";
    const amountEl = document.createElement("div");
    amountEl.className = "tx-amount" + (tx.preimageVerified ? "" : " unverified");
    amountEl.textContent = amountStr;
    if (tx.preimageVerified) {
      const checkEl = document.createElement("span");
      checkEl.className = "tx-verified";
      checkEl.title = "Preimage vérifié";
      checkEl.textContent = "✓";
      amountEl.appendChild(checkEl);
    }

    li.appendChild(iconEl);
    li.appendChild(infoEl);
    li.appendChild(amountEl);
    list.appendChild(li);
  });
}

async function loadTxHistory() {
  try {
    const txs = await api({ action: "getTransactionHistory" });
    renderTxHistory(txs);
  } catch (_) {}
}

document.getElementById("btn-refresh-history").addEventListener("click", loadTxHistory);

// ── Send via Lightning Address ─────────────────
let _pendingInvoice = null;
let _pendingAddress = null;

document.getElementById("btn-send-resolve").addEventListener("click", async () => {
  const address = document.getElementById("send-address").value.trim();
  const amount  = parseInt(document.getElementById("send-amount").value, 10);
  const resultEl  = document.getElementById("send-result");
  const previewEl = document.getElementById("send-preview");
  const btnConfirm = document.getElementById("btn-send-confirm");

  resultEl.className = "send-result hidden";
  previewEl.classList.add("hidden");
  btnConfirm.classList.add("hidden");
  _pendingInvoice = null;

  if (!address || !address.includes("@")) {
    resultEl.textContent = "Adresse invalide (format : user@domaine.com).";
    resultEl.className = "send-result error";
    return;
  }
  if (!amount || amount < 1) {
    resultEl.textContent = "Montant invalide.";
    resultEl.className = "send-result error";
    return;
  }

  const btn = document.getElementById("btn-send-resolve");
  btn.disabled = true;
  btn.textContent = "Résolution…";
  try {
    const invoice = await api({
      action: "resolveInvoiceFromLnurl",
      payload: { lightningAddress: address, amountSats: amount },
    });
    _pendingInvoice = invoice;
    _pendingAddress = address;
    document.getElementById("send-preview-amount").textContent =
      `${amount.toLocaleString("fr-FR")} sats`;
    document.getElementById("send-preview-to").textContent = address;
    previewEl.classList.remove("hidden");
    btnConfirm.classList.remove("hidden");
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.className = "send-result error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Préparer →";
  }
});

document.getElementById("btn-send-confirm").addEventListener("click", async () => {
  if (!_pendingInvoice) return;
  const btn = document.getElementById("btn-send-confirm");
  const resultEl = document.getElementById("send-result");
  btn.disabled = true;
  btn.textContent = "Envoi…";
  try {
    const res = await api({
      action: "payInvoiceDirect",
      invoice: _pendingInvoice,
      memo: _pendingAddress,
    });
    _pendingInvoice = null;
    document.getElementById("send-preview").classList.add("hidden");
    document.getElementById("btn-send-confirm").classList.add("hidden");
    document.getElementById("send-address").value = "";
    document.getElementById("send-amount").value = "";
    resultEl.textContent = `✓ Envoyé ! ${res.amountSats != null ? res.amountSats.toLocaleString("fr-FR") + " sats" : ""}${res.preimageVerified ? " · preimage vérifié" : ""}`;
    resultEl.className = "send-result ok";
    await refresh();
    await loadTxHistory();
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.className = "send-result error";
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Payer";
  }
});

// ── Load history when Lightning tab is activated ─
document.querySelectorAll(".tab").forEach((tab) => {
  if (tab.dataset.tab === "lightning") {
    tab.addEventListener("click", loadTxHistory);
  }
});

// ── Init ──────────────────────────────────────
refresh().catch((err) => showBanner(err.message));
