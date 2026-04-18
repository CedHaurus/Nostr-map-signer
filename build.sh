#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
CHROME_DIR="$DIST_DIR/chrome"
FIREFOX_DIR="$DIST_DIR/firefox"

rm -rf "$CHROME_DIR" "$FIREFOX_DIR"
mkdir -p "$CHROME_DIR" "$FIREFOX_DIR"

copy_common() {
  local target="$1"
  cp "$ROOT_DIR/background.js" "$target/"
  cp "$ROOT_DIR/content-script.js" "$target/"
  cp "$ROOT_DIR/page-bridge.js" "$target/"
  cp -R "$ROOT_DIR/popup" "$target/"
  cp -R "$ROOT_DIR/options" "$target/"
  cp -R "$ROOT_DIR/confirm" "$target/"
  cp -R "$ROOT_DIR/zap" "$target/"
  cp -R "$ROOT_DIR/icons" "$target/"
  cp -R "$ROOT_DIR/vendor" "$target/"
  cp -R "$ROOT_DIR/fonts" "$target/"
}

copy_common "$CHROME_DIR"
copy_common "$FIREFOX_DIR"

ROOT_DIR="$ROOT_DIR" node <<'NODE'
const fs   = require("node:fs");
const path = require("node:path");

const root = process.env.ROOT_DIR;
const baseManifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const chromeCommands = Object.fromEntries(
  Object.entries(baseManifest.commands || {}).map(([k, v]) => [
    k === "_execute_browser_action" ? "_execute_action" : k, v
  ])
);

const chromeManifest = {
  ...baseManifest,
  manifest_version: 3,
  commands: chromeCommands,
  background: {
    service_worker: "background.js"
  },
  web_accessible_resources: [
    {
      resources: ["page-bridge.js", "confirm/*", "zap/*"],
      matches: ["<all_urls>"]
    }
  ]
};

const INVALID_FF_PERMS = new Set(["ws://*/*", "wss://*/*"]);
const ffPerms = Array.from(new Set([
  ...(baseManifest.permissions || []),
  ...(baseManifest.host_permissions || [])
])).filter(p => !INVALID_FF_PERMS.has(p));

const firefoxManifest = {
  ...baseManifest,
  manifest_version: 2,
  permissions: ffPerms,
  background: {
    scripts: ["vendor/nostr.bundle.js", "background.js"]
  },
  web_accessible_resources: ["page-bridge.js", "confirm/*", "zap/*"],
  browser_specific_settings: {
    gecko: {
      id: "nostrmap-signer@nostrmap.fr",
      strict_min_version: "109.0",
      data_collection_permissions: {
        required: [],
        optional: []
      }
    }
  }
};

delete firefoxManifest.host_permissions;
firefoxManifest.browser_action = { ...firefoxManifest.action };
delete firefoxManifest.browser_action.default_area; // Chrome-only key
delete firefoxManifest.action;

fs.writeFileSync(path.join(root, "dist", "chrome", "manifest.json"), JSON.stringify(chromeManifest, null, 2));
fs.writeFileSync(path.join(root, "dist", "firefox", "manifest.json"), JSON.stringify(firefoxManifest, null, 2));
NODE

echo "Build termine :"
echo "  Chrome  -> $CHROME_DIR"
echo "  Firefox -> $FIREFOX_DIR"
