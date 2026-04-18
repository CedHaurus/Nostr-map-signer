"use strict";

const ext = typeof browser !== "undefined" && browser.runtime ? browser : chrome;

// ── DOM refs ──────────────────────────────────
const banner       = document.getElementById("banner");
const viewSetup    = document.getElementById("view-setup");
const viewLocked   = document.getElementById("view-locked");
const viewUnlocked = document.getElementById("view-unlocked");
const formSetup    = document.getElementById("form-setup");
const formEditKey  = document.getElementById("form-edit-key");
const formEditNwc  = document.getElementById("form-edit-nwc");
const resetBtn     = document.getElementById("reset-vault");

// ── API ───────────────────────────────────────
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
  if (!msg) { banner.className = "banner hidden"; banner.textContent = ""; return; }
  banner.className = `banner ${type}`;
  banner.textContent = msg;
  if (type === "success") bannerTimer = setTimeout(() => showBanner(""), 4000);
}

// ── Eye toggle ────────────────────────────────
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-eye");
  if (!btn) return;
  const inp = document.getElementById(btn.dataset.target);
  if (!inp) return;
  inp.type = inp.type === "password" ? "text" : "password";
  btn.textContent = inp.type === "password" ? "👁" : "🙈";
});

// ── Tooltip ───────────────────────────────────
const tooltip = document.getElementById("tooltip");
document.addEventListener("mouseenter", (e) => {
  const btn = e.target.closest(".btn-info");
  if (!btn || !btn.dataset.tip) return;
  tooltip.textContent = btn.dataset.tip;
  tooltip.classList.remove("hidden");
  const r = btn.getBoundingClientRect();
  tooltip.style.left = Math.min(r.left, window.innerWidth - 280) + "px";
  tooltip.style.top  = (r.bottom + 8) + "px";
}, true);
document.addEventListener("mouseleave", (e) => {
  if (e.target.closest(".btn-info")) tooltip.classList.add("hidden");
}, true);

// ── PIN pad builder ───────────────────────────
function buildPinPad(dotsEl, padEl, onComplete) {
  let digits = "";

  // Build 6 empty dots
  dotsEl.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const d = document.createElement("div");
    d.className = "pin-dot";
    dotsEl.appendChild(d);
  }

  // Build numeric keypad: 1-9, empty, 0, del
  padEl.innerHTML = "";
  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  keys.forEach((k) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = k;
    if (k === "") {
      btn.className = "pin-key key-empty";
    } else if (k === "⌫") {
      btn.className = "pin-key key-del";
    } else {
      btn.className = "pin-key";
    }
    btn.addEventListener("click", () => {
      if (k === "⌫") {
        if (digits.length > 0) {
          digits = digits.slice(0, -1);
          updateDots();
        }
      } else if (k !== "" && digits.length < 6) {
        digits += k;
        flashDot(digits.length - 1);
      }
    });
    padEl.appendChild(btn);
  });

  function updateDots() {
    const dots = dotsEl.querySelectorAll(".pin-dot");
    dots.forEach((d, i) => {
      d.classList.toggle("filled", i < digits.length);
      d.classList.remove("flash");
    });
  }

  function flashDot(idx) {
    const dots = dotsEl.querySelectorAll(".pin-dot");
    const dot = dots[idx];
    dot.classList.add("flash");
    dot.classList.remove("filled");
    setTimeout(() => {
      dot.classList.remove("flash");
      updateDots();
      if (digits.length === 6) {
        setTimeout(() => onComplete(digits), 180);
      }
    }, 120);
  }

  function reset() {
    digits = "";
    updateDots();
  }

  return { reset, getValue: () => digits };
}

// ── Setup PIN flow ────────────────────────────
let setupPin1 = "";
let setupPinPad1, setupPinPad2;

