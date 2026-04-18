/* global NostrTools */
if (typeof importScripts === "function") {
  importScripts("vendor/nostr.bundle.js");
}

const ext = typeof browser !== "undefined" && browser.runtime ? browser : chrome;

const APP = {
  name: "Nostr Map Signer",
  version: 1,
  lockTimeoutMs: 2 * 60 * 60 * 1000,
  confirmTimeoutMs: 60 * 1000,
  pbkdf2Iterations: 250000,
  defaultSites: {
    "nostrmap.fr": {
      host: "nostrmap.fr",
      addedAt: "default",
      source: "default",
    },
  },
};

const runtimeState = {
  privateKeyHex: null,
  publicKeyHex: null,
  aesKey: null,
  vaultSalt: null,
  nwcUri: null,
  authMode: "pin", // "pin" | "passphrase"
  lastActivityAt: 0,
  walletCache: {
    balanceMsats: null,
    lastFetchedAt: null,
    lastError: null,
  },
  nostrProfile: null,
  nostrProfileFetchedAt: null,
};

const pendingConfirmations = new Map();
const pendingZaps = new Map();
// Deduplication: host -> Promise, évite d'ouvrir plusieurs popups pour le même site
const pendingHostAuth = new Map();
// Cache session webln : hosts déjà autorisés pour cette session
const webLnEnabledHosts = new Set();
// Queue de signature par host : évite les popups simultanées pour les sites non autorisés
const signQueue = new Map();
// Brute-force protection sur unlockVault
const unlockThrottle = { failures: 0, lockedUntil: 0 };
const pool = new NostrTools.SimplePool({ enablePing: true, enableReconnect: true });
const nwcInfoCache = new Map(); // walletPubkey → { info, fetchedAt }

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function getActionApi() {
  return ext.action || ext.browserAction || null;
}

