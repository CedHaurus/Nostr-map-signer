# Firefox Add-ons (AMO) — Nostr Map Signer

## Name
Nostr Map Signer

## Summary (250 chars max)
Signez vos événements Nostr (NIP-07) et payez en Lightning via NWC. Clé privée chiffrée localement, jamais transmise. Déverrouillage par PIN ou passphrase.

## Description
Nostr Map Signer est une extension légère pour le protocole Nostr. Elle implémente NIP-07 (signature des événements) et NIP-47 (Nostr Wallet Connect) pour les paiements Lightning.

**Fonctionnalités**

• NIP-07 : signer, chiffrer et déchiffrer des événements Nostr depuis n'importe quel site compatible
• Wallet Lightning via NWC : consultez votre solde, envoyez des sats à une adresse Lightning (user@domaine.com), approuvez les zaps
• Sécurité : clé privée chiffrée AES-256-GCM avec PBKDF2-SHA256 (250 000 itérations)
• Déverrouillage par code PIN 6 chiffres ou passphrase longue
• Verrouillage automatique après 2 heures d'inactivité
• Historique des 100 dernières transactions avec vérification du preimage
• Gestion des permissions par site (autoriser / révoquer)
• Compatible nsec1 (bech32) et clé hexadécimale 64 caractères
• Aucun tracker, aucune donnée transmise à un tiers

**Compatibilité**
Nostr.com, Snort, Coracle, iris.to, Primal, nostrmap.fr et tout client implémentant NIP-07.

## License
MIT

## Category
Privacy & Security

## Tags
nostr, lightning, nip07, nwc, bitcoin, privacy

## Website
https://nostrmap.fr

## Privacy policy URL
https://nostrmap.fr/privacy-nostr-map-extension

## Support email
boutrychrist@gmail.com

## Permissions justification
- storage : stocker le coffre chiffré localement
- tabs / activeTab : afficher l'overlay de confirmation sur la page active
- alarms : verrouillage automatique après 2 h d'inactivité
- <all_urls> : injecter window.nostr (NIP-07) sur tous les sites Nostr — requis par le standard

## Screenshots (1280×720 minimum, 3 requis)
1. Popup déverrouillé — onglet Identité
2. Popup — onglet Lightning (solde + formulaire envoi)
3. Overlay de confirmation de signature
4. Page Options complète
5. Overlay de zap avec montant et destinataire

## Source code submission
AMO exige le code source si minifié/bundlé.
→ vendor/nostr.bundle.js est le seul bundle tiers (nostr-tools).
→ Uploader l'archive complète du projet source + indiquer : "build: ./build.sh (bash + Node.js)"

## Firefox min version
109.0 (défini dans browser_specific_settings.gecko.strict_min_version)