function initSetupPin() {
  const dotsEnter   = document.getElementById("pin-dots-enter");
  const padEnter    = document.getElementById("pin-pad-enter");
  const dotsConfirm = document.getElementById("pin-dots-confirm");
  const padConfirm  = document.getElementById("pin-pad-confirm");
  const stepEnter   = document.getElementById("pin-step-enter");
  const stepConfirm = document.getElementById("pin-step-confirm");
  const stepOk      = document.getElementById("pin-step-ok");
  const submitBtn   = document.getElementById("btn-setup");

  setupPin1 = "";

  setupPinPad1 = buildPinPad(dotsEnter, padEnter, (pin) => {
    setupPin1 = pin;
    stepEnter.classList.add("hidden");
    stepConfirm.classList.remove("hidden");
    setupPinPad2.reset();
  });

  setupPinPad2 = buildPinPad(dotsConfirm, padConfirm, (pin) => {
    if (pin !== setupPin1) {
      showBanner("Les codes PIN ne correspondent pas. Recommencez.", "error");
      setupPin1 = "";
      stepConfirm.classList.add("hidden");
      stepEnter.classList.remove("hidden");
      setupPinPad1.reset();
      return;
    }
    stepConfirm.classList.add("hidden");
    stepOk.classList.remove("hidden");
    submitBtn.disabled = false;
  });
}

// ── Unlock PIN / passphrase flow ─────────────
let unlockPinPad;

function initUnlockPin() {
  const dotsEl = document.getElementById("pin-dots-unlock");
  const padEl  = document.getElementById("pin-pad-unlock");

  unlockPinPad = buildPinPad(dotsEl, padEl, async (pin) => {
    try {
      const state = await api({ action: "unlockVault", password: pin });
      showBanner("");
      await refresh();
      if (state.hasNwc) api({ action: "refreshWalletBalance" }).then(refresh).catch(() => {});
    } catch (err) {
      showBanner(err.message);
      unlockPinPad.reset();
    }
  });
}

document.getElementById("options-form-unlock-passphrase").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("options-unlock-passphrase");
  const btn = e.target.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const state = await api({ action: "unlockVault", password: input.value });
    showBanner("");
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

document.getElementById("btn-reset-from-lock-options").addEventListener("click", async () => {
  if (!window.confirm("Supprimer la configuration et effacer la clé privée de ce navigateur ?")) return;
  try {
    await api({ action: "resetVault" });
    showBanner("Extension réinitialisée.", "success");
    await refresh();
  } catch (err) { showBanner(err.message); }
});

// ── Render state ──────────────────────────────
function renderState(state) {
  showBanner("");
  viewSetup.classList.add("hidden");
  viewLocked.classList.add("hidden");
  viewUnlocked.classList.add("hidden");

  if (!state.configured) {
    viewSetup.classList.remove("hidden");
    initSetupPin();
    return;
  }
  if (!state.unlocked) {
    viewLocked.classList.remove("hidden");
    if (state.authMode === "passphrase") {
      document.getElementById("options-unlock-pin-wrap").classList.add("hidden");
      document.getElementById("options-unlock-passphrase-wrap").classList.remove("hidden");
      document.getElementById("options-lock-subtitle").textContent = "Entrez votre passphrase pour reprendre";
      document.getElementById("options-unlock-passphrase").focus();
    } else {
      document.getElementById("options-unlock-pin-wrap").classList.remove("hidden");
      document.getElementById("options-unlock-passphrase-wrap").classList.add("hidden");
      document.getElementById("options-lock-subtitle").textContent = "Entrez votre code PIN pour reprendre";
      initUnlockPin();
    }
    return;
  }

  viewUnlocked.classList.remove("hidden");
  document.getElementById("npub-short").textContent = state.npubShort || "";
  document.getElementById("npub-full").textContent  = state.npub || "";
  document.getElementById("nwc-display").textContent =
    state.hasNwc ? state.nwcMasked : "Non configuré";

  const balRow = document.getElementById("balance-row");
  if (state.hasNwc) {
    balRow.classList.remove("hidden");
    document.getElementById("balance-val").textContent =
      state.balanceLabel ? `${state.balanceLabel} sats` : "Solde indisponible";
    document.getElementById("send-section").classList.remove("hidden");
  } else {
    balRow.classList.add("hidden");
    document.getElementById("send-section").classList.add("hidden");
  }

  renderSites(state.permissions || []);
  loadNostrProfile();
  loadTxHistory();
}