function promisify(call) {
  return new Promise((resolve, reject) => {
    try {
      call((result) => {
        const maybeError = ext.runtime && ext.runtime.lastError;
        if (maybeError) {
          reject(new Error(maybeError.message));
          return;
        }
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageGet(keys) {
  return promisify((done) => ext.storage.local.get(keys, done));
}

function storageSet(value) {
  return promisify((done) => ext.storage.local.set(value, done));
}

function storageRemove(keys) {
  return promisify((done) => ext.storage.local.remove(keys, done));
}

function windowsCreate(options) {
  return promisify((done) => ext.windows.create(options, done));
}

function windowsRemove(windowId) {
  return promisify((done) => ext.windows.remove(windowId, done)).catch(() => undefined);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("Clé hex invalide.");
  const clean = hex.toLowerCase();
  const output = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    output[index / 2] = parseInt(clean.slice(index, index + 2), 16);
  }
  return output;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function truncate(value, start = 10, end = 6) {
  if (!value || value.length <= start + end + 3) return value || "";
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function formatSats(msats) {
  if (typeof msats !== "number") return null;
  const sats = Math.floor(msats / 1000);
  return new Intl.NumberFormat("fr-FR").format(sats);
}

function maskNwcUri(uri) {
  if (!uri) return "";
  try {
    const parsed = parseNwcUri(uri);
    const relay = parsed.relays[0] || "";
    return `nostr+walletconnect://${truncate(parsed.walletPubkey, 10, 6)}?relay=${truncate(relay, 18, 8)}&secret=••••••••`;
  } catch (_error) {
    return "URI NWC invalide";
  }
}

function getHostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
}

function normalizeHost(hostname) {
  return String(hostname || "").trim().toLowerCase();
}

function isHostAuthorized(hostname, permissions, requiredScope = "read") {
  const host = normalizeHost(hostname);
  const key = Object.keys(permissions).find((k) => host === normalizeHost(k));
  if (!key) return false;
  if (requiredScope === "read") return true;
  // "sign" scope: default/pre-authorized sites always pass; user-granted sites need explicit scope
  const entry = permissions[key];
  return entry.source === "default" || entry.scope === "sign";
}

function eventKindLabel(kind) {
  const labels = {
    0:     "Mise à jour du profil",
    1:     "Publication (note)",
    2:     "Recommandation de relai",
    3:     "Liste de contacts",
    4:     "Message privé",
    5:     "Suppression de contenu",
    6:     "Repartage (repost)",
    7:     "Réaction (like / dislike)",
    9734:  "Demande de zap ⚡",
    9735:  "Confirmation de zap ⚡",
    10000: "Liste de silencieux",
    10001: "Liste d'épingles",
    10002: "Liste de relais",
    17375: "Portefeuille chiffré",
    23194: "Requête NWC (wallet)",
    23195: "Réponse NWC (wallet)",
    24133: "Connexion Nostr Connect",
    27235: "Authentification HTTP",
    30000: "Liste personnalisée",
    30001: "Collection d'épingles",
    30023: "Article long format",
    30078: "Données d'application",
  };
  return labels[kind] || `Événement technique (kind ${kind})`;
}

function touchActivity() {
  runtimeState.lastActivityAt = Date.now();
}

function isUnlocked() {
  if (!runtimeState.privateKeyHex || !runtimeState.aesKey) return false;
  if (Date.now() - runtimeState.lastActivityAt > APP.lockTimeoutMs) {
    lockVault();
    return false;
  }
  return true;
}

function requireUnlocked() {
  if (!isUnlocked()) {
    throw new Error("Extension verrouillee. Ouvrez le popup pour deverrouiller.");
  }
  touchActivity();
}

function lockVault() {
  runtimeState.privateKeyHex = null;
  runtimeState.publicKeyHex = null;
  runtimeState.aesKey = null;
  runtimeState.vaultSalt = null;
  runtimeState.nwcUri = null;
  runtimeState.lastActivityAt = 0;
  runtimeState.walletCache = {
    balanceMsats: null,
    lastFetchedAt: null,
    lastError: null,
  };
  webLnEnabledHosts.clear();
  nwcInfoCache.clear();
  updateBadge();
}

function updateBadge() {
  const actionApi = getActionApi();
  if (!actionApi || !actionApi.setBadgeText) return;
  if (isUnlocked()) {
    actionApi.setBadgeText({ text: "  " });
    actionApi.setBadgeBackgroundColor({ color: "#10b981" });
  } else {
    actionApi.setBadgeText({ text: "  " });
    actionApi.setBadgeBackgroundColor({ color: "#ef4444" });
  }
}

async function ensureDefaultPermissions() {
  const storage = await storageGet({ sitePermissions: null });
  if (storage.sitePermissions) return storage.sitePermissions;
  await storageSet({ sitePermissions: APP.defaultSites });
  return APP.defaultSites;
}

async function getSitePermissions() {
  const storage = await storageGet({ sitePermissions: null });
  if (!storage.sitePermissions) {
    return ensureDefaultPermissions();
  }
  return storage.sitePermissions;
}

async function saveSitePermissions(sitePermissions) {
  await storageSet({ sitePermissions });
  return sitePermissions;
}

async function grantSitePermission(hostname, source = "user", scope = "sign") {
  const permissions = await getSitePermissions();
  permissions[hostname] = {
    host: hostname,
    addedAt: new Date().toISOString(),
    source,
    scope,
  };
  await saveSitePermissions(permissions);
}

async function revokeSitePermission(hostname) {
  const permissions = await getSitePermissions();
  delete permissions[hostname];
  await saveSitePermissions(permissions);
}

async function deriveAesKey(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: APP.pbkdf2Iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptVaultData(data, aesKey, saltBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = textEncoder.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);
  return {
    version: APP.version,
    kdf: "PBKDF2-SHA256",
    iterations: APP.pbkdf2Iterations,
    salt: bytesToBase64(saltBytes),
    iv: bytesToBase64(new Uint8Array(iv)),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  };
}

async function decryptVaultData(vault, password) {
  const saltBytes = base64ToBytes(vault.salt);
  const aesKey = await deriveAesKey(password, saltBytes);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(vault.iv),
    },
    aesKey,
    base64ToBytes(vault.ciphertext)
  );
  const data = JSON.parse(textDecoder.decode(new Uint8Array(decrypted)));
  return { data, aesKey, saltBytes };
}

function normalizePrivateKey(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("La cle privee est obligatoire.");

  if (/^[0-9a-f]{64}$/i.test(value)) {
    return value.toLowerCase();
  }

  if (value.startsWith("nsec")) {
    const decoded = NostrTools.nip19.decode(value);
    if (decoded.type !== "nsec") throw new Error("Format nsec invalide.");
    return bytesToHex(decoded.data);
  }

  throw new Error("Format de cle non supporte. Utilisez nsec ou hex.");
}

function parseNwcUri(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  let parsed;
  try { parsed = new URL(raw); } catch (_) {
    throw new Error("URI NWC invalide. Format attendu : nostr+walletconnect://…");
  }
  const walletPubkey = (parsed.host || parsed.pathname.replace(/^\//, "")).trim();
  const secret = parsed.searchParams.get("secret");
  const relays = parsed.searchParams.getAll("relay").filter(Boolean);

  if (!/^nostr\+walletconnect:$/i.test(parsed.protocol)) {
    throw new Error("URI NWC invalide.");
  }

  if (!/^[0-9a-f]{64}$/i.test(walletPubkey) || !secret || !relays.length) {
    throw new Error("URI NWC incomplete.");
  }

  return {
    walletPubkey: walletPubkey.toLowerCase(),
    secret: normalizePrivateKey(secret),
    relays,
    raw,
  };
}

async function persistVault() {
  if (!runtimeState.aesKey || !runtimeState.privateKeyHex || !runtimeState.publicKeyHex || !runtimeState.vaultSalt) {
    throw new Error("Session de chiffrement indisponible.");
  }

  const vaultData = {
    privateKeyHex: runtimeState.privateKeyHex,
    publicKeyHex: runtimeState.publicKeyHex,
    nwcUri: runtimeState.nwcUri || "",
    authMode: runtimeState.authMode || "pin",
  };

  const vault = await encryptVaultData(vaultData, runtimeState.aesKey, runtimeState.vaultSalt);
  await storageSet({ vault });
}

function validateAuth(password, authMode) {
  if (authMode === "passphrase") {
    if (!password || password.length < 16)
      throw new Error("La passphrase doit contenir au moins 16 caractères.");
    if (!/[A-Z]/.test(password))
      throw new Error("La passphrase doit contenir au moins une majuscule.");
    if (!/[a-z]/.test(password))
      throw new Error("La passphrase doit contenir au moins une minuscule.");
    if (!/[\d\W_]/.test(password))
      throw new Error("La passphrase doit contenir au moins un chiffre ou symbole.");
  } else {
    if (!password || !/^\d{6}$/.test(password))
      throw new Error("Le code PIN doit être exactement 6 chiffres.");
  }
}

async function setupVault({ privateKey, password, nwcUri, authMode = "pin" }) {
  const normalizedPrivateKey = normalizePrivateKey(privateKey);
  validateAuth(password, authMode);

  const parsedNwc = nwcUri ? parseNwcUri(nwcUri) : null;
  const publicKeyHex = NostrTools.getPublicKey(hexToBytes(normalizedPrivateKey));
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKey(password, saltBytes);

  runtimeState.privateKeyHex = normalizedPrivateKey;
  runtimeState.publicKeyHex = publicKeyHex;
  runtimeState.aesKey = aesKey;
  runtimeState.vaultSalt = saltBytes;
  runtimeState.nwcUri = parsedNwc ? parsedNwc.raw : "";
  runtimeState.authMode = authMode;
  touchActivity();

  await persistVault();
  await storageSet({ authMode });
  await ensureDefaultPermissions();
  updateBadge();
  return getPublicState();
}

async function unlockVault(password) {
  const now = Date.now();
  if (now < unlockThrottle.lockedUntil) {
    const secs = Math.ceil((unlockThrottle.lockedUntil - now) / 1000);
    throw new Error(`Trop de tentatives. Réessayez dans ${secs}s.`);
  }

  const storage = await storageGet({ vault: null });
  if (!storage.vault) throw new Error("Aucune configuration trouvee.");

  let decrypted;
  try {
    decrypted = await decryptVaultData(storage.vault, password);
  } catch (_error) {
    unlockThrottle.failures += 1;
    if (unlockThrottle.failures >= 10) {
      unlockThrottle.lockedUntil = Date.now() + 10 * 60 * 1000; // 10 min
      unlockThrottle.failures = 0;
    } else if (unlockThrottle.failures >= 5) {
      unlockThrottle.lockedUntil = Date.now() + 60 * 1000; // 1 min
    } else if (unlockThrottle.failures >= 3) {
      unlockThrottle.lockedUntil = Date.now() + 10 * 1000; // 10 sec
    }
    throw new Error("Code incorrect.");
  }
  unlockThrottle.failures = 0;
  unlockThrottle.lockedUntil = 0;

  const { data, aesKey, saltBytes } = decrypted;

  runtimeState.privateKeyHex = data.privateKeyHex;
  runtimeState.publicKeyHex = data.publicKeyHex || NostrTools.getPublicKey(hexToBytes(data.privateKeyHex));
  runtimeState.aesKey = aesKey;
  runtimeState.vaultSalt = saltBytes;
  runtimeState.nwcUri = data.nwcUri || "";
  runtimeState.authMode = data.authMode || "pin";
  touchActivity();
  updateBadge();
  return getPublicState();
}

function getPublicState() {
  const npub = runtimeState.publicKeyHex ? NostrTools.nip19.npubEncode(runtimeState.publicKeyHex) : "";
  const balanceMsats = runtimeState.walletCache.balanceMsats;

  return {
    configured: Boolean(runtimeState.privateKeyHex) || false,
    unlocked: isUnlocked(),
    publicKeyHex: runtimeState.publicKeyHex || "",
    npub,
    npubShort: truncate(npub, 10, 6),
    hasNwc: Boolean(runtimeState.nwcUri),
    nwcMasked: maskNwcUri(runtimeState.nwcUri),
    balanceMsats,
    balanceLabel: formatSats(balanceMsats),
    walletError: runtimeState.walletCache.lastError,
    walletLastFetchedAt: runtimeState.walletCache.lastFetchedAt,
    sessionExpiresAt: runtimeState.lastActivityAt ? runtimeState.lastActivityAt + APP.lockTimeoutMs : null,
  };
}

async function getPopupState() {
  const storage = await storageGet({ vault: null, authMode: "pin" });
  const permissions = await getSitePermissions();
  const configured = Boolean(storage.vault);
  const unlocked = isUnlocked();
  const publicState = unlocked ? getPublicState() : {
    configured,
    unlocked: false,
    publicKeyHex: "",
    npub: "",
    npubShort: "",
    hasNwc: false,
    nwcMasked: "",
    balanceMsats: null,
    balanceLabel: null,
    walletError: null,
    walletLastFetchedAt: null,
    sessionExpiresAt: null,
  };

  // authMode stocké en clair pour être lisible même verrouillé
  const authMode = storage.authMode || runtimeState.authMode || "pin";

  return {
    ...publicState,
    authMode,
    configured,
    permissions: Object.values(permissions).sort((left, right) => left.host.localeCompare(right.host)),
  };
}

async function updatePrivateKey(input) {
  requireUnlocked();
  runtimeState.privateKeyHex = normalizePrivateKey(input);
  runtimeState.publicKeyHex = NostrTools.getPublicKey(hexToBytes(runtimeState.privateKeyHex));
  touchActivity();
  await persistVault();
  // Nouvelle identité → permissions de l'ancienne identité purgées
  await storageRemove(["sitePermissions", "authMode"]);
  await ensureDefaultPermissions();
  return getPopupState();
}

async function updateNwcUri(input) {
  requireUnlocked();
  runtimeState.nwcUri = input ? parseNwcUri(input).raw : "";
  runtimeState.walletCache = {
    balanceMsats: null,
    lastFetchedAt: null,
    lastError: null,
  };
  nwcInfoCache.clear();
  touchActivity();
  await persistVault();
  return getPopupState();
}

function createRequestId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function createPopupWindow(url, width, height) {
  return windowsCreate({
    url,
    type: "popup",
    width,
    height,
    focused: true,
  });
}

async function closeConfirmationOverlay(tabId) {
  if (!tabId) return;
  try { await ext.tabs.sendMessage(tabId, { action: "closeConfirmation" }); } catch (_) {}
}

async function awaitConfirmation(request) {
  const requestId = createRequestId("confirm");
  const confirmUrl = `${ext.runtime.getURL("confirm/confirm.html")}?requestId=${encodeURIComponent(requestId)}`;
  const tabId = request.tabId || null;

  return new Promise(async (resolve, reject) => {
    const timeoutId = setTimeout(async () => {
      const pending = pendingConfirmations.get(requestId);
      if (!pending) return;
      pendingConfirmations.delete(requestId);
      await closeConfirmationOverlay(pending.tabId);
      await windowsRemove(pending.windowId);
      reject(new Error("Demande expiree."));
    }, APP.confirmTimeoutMs);

    pendingConfirmations.set(requestId, {
      ...request,
      requestId,
      timeoutId,
      tabId,
      resolveDecision: async (decision) => {
        clearTimeout(timeoutId);
        const current = pendingConfirmations.get(requestId);
        pendingConfirmations.delete(requestId);
        await closeConfirmationOverlay(current?.tabId);
        await windowsRemove(current?.windowId);
        resolve(decision);
      },
      rejectDecision: async (error) => {
        clearTimeout(timeoutId);
        const current = pendingConfirmations.get(requestId);
        pendingConfirmations.delete(requestId);
        await closeConfirmationOverlay(current?.tabId);
        await windowsRemove(current?.windowId);
        reject(error);
      },
    });

    // Try inline overlay first, fall back to popup window
    let injected = false;
    if (tabId) {
      try {
        await ext.tabs.sendMessage(tabId, { action: "injectConfirmation", requestId, confirmUrl });
        injected = true;
      } catch (_) {}
    }

    if (!injected) {
      try {
        const createdWindow = await createPopupWindow(confirmUrl, 460, 460);
        const pending = pendingConfirmations.get(requestId);
        if (pending) pending.windowId = createdWindow.id;
      } catch (error) {
        clearTimeout(timeoutId);
        pendingConfirmations.delete(requestId);
        reject(error);
      }
    }
  });
}

async function awaitZapApproval(request) {
  const requestId = createRequestId("zap");
  const popupUrl = `${ext.runtime.getURL("zap/zap.html")}?requestId=${encodeURIComponent(requestId)}`;

  return new Promise(async (resolve, reject) => {
    const timeoutId = setTimeout(async () => {
      const pending = pendingZaps.get(requestId);
      if (!pending) return;
      pendingZaps.delete(requestId);
      await windowsRemove(pending.windowId);
      reject(new Error("Demande de zap expiree."));
    }, APP.confirmTimeoutMs);

    pendingZaps.set(requestId, {
      ...request,
      requestId,
      timeoutId,
      resolveDecision: async (decision) => {
        clearTimeout(timeoutId);
        const current = pendingZaps.get(requestId);
        pendingZaps.delete(requestId);
        await windowsRemove(current?.windowId);
        resolve(decision);
      },
      rejectDecision: async (error) => {
        clearTimeout(timeoutId);
        const current = pendingZaps.get(requestId);
        pendingZaps.delete(requestId);
        await windowsRemove(current?.windowId);
        reject(error);
      },
    });

    try {
      const createdWindow = await createPopupWindow(popupUrl, 420, 360);
      const pending = pendingZaps.get(requestId);
      if (pending) pending.windowId = createdWindow.id;
    } catch (error) {
      clearTimeout(timeoutId);
      pendingZaps.delete(requestId);
      reject(error);
    }
  });
}

async function confirmPublicKeyAccess(host, origin, tabId) {
  const permissions = await getSitePermissions();
  if (isHostAuthorized(host, permissions)) return true;

  // Deduplication : si une popup est déjà ouverte pour ce site, réutilise la même promesse
  if (pendingHostAuth.has(host)) {
    return pendingHostAuth.get(host);
  }

  const promise = awaitConfirmation({
    type: "pubkey",
    host,
    origin,
    tabId,
    title: "Accès à la clé publique",
    kindLabel: "Clé publique Nostr",
    contentPreview: "Ce site demande votre clé publique Nostr.",
    requestedAt: Date.now(),
    expiresAt: Date.now() + APP.confirmTimeoutMs,
    approveLabel: "Autoriser",
    rejectLabel: "Refuser",
    showAlwaysAllow: true,
  }).then((decision) => {
    pendingHostAuth.delete(host);
    if (!decision.approved) throw new Error("Accès refusé.");
    return true;
  }).catch((err) => {
    pendingHostAuth.delete(host);
    throw err;
  });

  pendingHostAuth.set(host, promise);
  return promise;
}

function sanitizeEventTemplate(template) {
  const safeKind = Number.isInteger(template?.kind) ? template.kind : 1;
  const safeTags = Array.isArray(template?.tags)
    ? template.tags
        .filter((tag) => Array.isArray(tag))
        .map((tag) => tag.map((value) => String(value)))
    : [];

  return {
    kind: safeKind,
    created_at: Number.isInteger(template?.created_at) ? template.created_at : Math.floor(Date.now() / 1000),
    tags: safeTags,
    content: typeof template?.content === "string" ? template.content : "",
  };
}

async function handleSignRequest(host, origin, eventTemplate, tabId) {
  requireUnlocked();
  const permissions = await getSitePermissions();
  const safeEvent = sanitizeEventTemplate(eventTemplate);

  // Site déjà autorisé avec scope "sign" → signer silencieusement, pas de popup
  if (isHostAuthorized(host, permissions, "sign")) {
    touchActivity();
    return NostrTools.finalizeEvent(safeEvent, hexToBytes(runtimeState.privateKeyHex));
  }

  // Site non autorisé → une seule popup à la fois par host (queue)
  const runConfirm = () => awaitConfirmation({
    type: "sign",
    host,
    origin,
    tabId,
    title: "Demande de signature",
    kind: safeEvent.kind,
    kindLabel: eventKindLabel(safeEvent.kind),
    contentPreview: safeEvent.content.slice(0, 100) || "(contenu vide)",
    tags: Array.isArray(safeEvent.tags) ? safeEvent.tags.slice(0, 12) : [],
    requestedAt: Date.now(),
    expiresAt: Date.now() + APP.confirmTimeoutMs,
    approveLabel: "Signer",
    rejectLabel: "Refuser",
    showAlwaysAllow: true,
  });

  const prev = signQueue.get(host) || Promise.resolve();
  let resolveSelf;
  const selfDone = new Promise(r => { resolveSelf = r; });
  const queued = prev.then(() => selfDone);
  signQueue.set(host, queued);

  let decision;
  try {
    await prev;
    decision = await runConfirm();
  } finally {
    resolveSelf();
    if (signQueue.get(host) === queued) signQueue.delete(host);
  }

  if (!decision.approved) throw new Error("Signature refusee.");
  touchActivity();
  return NostrTools.finalizeEvent(safeEvent, hexToBytes(runtimeState.privateKeyHex));
}

function getConversationKey(pubkey) {
  requireUnlocked();
  return NostrTools.nip44.getConversationKey(hexToBytes(runtimeState.privateKeyHex), pubkey);
}

async function handleNip44(host, operation, pubkey, value) {
  requireUnlocked();
  const permissions = await getSitePermissions();
  if (!isHostAuthorized(host, permissions, "sign")) {
    throw new Error("Site non autorisé pour le chiffrement/déchiffrement. Autorisez-le d'abord via une demande de signature.");
  }
  touchActivity();
  const conversationKey = getConversationKey(pubkey);
  if (operation === "encrypt") {
    return NostrTools.nip44.encrypt(value, conversationKey);
  }
  return NostrTools.nip44.decrypt(value, conversationKey);
}

async function fetchNwcInfo(connection) {
  const NWC_INFO_TTL = 5 * 60 * 1000;
  const cached = nwcInfoCache.get(connection.walletPubkey);
  if (cached && Date.now() - cached.fetchedAt < NWC_INFO_TTL) return cached.info;

  const infoEvent = await pool.get(connection.relays, {
    kinds: [13194],
    authors: [connection.walletPubkey],
  }, { maxWait: 5000 });

  const encryptionTag = infoEvent?.tags?.find((tag) => tag[0] === "encryption");
  const supportedEncryption = encryptionTag ? encryptionTag[1].split(/\s+/).filter(Boolean) : ["nip04"];
  const methods = (infoEvent?.content || "").split(/\s+/).filter(Boolean);

  const info = { event: infoEvent, supportedEncryption, methods };
  nwcInfoCache.set(connection.walletPubkey, { info, fetchedAt: Date.now() });
  return info;
}

function encryptNwcPayload(payload, connection, encryption) {
  const secretKeyBytes = hexToBytes(connection.secret);
  const json = JSON.stringify(payload);
  if (encryption === "nip44_v2") {
    const conversationKey = NostrTools.nip44.getConversationKey(secretKeyBytes, connection.walletPubkey);
    return NostrTools.nip44.encrypt(json, conversationKey);
  }
  return NostrTools.nip04.encrypt(secretKeyBytes, connection.walletPubkey, json);
}

function decryptNwcPayload(payload, connection, encryption) {
  const secretKeyBytes = hexToBytes(connection.secret);
  if (encryption === "nip44_v2") {
    const conversationKey = NostrTools.nip44.getConversationKey(secretKeyBytes, connection.walletPubkey);
    return NostrTools.nip44.decrypt(payload, conversationKey);
  }
  return NostrTools.nip04.decrypt(secretKeyBytes, connection.walletPubkey, payload);
}

async function callNwc(method, params = {}) {
  requireUnlocked();
  if (!runtimeState.nwcUri) throw new Error("Aucune URI NWC configuree.");

  const connection = parseNwcUri(runtimeState.nwcUri);
  const info = await fetchNwcInfo(connection);
  const encryption = info.supportedEncryption.includes("nip44_v2") ? "nip44_v2" : "nip04";
  const clientPubkey = NostrTools.getPublicKey(hexToBytes(connection.secret));

  if (info.methods.length && !info.methods.includes(method)) {
    throw new Error(`Le wallet NWC ne supporte pas ${method}.`);
  }

  const requestTemplate = {
    kind: 23194,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", connection.walletPubkey],
      ["expiration", String(Math.floor(Date.now() / 1000) + 60)],
    ],
    content: encryptNwcPayload({ method, params }, connection, encryption),
  };

  if (encryption === "nip44_v2") {
    requestTemplate.tags.unshift(["encryption", "nip44_v2"]);
  }

  const requestEvent = NostrTools.finalizeEvent(requestTemplate, hexToBytes(connection.secret));

  return new Promise((resolve, reject) => {
    let settled = false;
    const closer = pool.subscribeMany(
      connection.relays,
      {
        kinds: [23195],
        authors: [connection.walletPubkey],
        "#e": [requestEvent.id],
        "#p": [clientPubkey],
      },
      {
        maxWait: 30000,
        onevent: async (event) => {
          if (settled) return;
          settled = true;
          closer.close();
          try {
            const payload = JSON.parse(decryptNwcPayload(event.content, connection, encryption));
            if (payload.error) {
              reject(new Error(payload.error.message || payload.error.code || "Erreur NWC."));
              return;
            }
            resolve(payload.result || null);
          } catch (error) {
            reject(error);
          }
        },
        onclose: (reasons) => {
          if (settled) return;
          settled = true;
          const reason = (reasons || []).filter(Boolean).join(", ").toLowerCase();
          let msg;
          if (!reason || reason.includes("timeout") || reason.includes("maxwait")) {
            msg = "Wallet injoignable (timeout). Vérifiez votre connexion ou le statut de votre wallet.";
          } else if (reason.includes("auth") || reason.includes("unauthorized") || reason.includes("forbidden")) {
            msg = "Connexion NWC refusée. Vérifiez votre URI NWC.";
          } else if (reason.includes("not support") || reason.includes("unsupport")) {
            msg = `Méthode ${method} non supportée par ce wallet.`;
          } else {
            msg = `Relai inaccessible : ${reason}`;
          }
          reject(new Error(msg));
        },
      }
    );

    const publishResults = pool.publish(connection.relays, requestEvent);
    Promise.allSettled(publishResults).then((results) => {
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected && !settled) {
        settled = true;
        closer.close();
        reject(new Error("Publication NWC impossible."));
      }
    });
  });
}

async function callNwcWithRetry(method, params = {}) {
  const MAX_RETRIES = 2;
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await callNwc(method, params);
    } catch (err) {
      lastError = err;
      const msg = err.message || "";
      const retryable = msg.includes("timeout") || msg.includes("injoignable") || msg.includes("inaccessible");
      if (!retryable || attempt === MAX_RETRIES - 1) throw err;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function refreshWalletBalance() {
  const result = await callNwc("get_balance", {});
  runtimeState.walletCache = {
    balanceMsats: typeof result?.balance === "number" ? result.balance : null,
    lastFetchedAt: new Date().toISOString(),
    lastError: null,
  };
  touchActivity();
  return {
    balanceMsats: runtimeState.walletCache.balanceMsats,
    balanceLabel: formatSats(runtimeState.walletCache.balanceMsats),
    walletLastFetchedAt: runtimeState.walletCache.lastFetchedAt,
  };
}

async function resolveLightningAddress(address, amountMsats) {
  const atIdx = address.indexOf("@");
  if (atIdx < 1) throw new Error("Adresse Lightning invalide (format attendu : user@domaine.com).");
  const user = address.slice(0, atIdx);
  const domain = address.slice(atIdx + 1);
  if (!domain) throw new Error("Adresse Lightning invalide.");

  const lnurlRes = await fetch(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`);
  if (!lnurlRes.ok) throw new Error(`Adresse Lightning introuvable (${domain}).`);
  const lnurl = await lnurlRes.json();
  if (lnurl.status === "ERROR") throw new Error(lnurl.reason || "Erreur LNURL.");
  if (typeof lnurl.minSendable !== "number" || typeof lnurl.maxSendable !== "number") {
    throw new Error("Réponse LNURL invalide.");
  }
  if (amountMsats < lnurl.minSendable || amountMsats > lnurl.maxSendable) {
    const minSats = Math.ceil(lnurl.minSendable / 1000);
    const maxSats = Math.floor(lnurl.maxSendable / 1000);
    throw new Error(`Montant hors limites pour cette adresse : min ${minSats} sats, max ${maxSats} sats.`);
  }

  let callbackUrl;
  try { callbackUrl = new URL(lnurl.callback); } catch (_) { throw new Error("LNURL callback malformé."); }
  if (callbackUrl.protocol !== "https:") throw new Error("LNURL callback invalide : HTTPS requis.");
  if (callbackUrl.hostname !== domain) throw new Error(`LNURL callback invalide : domaine inattendu (${callbackUrl.hostname}).`);

  const sep = lnurl.callback.includes("?") ? "&" : "?";
  const invRes = await fetch(`${lnurl.callback}${sep}amount=${amountMsats}`);
  if (!invRes.ok) throw new Error("Impossible d'obtenir une invoice depuis cette adresse Lightning.");
  const inv = await invRes.json();
  if (inv.status === "ERROR") throw new Error(inv.reason || "Erreur lors de la génération de l'invoice.");
  if (!inv.pr) throw new Error("Invoice Lightning absente dans la réponse LNURL.");
  return inv.pr;
}

async function addTransactionRecord(record) {
  const storage = await storageGet({ txHistory: [] });
  const history = Array.isArray(storage.txHistory) ? storage.txHistory : [];
  history.unshift({ ...record, id: crypto.randomUUID(), timestamp: Date.now() });
  if (history.length > 100) history.splice(100);
  await storageSet({ txHistory: history });
}

async function getTransactionHistory() {
  const storage = await storageGet({ txHistory: [] });
  return Array.isArray(storage.txHistory) ? storage.txHistory : [];
}

async function getNostrProfile() {
  requireUnlocked();
  const CACHE_TTL = 5 * 60 * 1000;
  if (runtimeState.nostrProfile && runtimeState.nostrProfileFetchedAt &&
      Date.now() - runtimeState.nostrProfileFetchedAt < CACHE_TTL) {
    return runtimeState.nostrProfile;
  }
  const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];
  let event = null;
  try {
    event = await pool.get(relays, { kinds: [0], authors: [runtimeState.publicKeyHex] });
  } catch (_) { /* relay unavailable */ }
  if (!event) return null;
  let meta = {};
  try { meta = JSON.parse(event.content); } catch (_) { return null; }
  runtimeState.nostrProfile = {
    name:        meta.display_name || meta.name || null,
    handle:      meta.name || null,
    picture:     meta.picture || null,
    nip05:       meta.nip05 || null,
    about:       meta.about || null,
  };
  runtimeState.nostrProfileFetchedAt = Date.now();
  return runtimeState.nostrProfile;
}

function decodeBolt11(invoice) {
  try {
    const lower = invoice.toLowerCase();
    const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    const sepIdx = lower.lastIndexOf("1");
    if (sepIdx < 6) return null;
    const hrp = lower.slice(0, sepIdx);
    const dataStr = lower.slice(sepIdx + 1);
    if (!/^ln(?:bc|tb|bcrt)/.test(hrp)) return null;

    let amountSats = null;
    const amtMatch = hrp.match(/^ln(?:bc|tb|bcrt)(\d+)([munp])?$/);
    if (amtMatch && amtMatch[1]) {
      const amount = parseInt(amtMatch[1], 10);
      const mult = amtMatch[2];
      const btc = mult === "m" ? amount * 0.001
        : mult === "u" ? amount * 0.000001
        : mult === "n" ? amount * 0.000000001
        : mult === "p" ? amount * 0.000000000001
        : amount;
      amountSats = Math.round(btc * 100_000_000);
    }

    const data5 = dataStr.split("").map((c) => CHARSET.indexOf(c));
    if (data5.some((v) => v < 0)) return { amountSats, timestamp: null, expirySecs: 3600, paymentHash: null };

    // Last 104 groups = 520-bit signature
    const payload = data5.slice(0, -104);
    if (payload.length < 7) return { amountSats, timestamp: null, expirySecs: 3600, paymentHash: null };

    let timestamp = 0;
    for (let i = 0; i < 7; i++) timestamp = timestamp * 32 + payload[i];

    let expirySecs = 3600;
    let paymentHash = null;
    let pos = 7;

    while (pos + 2 < payload.length) {
      const type = payload[pos];
      const dataLen = payload[pos + 1] * 32 + payload[pos + 2];
      pos += 3;
      if (pos + dataLen > payload.length) break;

      if (type === 6) {
        let exp = 0;
        for (let i = 0; i < dataLen; i++) exp = exp * 32 + payload[pos + i];
        expirySecs = exp;
      } else if (type === 1 && dataLen === 52) {
        // Payment hash: 52 groups × 5 bits = 260 bits, first 256 used
        const bits = [];
        for (let i = 0; i < dataLen; i++) {
          const v = payload[pos + i];
          bits.push((v >> 4) & 1, (v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1);
        }
        const hashBytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
          let byte = 0;
          for (let b = 0; b < 8; b++) byte = byte * 2 + bits[i * 8 + b];
          hashBytes[i] = byte;
        }
        paymentHash = bytesToHex(hashBytes);
      }
      pos += dataLen;
    }

    return { amountSats, timestamp, expirySecs, paymentHash };
  } catch (_) {
    return null;
  }
}

function validateInvoice(invoice) {
  const decoded = decodeBolt11(invoice);
  if (!decoded) throw new Error("Invoice Lightning invalide ou non reconnue.");
  if (decoded.timestamp !== null) {
    const expiresAtSecs = decoded.timestamp + decoded.expirySecs;
    const nowSecs = Math.floor(Date.now() / 1000);
    if (nowSecs > expiresAtSecs) {
      const minutesAgo = Math.round((nowSecs - expiresAtSecs) / 60);
      throw new Error(`Invoice expirée il y a ${minutesAgo} min. Demandez une nouvelle invoice au destinataire.`);
    }
  }
  return decoded;
}

async function verifyPreimage(preimage, paymentHash) {
  if (!preimage || !paymentHash || preimage.length !== 64 || paymentHash.length !== 64) return false;
  try {
    const preimageBytes = hexToBytes(preimage);
    const hashBuffer = await crypto.subtle.digest("SHA-256", preimageBytes);
    return bytesToHex(new Uint8Array(hashBuffer)) === paymentHash.toLowerCase();
  } catch (_) {
    return false;
  }
}

async function confirmAndPayInvoice(host, origin, tabId, invoice, sats) {
  const decoded = validateInvoice(invoice);
  const resolvedSats = decoded.amountSats ?? sats;
  const satsLabel = resolvedSats != null ? `${resolvedSats.toLocaleString("fr-FR")} sats` : "montant inconnu";

  const decision = await awaitConfirmation({
    type: "sign",
    host,
    origin,
    tabId,
    title: "Paiement Lightning",
    kindLabel: `⚡ Paiement de ${satsLabel}`,
    amountSats: resolvedSats ?? null,
    contentPreview: invoice.slice(0, 60) + "…",
    requestedAt: Date.now(),
    expiresAt: Date.now() + APP.confirmTimeoutMs,
    showAlwaysAllow: false,
  });
  if (!decision.approved) throw new Error("Paiement refusé.");
  touchActivity();

  const result = await callNwcWithRetry("pay_invoice", { invoice });
  const preimage = result?.preimage || "";

  const verified = await verifyPreimage(preimage, decoded.paymentHash);
  await addTransactionRecord({
    type: "payment",
    host,
    amountSats: resolvedSats,
    preimage,
    preimageVerified: verified,
    invoice: invoice.slice(0, 80),
  });

  return { preimage };
}

async function requestZapFromSite(host, origin, payload) {
  requireUnlocked();
  const permissions = await getSitePermissions();
  if (!isHostAuthorized(host, permissions, "sign")) {
    throw new Error("Site non autorisé pour les zaps.");
  }
  if (!runtimeState.nwcUri) throw new Error("Aucune connexion NWC configurée.");

  // Résoudre Lightning Address → invoice si nécessaire
  let invoice = String(payload?.invoice || "").trim();
  const lightningAddress = String(payload?.lightningAddress || "").trim();
  if (!invoice && lightningAddress) {
    const amountSats = Number.isFinite(payload?.amountSats) ? Number(payload.amountSats) : null;
    if (!amountSats || amountSats <= 0) throw new Error("Montant requis pour zapper via adresse Lightning.");
    invoice = await resolveLightningAddress(lightningAddress, amountSats * 1000);
  }
  if (!invoice) throw new Error("Invoice Lightning manquante.");

  // Toujours valider depuis la BOLT-11 — ne jamais faire confiance au site
  const decoded = validateInvoice(invoice);
  const decodedSats = decoded.amountSats;
  if (decodedSats === null) throw new Error("Invoice sans montant non supportée pour les zaps.");

  const claimedSats = Number.isFinite(payload?.amountSats) ? Number(payload.amountSats) : null;
  if (claimedSats !== null && Math.abs(claimedSats - decodedSats) > 1) {
    throw new Error(`Montant affiché (${claimedSats} sats) ≠ montant réel de l'invoice (${decodedSats} sats). Paiement bloqué.`);
  }

  let balanceMsats = runtimeState.walletCache.balanceMsats;
  if (typeof balanceMsats !== "number") {
    try {
      const balance = await refreshWalletBalance();
      balanceMsats = balance.balanceMsats;
    } catch (_) {
      balanceMsats = null;
    }
  }

  const insufficientBalance = typeof balanceMsats === "number" && decodedSats * 1000 > balanceMsats;
  const recipient = String(payload?.recipient || lightningAddress || "Destinataire inconnu");

  const decision = await awaitZapApproval({
    host,
    origin,
    invoice,
    recipient,
    amountSats: decodedSats,
    balanceMsats,
    insufficientBalance,
    requestedAt: Date.now(),
    expiresAt: Date.now() + APP.confirmTimeoutMs,
  });

  if (!decision.approved) throw new Error("Zap annulé.");

  const result = await callNwcWithRetry("pay_invoice", { invoice });
  touchActivity();

  const preimage = result?.preimage || "";
  const verified = await verifyPreimage(preimage, decoded.paymentHash);
  await addTransactionRecord({
    type: "zap",
    host,
    recipient,
    amountSats: decodedSats,
    preimage,
    preimageVerified: verified,
    invoice: invoice.slice(0, 80),
  });

  return result;
}

async function handlePageBridge(message, sender) {
  const host = getHostFromUrl(sender?.tab?.url || sender?.url || "");
  const origin = sender?.tab?.url || sender?.url || "";

  if (!host) throw new Error("Origine du site inconnue.");

  const tabId = sender?.tab?.id || null;

  if (message.method === "getPublicKey") {
    requireUnlocked();
    await confirmPublicKeyAccess(host, origin, tabId);
    return runtimeState.publicKeyHex;
  }

  if (message.method === "signEvent") {
    return handleSignRequest(host, origin, message.params?.event || {}, tabId);
  }

  if (message.method === "nip44.encrypt") {
    return handleNip44(host, "encrypt", message.params?.pubkey, message.params?.plaintext);
  }

  if (message.method === "nip44.decrypt") {
    return handleNip44(host, "decrypt", message.params?.pubkey, message.params?.ciphertext);
  }

  if (message.method === "requestZap") {
    return requestZapFromSite(host, origin, message.params || {});
  }

  if (message.method === "resolveInvoice") {
    requireUnlocked();
    const { lightningAddress, amountSats } = message.params || {};
    if (!lightningAddress) throw new Error("Adresse Lightning manquante.");
    if (!Number.isFinite(amountSats) || amountSats <= 0) throw new Error("Montant invalide.");
    return resolveLightningAddress(lightningAddress, amountSats * 1000);
  }

  if (message.method === "webln.enable") {
    requireUnlocked();
    if (!runtimeState.nwcUri) throw new Error("Aucun wallet Lightning configuré. Ajoutez votre URI NWC dans les paramètres de l'extension.");
    if (!webLnEnabledHosts.has(host)) {
      await confirmPublicKeyAccess(host, origin, tabId);
      webLnEnabledHosts.add(host);
    }
    return { enabled: true };
  }

  if (message.method === "webln.sendPayment") {
    requireUnlocked();
    if (!runtimeState.nwcUri) throw new Error("Aucun wallet Lightning configuré.");
    if (!webLnEnabledHosts.has(host)) throw new Error("Ce site doit d'abord appeler webln.enable().");
    const invoice = message.params?.paymentRequest;
    if (!invoice) throw new Error("Facture Lightning manquante.");
    return confirmAndPayInvoice(host, origin, tabId, invoice, null);
  }

  if (message.method === "webln.makeInvoice") {
    requireUnlocked();
    if (!runtimeState.nwcUri) throw new Error("Aucun wallet Lightning configuré.");
    if (!webLnEnabledHosts.has(host)) throw new Error("Ce site doit d'abord appeler webln.enable().");
    const { amount, defaultMemo } = message.params || {};
    const amountSats = amount ? Number(amount) : null;
    const decision = await awaitConfirmation({
      type: "sign",
      host,
      origin,
      tabId,
      title: "Créer une invoice",
      kindLabel: amountSats ? `⚡ Invoice de ${amountSats.toLocaleString("fr-FR")} sats` : "⚡ Invoice Lightning",
      contentPreview: defaultMemo ? `Mémo : ${String(defaultMemo).slice(0, 80)}` : "Ce site veut créer une invoice sur votre wallet.",
      requestedAt: Date.now(),
      expiresAt: Date.now() + APP.confirmTimeoutMs,
      approveLabel: "Créer",
      rejectLabel: "Refuser",
      showAlwaysAllow: false,
    });
    if (!decision.approved) throw new Error("Création d'invoice refusée.");
    const amountMsats = amount ? Number(amount) * 1000 : undefined;
    const result = await callNwcWithRetry("make_invoice", {
      amount: amountMsats,
      description: defaultMemo || "",
    });
    if (!result?.invoice) throw new Error("Le wallet n'a pas retourné d'invoice.");
    return { paymentRequest: result.invoice };
  }

  if (message.method === "webln.keysend") {
    requireUnlocked();
    if (!runtimeState.nwcUri) throw new Error("Aucun wallet Lightning configuré.");
    if (!webLnEnabledHosts.has(host)) throw new Error("Ce site doit d'abord appeler webln.enable().");
    const { destination, amount, customRecords } = message.params || {};
    if (!destination) throw new Error("Destination keysend manquante.");
    if (!amount || amount <= 0) throw new Error("Montant keysend invalide.");
    const satsLabel = Number(amount).toLocaleString("fr-FR");
    const decision = await awaitConfirmation({
      type: "sign",
      host,
      origin,
      tabId,
      title: "Paiement Keysend",
      kindLabel: `⚡ Keysend de ${satsLabel} sats`,
      amountSats: Number(amount),
      contentPreview: `Destination : ${String(destination).slice(0, 60)}`,
      requestedAt: Date.now(),
      expiresAt: Date.now() + APP.confirmTimeoutMs,
      showAlwaysAllow: false,
    });
    if (!decision.approved) throw new Error("Keysend refusé.");
    touchActivity();
    const result = await callNwcWithRetry("pay_keysend", {
      amount: Number(amount) * 1000,
      pubkey: destination,
      ...(customRecords ? { tlv_records: customRecords } : {}),
    });
    return { preimage: result?.preimage || "" };
  }

  throw new Error("Methode inconnue.");
}

function getConfirmationPayload(requestId) {
  const request = pendingConfirmations.get(requestId);
  if (!request) throw new Error("Demande introuvable.");
  return {
    requestId,
    type: request.type,
    host: request.host,
    origin: request.origin,
    title: request.title,
    kind: request.kind,
    kindLabel: request.kindLabel,
    amountSats: request.amountSats ?? null,
    contentPreview: request.contentPreview,
    approveLabel: request.approveLabel,
    rejectLabel: request.rejectLabel,
    expiresAt: request.expiresAt,
    showAlwaysAllow: request.showAlwaysAllow,
  };
}

function getZapPayload(requestId) {
  const request = pendingZaps.get(requestId);
  if (!request) throw new Error("Demande introuvable.");
  return {
    requestId,
    host: request.host,
    origin: request.origin,
    recipient: request.recipient,
    amountSats: request.amountSats,
    balanceMsats: request.balanceMsats,
    balanceLabel: formatSats(request.balanceMsats),
    insufficientBalance: Boolean(request.insufficientBalance),
    expiresAt: request.expiresAt,
  };
}

async function respondToConfirmation(requestId, approved, alwaysAllow) {
  const request = pendingConfirmations.get(requestId);
  if (!request) throw new Error("Demande expiree.");
  if (approved && alwaysAllow && request.host) {
    // "pubkey" only → read scope; "sign" or payment → full sign scope
    const scope = request.type === "pubkey" ? "read" : "sign";
    await grantSitePermission(request.host, "prompt", scope);
  }
  await request.resolveDecision({
    approved: Boolean(approved),
    alwaysAllow: Boolean(alwaysAllow),
  });
  return true;
}

async function respondToZap(requestId, approved) {
  const request = pendingZaps.get(requestId);
  if (!request) throw new Error("Demande expiree.");
  await request.resolveDecision({ approved: Boolean(approved) });
  return true;
}

ext.runtime.onInstalled.addListener(async () => {
  await ensureDefaultPermissions().catch(() => undefined);
  updateBadge();
  // Ouvre la page de configuration uniquement si aucun vault n'existe encore
  try {
    const storage = await storageGet({ vault: null });
    if (!storage.vault && ext.runtime.openOptionsPage) {
      ext.runtime.openOptionsPage().catch(() => undefined);
    }
  } catch (_) {}
});

if (ext.runtime.onStartup) {
  ext.runtime.onStartup.addListener(() => {
    updateBadge();
  });
}

if (ext.windows && ext.windows.onRemoved) {
  ext.windows.onRemoved.addListener((windowId) => {
    for (const [requestId, request] of pendingConfirmations.entries()) {
      if (request.windowId === windowId) {
        request.rejectDecision(new Error("Fenetre fermee."));
      }
    }
    for (const [requestId, request] of pendingZaps.entries()) {
      if (request.windowId === windowId) {
        request.rejectDecision(new Error("Fenetre fermee."));
      }
    }
  });
}

if (ext.alarms && ext.alarms.onAlarm) {
  ext.alarms.create("vault-timeout-check", { periodInMinutes: 1 });
  ext.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "vault-timeout-check" && runtimeState.lastActivityAt && Date.now() - runtimeState.lastActivityAt > APP.lockTimeoutMs) {
      lockVault();
    }
  });
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") throw new Error("Message invalide.");

    switch (message.action) {
      case "getState":
        return getPopupState();
      case "setupVault":
        return setupVault(message.payload);
      case "unlockVault":
        return unlockVault(message.password);
      case "lockVault":
        lockVault();
        return getPopupState();
      case "updatePrivateKey":
        return updatePrivateKey(message.privateKey);
      case "updateNwcUri":
        return updateNwcUri(message.nwcUri);
      case "revokePermission":
        await revokeSitePermission(message.host);
        return getPopupState();
      case "refreshWalletBalance":
        return refreshWalletBalance();
      case "getNostrProfile":
        return getNostrProfile();
      case "pageBridge":
        return handlePageBridge(message, sender);
      case "getConfirmationRequest":
        return getConfirmationPayload(message.requestId);
      case "approveConfirmation":
        await respondToConfirmation(message.requestId, true, Boolean(message.alwaysAllow));
        return { ok: true };
      case "rejectConfirmation":
        await respondToConfirmation(message.requestId, false, false);
        return { ok: true };
      case "getZapRequest":
        return getZapPayload(message.requestId);
      case "approveZap":
        await respondToZap(message.requestId, true);
        return { ok: true };
      case "rejectZap":
        await respondToZap(message.requestId, false);
        return { ok: true };
      case "getTransactionHistory":
        return getTransactionHistory();
      case "payInvoiceDirect": {
        requireUnlocked();
        if (!runtimeState.nwcUri) throw new Error("Aucun wallet Lightning configuré.");
        const inv = String(message.invoice || "").trim();
        if (!inv) throw new Error("Invoice manquante.");
        const dec = validateInvoice(inv);
        const res = await callNwcWithRetry("pay_invoice", { invoice: inv });
        const pre = res?.preimage || "";
        const ver = await verifyPreimage(pre, dec.paymentHash);
        await addTransactionRecord({
          type: "payment",
          host: "popup",
          recipient: String(message.memo || "Paiement direct"),
          amountSats: dec.amountSats,
          preimage: pre,
          preimageVerified: ver,
          invoice: inv.slice(0, 80),
        });
        touchActivity();
        return { preimage: pre, amountSats: dec.amountSats, preimageVerified: ver };
      }
      case "resolveInvoiceFromLnurl": {
        requireUnlocked();
        const { lightningAddress: addr, amountSats: aSats } = message.payload || {};
        if (!addr) throw new Error("Adresse Lightning manquante.");
        if (!Number.isFinite(aSats) || aSats <= 0) throw new Error("Montant invalide.");
        return resolveLightningAddress(addr, aSats * 1000);
      }
      case "resetVault":
        lockVault();
        await storageRemove(["vault", "sitePermissions", "authMode", "txHistory"]);
        return getPopupState();
      default:
        throw new Error("Action inconnue.");
    }
  })()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "Erreur inconnue." }));

  return true;
});

ensureDefaultPermissions().catch(() => undefined);
updateBadge();
