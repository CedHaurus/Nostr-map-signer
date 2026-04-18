# Nostr Map ✦ Signer

Extension navigateur pour le protocole Nostr — signature NIP-07 et wallet Lightning via NWC.

## Fonctionnalités

- **NIP-07** — Signe, chiffre et déchiffre des événements Nostr depuis n'importe quel client compatible (`window.nostr`)
- **Wallet Lightning (NWC)** — Connectez votre wallet via Nostr Wallet Connect (NIP-47) : consultez votre solde, envoyez des sats à une adresse Lightning (`user@domaine.com`), approuvez les zaps
- **Sécurité locale** — Clé privée chiffrée AES-256-GCM avec PBKDF2-SHA256 (250 000 itérations), déverrouillage par code PIN ou passphrase
- **Verrouillage automatique** — Session effacée de la mémoire après 2 heures d'inactivité
- **Historique** — 100 dernières transactions Lightning avec vérification cryptographique du preimage
- **Gestion des permissions** — Autorisez ou révoquez l'accès par site

## Compatibilité

| Client | Support |
|--------|---------|
| Chrome / Chromium | ✓ Manifest V3 |
| Firefox | ✓ Manifest V2 |

Compatible avec tous les clients Nostr supportant NIP-07 : Nostr.com, Snort, Coracle, iris.to, Primal, nostrmap.fr…

## Installation

### Depuis les stores
- Chrome Web Store — *à venir*
- Firefox Add-ons — *à venir*

### Manuellement (développement)

```bash
git clone https://github.com/CedHaurus/Nostr-map-signer.git
cd Nostr-map-signer
npm install
bash build.sh
```

**Chrome** : `chrome://extensions` → Mode développeur → Charger l'extension non empaquetée → `dist/chrome`

**Firefox** : `about:debugging` → Cet Firefox → Charger un module temporaire → `dist/firefox/manifest.json`

## Wallets Lightning compatibles

NWC (Nostr Wallet Connect) est supporté par :
- [Alby Hub](https://albyhub.com)
- [Mutiny Wallet](https://mutinywallet.com)
- [Phoenix](https://phoenix.acinq.co)
- Umbrel / LND + Alby Hub
- Primal

## Confidentialité

Aucune donnée collectée. Aucun tracker. La clé privée ne quitte jamais le navigateur.

→ [Politique de confidentialité](https://nostrmap.fr/privacy-nostr-map-extension)

## Licence

GNU General Public License v3.0 — voir [LICENSE](LICENSE)