function renderSites(perms) {
  const list = document.getElementById("sites-list");
  list.innerHTML = "";
  if (!perms.length) {
    list.innerHTML = '<li class="sites-empty">Aucun site autorisé.</li>';
    return;
  }
  perms.forEach((p) => {
    const li = document.createElement("li");
    li.className = "site-item";
    li.innerHTML = `
      <div>
        <div class="site-name">${p.host}</div>
        <div class="site-src">${p.source === "default" ? "Pré-autorisé par défaut" : "Autorisé via prompt"}</div>
      </div>
      <button class="btn-revoke" type="button" data-host="${p.host}">Révoquer</button>`;
    list.appendChild(li);
  });
}

function loadNostrProfile() {
  api({ action: "getNostrProfile" }).then((profile) => {
    if (!profile) return;
    const nameEl     = document.getElementById("profile-name");
    const subEl      = document.getElementById("profile-sub");
    const nip05El    = document.getElementById("profile-nip05");
    const picEl      = document.getElementById("profile-pic");
    const fallbackEl = document.getElementById("profile-fallback");

    if (profile.name) {
      nameEl.textContent = profile.name;
      nameEl.classList.remove("hidden");
      subEl.classList.add("hidden");
    }
    if (profile.nip05) {
      nip05El.textContent = profile.nip05;
      nip05El.classList.remove("hidden");
    }
    // Image distante non chargée automatiquement (risque de tracking/IP leak)
  }).catch(() => {});
}

async function refresh() {
  const state = await api({ action: "getState" });
  renderState(state);
  return state;
}

// ── Auth mode toggle ──────────────────────────
document.querySelectorAll("[name=s-auth-mode]").forEach((radio) => {
  radio.addEventListener("change", () => {
    const mode = document.querySelector("[name=s-auth-mode]:checked")?.value || "pin";
    document.getElementById("setup-pin-field").classList.toggle("hidden", mode !== "pin");
    document.getElementById("setup-passphrase-field").classList.toggle("hidden", mode !== "passphrase");
    const submitBtn = document.getElementById("btn-setup");
    if (submitBtn) submitBtn.disabled = (mode === "pin");
    if (mode === "pin") initSetupPin();
  });
});

function getPassphraseStrengthMsg(p) {
  if (p.length < 16) return { ok: false, msg: `${p.length}/16 caractères minimum` };
  if (!/[A-Z]/.test(p)) return { ok: false, msg: "Ajouter au moins une majuscule" };
  if (!/[a-z]/.test(p)) return { ok: false, msg: "Ajouter au moins une minuscule" };
  if (!/[\d\W_]/.test(p)) return { ok: false, msg: "Ajouter au moins un chiffre ou symbole" };
  return { ok: true, msg: "✓ Passphrase valide" };
}

function updatePassphraseState() {
  const val     = document.getElementById("s-passphrase")?.value || "";
  const confirm = document.getElementById("s-passphrase-confirm")?.value || "";
  const strengthEl = document.getElementById("s-passphrase-strength");
  const confirmEl  = document.getElementById("s-passphrase-confirm-msg");
  const submitBtn  = document.getElementById("btn-setup");

  const { ok, msg } = getPassphraseStrengthMsg(val);
  if (strengthEl) { strengthEl.textContent = msg; strengthEl.className = `passphrase-strength ${ok ? "ok" : "weak"}`; }

  let confirmOk = false;
  if (ok && confirm.length > 0) {
    confirmOk = val === confirm;
    if (confirmEl) {
      confirmEl.textContent = confirmOk ? "✓ Passphrases identiques" : "Les passphrases ne correspondent pas";
      confirmEl.className   = `passphrase-strength ${confirmOk ? "ok" : "weak"}`;
    }
  } else if (confirmEl) {
    confirmEl.textContent = "";
    confirmEl.className   = "passphrase-strength";
  }

  if (submitBtn) submitBtn.disabled = !(ok && confirmOk);
}

