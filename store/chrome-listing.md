# Chrome Web Store — Nostr Map Signer

## Name
Nostr Map Signer

## Summary (132 chars max)
Signez vos événements Nostr (NIP-07) et payez en Lightning (NWC) — clé privée chiffrée localement, ne quitte jamais le navigateur.

## Description
Nostr Map Signer est une extension légère pour le protocole Nostr. Elle implémente NIP-07 (signature des événements) et NIP-47 (Nostr Wallet Connect) pour les paiements Lightning.

**Fonctionnalités principales**

• NIP-07 : signer, chiffrer et déchiffrer des événements Nostr depuis n'importe quel site compatible
• Wallet Lightning via NWC : consultez votre solde, envoyez des sats à une adresse user@domaine.com, approuvez les zaps
• Sécurité : clé privée chiffrée AES-256-GCM avec PBKDF2-SHA256 (250 000 itérations), déverrouillage par code PIN 6 chiffres ou passphrase longue
• Verrouillage automatique après 2 heures d'inactivité
• Historique des 100 dernières transactions avec vérification du preimage
• Gestion des permissions par site (autoriser / révoquer)
• Compatible nsec1 (bech32) et clé hexadécimale 64 caractères

**Confidentialité**
Zéro collecte de données. Aucun tracker. Votre clé privée ne quitte jamais votre appareil.

**Compatibilité**
Fonctionne avec tous les clients Nostr qui supportent NIP-07 : Nostr.com, Snort, Coracle, Amethyst Web, iris.to, Primal, nostrmap.fr…

## Category
Productivity

## Language
French (fr)

## Website
https://nostrmap.fr

## Privacy policy URL
https://nostrmap.fr/privacy-nostr-map-extension

## Support URL
https://nostrmap.fr

## Permissions justification (for the review form)
- storage : stocker le coffre chiffré localement
- tabs / activeTab : afficher l'overlay de confirmation sur la page active
- alarms : déclencher le verrouillage automatique (2 h)
- <all_urls> : injecter window.nostr (NIP-07) sur tous les sites Nostr visités — requis par le standard NIP-07

## Screenshots needed (1280×800 or 640×400)
1. Popup déverrouillé — onglet Identité
2. Popup — onglet Lightning (solde + envoi)
3. Overlay de confirmation de signature
4. Page Options
5. Overlay de zap Lightning

## Promotional tile
1280×800 — fond #13131a, logo Nostr Map ✦ centré en gradient violet/cyan
