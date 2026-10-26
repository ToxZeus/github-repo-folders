# GitHub Repo Folders

[English](README.md) | **Français**

Extension de navigateur (Chrome / Edge / Brave, Manifest V3) qui ajoute des
dossiers colorés à l'onglet **Repositories** de ton profil GitHub
(`github.com/<toi>?tab=repositories`), pour organiser tes repos par contexte —
VPS, École, Perso, Travail, etc.

Tout fonctionne 100% côté client : aucun serveur, aucune télémétrie, aucune
donnée ne quitte ton navigateur en dehors du mécanisme de synchronisation de
Chrome lui-même (optionnel, voir [Confidentialité](#confidentialité)
ci-dessous).

## Fonctionnalités

- **Dossiers multiples par repo** — un repo peut appartenir à plusieurs
  dossiers à la fois
- **Glisser-déposer** un repo sur un dossier, ou bouton 📁 sur chaque repo
- **Filtres** — par dossier, par langage, masquage des forks/archivés
- **Favoris épinglés** (⭐) — les repos épinglés remontent en haut de la liste
  visible
- **Recherche instantanée** — filtre la liste par nom au fur et à mesure de
  la frappe, combinable avec les filtres dossier/langage/archivé/fork
- **Réordonner les dossiers** — glisse une chip dossier pour changer son
  ordre d'affichage
- **Badge sur l'icône** — le nombre de repos épinglés s'affiche directement
  sur l'icône de la barre d'outils
- **Menu contextuel clic-droit** — ajoute/retire n'importe quel lien de repo,
  n'importe où sur github.com, d'un dossier sans ouvrir l'onglet
  Repositories (le menu est générique — « Ajouter à X » / « Retirer de X »
  — Chrome ne permet pas d'afficher un état « déjà dans ce dossier » en
  direct sur un menu contextuel)
- **Actions groupées** — sélectionne plusieurs repos et assigne-les tous à
  un dossier en une fois
- **Support de l'onglet Stars** — organise aussi les repos que tu as
  starrés (`?tab=stars`), pas seulement les tiens, dans les mêmes dossiers
  (pas de filtre archivé/fork là-bas — le markup de GitHub n'expose pas ce
  signal sur cette page)
- **Couleurs personnalisables** par dossier
- **Synchronisation entre appareils** via `chrome.storage.sync` (liée à ton
  compte Chrome), avec une option local uniquement si tu préfères ne pas
  synchroniser
- **Export/import JSON** pour sauvegarde ou transfert manuel
- **Thème clair/sombre automatique**, aligné sur le thème actif de GitHub
- **Page de réglages** — métrique du badge, délais de rafraîchissement,
  largeur des popovers, préférence de stockage, palette par défaut et
  comportement de la recherche sont tous ajustables (icône de l'extension →
  ⚙)
- **Notes par repo** — une note libre par repo (bouton 📝), longueur max
  ajustable dans les Réglages
- **Indicateur de fraîcheur** — un point coloré à côté de "Mis à jour il y
  a...", purement dérivé de ce que GitHub affiche déjà (aucun appel API
  supplémentaire), avec seuils et couleurs ajustables
- **Raccourcis clavier** — survole un repo et appuie sur 1-9 pour
  l'assigner au dossier correspondant, avec une touche modificatrice
  optionnelle (Alt/Maj) ajustable dans les Réglages
- **Sous-dossiers sur un niveau** — imbrique un dossier sous un autre (ex:
  « Travail » > « Client A ») depuis son menu `⋯` ; filtrer par un dossier
  parent inclut aussi les repos de ses enfants, et le menu contextuel /
  la liste déroulante des actions groupées reflètent aussi la hiérarchie

## Installation (mode développeur)

Cette extension n'est pas encore publiée sur le Chrome Web Store, elle se
charge donc "non empaquetée" depuis les sources :

1. Clone ou télécharge ce dépôt
2. Ouvre `chrome://extensions` (ou `edge://extensions`)
3. Active le **mode développeur** (coin supérieur droit)
4. Clique sur **Charger l'extension non empaquetée** et sélectionne ce dossier

Après avoir récupéré une mise à jour : clique sur **Recharger** (↻) sur la
carte de l'extension, puis rafraîchis les onglets GitHub ouverts.

## Utilisation

1. Va sur ton profil GitHub, onglet **Repositories**
2. Clique sur **+ Nouveau dossier** pour en créer un (nom + couleur)
3. Glisse un repo sur un dossier, ou clique sur son bouton 📁 et coche un ou
   plusieurs dossiers
4. Clique sur un dossier pour filtrer la liste ; `⋯` pour le renommer, changer
   sa couleur ou le supprimer
5. Clique sur l'icône de l'extension pour gérer tous les dossiers d'un coup,
   voir les statistiques, et exporter/importer ta configuration

## Confidentialité

- Toutes les données (dossiers, affectations, épinglés) sont stockées via
  l'API standard
  [`chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage)
  — `sync` par défaut (liée à ton compte Chrome connecté), avec une copie
  locale comme filet de sécurité.
- Aucun serveur externe, aucune télémétrie, aucun script de tracking.
- L'extension ne s'exécute que sur les pages `github.com` et ne lit que la
  liste de repos déjà visible dans ton navigateur — elle n'appelle pas l'API
  GitHub et n'envoie tes données nulle part.

## Limites connues

- Fonctionne sur les onglets Repositories et Stars du profil personnel
  uniquement. Les pages d'organisation (`github.com/orgs/<org>/repositories`)
  utilisent une interface différente (React), pas encore supportée.
- `chrome.storage.sync` a un quota strict (8 Ko par entrée, 100 Ko au total).
  Les données sont réparties sur plusieurs clés pour tenir confortablement
  avec plusieurs centaines de repos classés, mais au-delà, les écritures de
  synchronisation peuvent échouer — l'extension bascule alors sur un stockage
  local uniquement et affiche un avertissement dans la console.

## Fonctionnement technique

JavaScript simple (sans build, sans framework), Manifest V3 :

- `src/content.js` / `src/content.css` — injecte la barre d'outils des
  dossiers et les contrôles par repo dans la page GitHub, stylé avec les
  variables CSS Primer de GitHub (`--fgColor-*`, `--bgColor-*`,
  `--borderColor-*`) pour s'aligner automatiquement sur le thème actif.
  Repositories et Stars (markup assez différent) sont gérés via une petite
  interface d'adaptateur par page — tout le reste (barre d'outils, filtres,
  glisser-déposer, épinglage) est écrit une seule fois contre cette
  interface.
- `src/storage.js` — couche de stockage partagée (`chrome.storage.sync`/
  `local`), utilisée à la fois par le script de contenu et la popup.
- `src/popup.html` / `src/popup.js` — popup de l'icône pour gérer les
  dossiers, voir les statistiques, et importer/exporter.
- `src/background.js` — service worker classique (non-module) qui réutilise
  `storage.js` via `importScripts` pour garder à jour le badge de l'icône
  (métrique configurable dans les Réglages), et pour construire/gérer le
  menu contextuel clic-droit.
- `src/options.html` / `src/options.js` — la page de Réglages (`options_page`
  MV3), ouverte depuis le bouton ⚙ de la popup.
- `src/theme.css` — couleurs/mode sombre/boutons partagés pour les pages
  autonomes de l'extension (popup, réglages), qui ne peuvent pas lire le CSS
  de GitHub et détectent donc le mode sombre via le
  `prefers-color-scheme` du système/navigateur.

## Retours

Un bug ou une idée ? Ouvre une issue sur ce dépôt.

## Licence

[MIT](LICENSE)