const passphraseInput = document.getElementById("s-passphrase");
if (passphraseInput) passphraseInput.addEventListener("input", updatePassphraseState);

const passphraseConfirm = document.getElementById("s-passphrase-confirm");
if (passphraseConfirm) passphraseConfirm.addEventListener("input", updatePassphraseState);

// ── Setup form submit ─────────────────────────
formSetup.addEventListener("submit", async (e) => {
  e.preventDefault();
  const authMode = document.querySelector("[name=s-auth-mode]:checked")?.value || "pin";
  let password;
  if (authMode === "pin") {
    if (!setupPin1) { showBanner("Définissez un code PIN d'abord."); return; }
    password = setupPin1;
  } else {
    password = document.getElementById("s-passphrase")?.value || "";
    const { ok, msg } = getPassphraseStrengthMsg(password);
    if (!ok) { showBanner(msg); return; }
    const confirm = document.getElementById("s-passphrase-confirm")?.value || "";
    if (password !== confirm) { showBanner("Les passphrases ne correspondent pas."); return; }
  }
  const btn = formSetup.querySelector("[type=submit]");
  btn.disabled = true; btn.textContent = "Chiffrement…";
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
    showBanner("Configuration enregistrée.", "success");
    await refresh();
  } catch (err) {
    showBanner(err.message);
    btn.disabled = false; btn.textContent = "Valider →";
  }
});

// ── Lock ──────────────────────────────────────
document.getElementById("btn-lock").addEventListener("click", async () => {
  await api({ action: "lockVault" });
  await refresh();
});

// ── Edit key ──────────────────────────────────
document.getElementById("btn-edit-key").addEventListener("click", () => {
  formEditKey.classList.toggle("hidden");
});
document.getElementById("btn-cancel-key").addEventListener("click", () => {
  formEditKey.classList.add("hidden"); formEditKey.reset();
});
formEditKey.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api({ action: "updatePrivateKey", privateKey: document.getElementById("e-key").value });
    formEditKey.reset(); formEditKey.classList.add("hidden");
    showBanner("Clé mise à jour.", "success");
    await refresh();
  } catch (err) { showBanner(err.message); }
});

// ── Edit NWC ──────────────────────────────────
document.getElementById("btn-edit-nwc").addEventListener("click", () => {
  formEditNwc.classList.toggle("hidden");
});
document.getElementById("btn-cancel-nwc").addEventListener("click", () => {
  formEditNwc.classList.add("hidden"); formEditNwc.reset();
});
formEditNwc.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api({ action: "updateNwcUri", nwcUri: document.getElementById("e-nwc").value });
    formEditNwc.classList.add("hidden");
    showBanner("Wallet mis à jour.", "success");
    await refresh();
  } catch (err) { showBanner(err.message); }
});

// ── Refresh balance ───────────────────────────
document.getElementById("btn-refresh-bal").addEventListener("click", async () => {
  const btn = document.getElementById("btn-refresh-bal");
  btn.style.opacity = ".4";
  try {
    await api({ action: "refreshWalletBalance" });
    await refresh();
  } catch (err) { showBanner(err.message); }
  finally { btn.style.opacity = ""; }
});

// ── Revoke site ───────────────────────────────
document.getElementById("sites-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-host]");
  if (!btn) return;
  try {
    await api({ action: "revokePermission", host: btn.dataset.host });
    await refresh();
  } catch (err) { showBanner(err.message); }
});

// ── Reset vault ───────────────────────────────
resetBtn.addEventListener("click", async () => {
  if (!window.confirm("Supprimer la configuration et effacer la clé privée de ce navigateur ?")) return;
  try {
    await api({ action: "resetVault" });
    showBanner("Extension réinitialisée.", "success");
    await refresh();
  } catch (err) { showBanner(err.message); }
});

// ── Transaction history ───────────────────────
function renderTxHistory(txs) {
  const list = document.getElementById("tx-history-list");
  list.innerHTML = "";
  const recent = (txs || []).slice(0, 20);
  if (!recent.length) {
    list.innerHTML = '<li class="tx-empty">Aucune transaction pour l\'instant.</li>';
    return;
  }
  recent.forEach((tx) => {
    const li = document.createElement("li");
    li.className = "tx-item";
    const date = new Date(tx.timestamp);
    const dateStr = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })
      + " " + date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    const iconEl = document.createElement("div");
    iconEl.className = "tx-icon";
    iconEl.textContent = tx.type === "zap" ? "⚡" : "↗";

    const infoEl = document.createElement("div");
    infoEl.className = "tx-info";
    const recipientEl = document.createElement("div");
    recipientEl.className = "tx-recipient";
    recipientEl.textContent = String(tx.recipient || tx.host || "Inconnu").slice(0, 50);
    const metaEl = document.createElement("div");
    metaEl.className = "tx-meta";
    metaEl.textContent = dateStr;
    infoEl.appendChild(recipientEl);
    infoEl.appendChild(metaEl);

    const amountStr = tx.amountSats != null ? `${tx.amountSats.toLocaleString("fr-FR")} sats` : "? sats";
    const amountEl = document.createElement("div");
    amountEl.className = "tx-amount" + (tx.preimageVerified ? "" : " unverified");
    amountEl.textContent = amountStr;
    if (tx.preimageVerified) {
      const checkEl = document.createElement("span");
      checkEl.className = "tx-verified";
      checkEl.title = "Preimage cryptographiquement vérifié";
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
  const address   = document.getElementById("send-address").value.trim();
  const amount    = parseInt(document.getElementById("send-amount").value, 10);
  const resultEl  = document.getElementById("send-result");
  const previewEl = document.getElementById("send-preview");
  const btnConfirm = document.getElementById("btn-send-confirm");

  resultEl.className = "send-result hidden";
  previewEl.classList.add("hidden");
  btnConfirm.classList.add("hidden");
  _pendingInvoice = null;

  if (!address || !address.includes("@")) {
    resultEl.textContent = "Adresse invalide (format attendu : user@domaine.com).";
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
  btn.textContent = "Envoi en cours…";
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
    resultEl.textContent = `✓ Envoyé${res.amountSats != null ? " · " + res.amountSats.toLocaleString("fr-FR") + " sats" : ""}${res.preimageVerified ? " · preimage vérifié ✓" : ""}`;
    resultEl.className = "send-result ok";
    await refresh();
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.className = "send-result error";
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Confirmer le paiement";
  }
});

// ── Modal NWC aide ────────────────────────────
const modalNwc = document.getElementById("modal-nwc");

function openNwcModal() { modalNwc.classList.remove("hidden"); }
function closeNwcModal() { modalNwc.classList.add("hidden"); }

document.getElementById("btn-modal-close").addEventListener("click", closeNwcModal);
document.getElementById("btn-nwc-help-setup").addEventListener("click", openNwcModal);
document.getElementById("btn-nwc-help-edit").addEventListener("click", openNwcModal);
modalNwc.addEventListener("click", (e) => { if (e.target === modalNwc) closeNwcModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNwcModal(); });

// ── Init ──────────────────────────────────────
refresh().catch((err) => showBanner(err.message));
