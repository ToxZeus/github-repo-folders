# GitHub Repo Folders

**English** | [Français](README.fr.md)

A browser extension (Chrome / Edge / Brave, Manifest V3) that adds colored
folders to your GitHub profile's **Repositories** tab
(`github.com/<you>?tab=repositories`), so you can organize your repos by
context — VPS, School, Personal, Work, etc.

Everything is 100% client-side: no backend, no analytics, no data ever leaves
your browser except through Chrome's own sync mechanism (opt-in, see
[Privacy](#privacy) below).

## Features

- **Multi-folder tagging** — a repo can belong to several folders at once
- **Drag & drop** a repo onto a folder, or use the 📁 button on each repo
- **Filters** — by folder, by language, hide forks/archived repos
- **Pin favorites** (⭐) — pinned repos float to the top of the visible list
- **Instant search** — filter the repo list by name as you type, combinable
  with the folder/language/archived/fork filters
- **Reorder folders** — drag a folder chip to change its display order
- **Icon badge** — the number of pinned repos shows directly on the toolbar icon
- **Right-click context menu** — add/remove any repo link, anywhere on
  github.com, from a folder without opening the Repositories tab (the menu
  is generic — "Add to X" / "Remove from X" — Chrome has no way to show a
  live "already in this folder" state on a context menu)
- **Bulk actions** — select several repos at once and assign them all to a
  folder in one go
- **Stars tab support** — organize repos you've starred
  (`?tab=stars`), not just your own, into the same folders (no
  archived/fork filter there — GitHub's Stars page markup doesn't expose
  that signal)
- **Custom colors** per folder
- **Cross-device sync** via `chrome.storage.sync` (follows your Chrome profile),
  with a local-only option if you'd rather not sync
- **JSON export/import** for manual backup or transfer
- **Automatic light/dark theme**, matched to GitHub's own active theme
- **Settings page** — badge metric, refresh timing, popover width, storage
  preference, default color palette, and search behavior are all adjustable
  (click the extension icon → ⚙)
- **Per-repo notes** — a free-text note per repo (📝 button), capped length
  configurable in Settings
- **Staleness indicator** — a colored dot next to "Updated X ago", purely
  derived from what GitHub already shows (no extra API calls), with
  adjustable thresholds and colors
- **Keyboard shortcuts** — hover a repo and press 1-9 to toggle it into the
  Nth folder, with an optional required modifier key (Alt/Shift) configurable
  in Settings
- **One level of sub-folders** — nest a folder under another (e.g. "Work" >
  "Client A") from its `⋯` menu; filtering by a parent also matches its
  children's repos, and the context menu/bulk-assign dropdown reflect the
  hierarchy too
- **Dashboard** — a kanban/list overview of every folder and its repos in
  one page (popup → 📊); shows only what's actually stored (folder names,
  assignments, pins, notes) — not language/stars/archived state, which only
  exist on the live GitHub page

## Install (developer mode)

This extension isn't published on the Chrome Web Store yet, so it's loaded
"unpacked" from source:

1. Clone or download this repository
2. Open `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder

After pulling an update: click **Reload** (↻) on the extension card, then
refresh any open GitHub tab.

## Usage

1. Go to your GitHub profile, **Repositories** tab
2. Click **+ New folder** to create one (name + color)
3. Drag a repo onto a folder, or click its 📁 button and check one or more
   folders
4. Click a folder chip to filter the list; `⋯` to rename, recolor, or delete it
5. Click the extension icon to manage all folders at once, see stats, and
   export/import your configuration

## Privacy

- All data (folders, assignments, pins) is stored through the standard
  [`chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage)
  API — `sync` by default (tied to your signed-in Chrome profile), with a
  local mirror as a safety backup.
- No external server, no analytics, no tracking script.
- The extension only runs on `github.com` pages and only reads the repo list
  already visible in your browser — it doesn't call the GitHub API or send
  your data anywhere.

## Known limitations

- Works on your personal profile's Repositories and Stars tabs only.
  Organization pages (`github.com/orgs/<org>/repositories`) use a different
  (React-based) UI that isn't supported yet.
- `chrome.storage.sync` has a strict quota (8KB per item, 100KB total). Data
  is sharded across several keys to comfortably fit hundreds of tagged repos,
  but beyond that, sync writes can fail — the extension then falls back to
  local-only storage and logs a warning in the console.

## How it works

Plain JavaScript (no build step, no framework), Manifest V3:

- `src/content.js` / `src/content.css` — injects the folder toolbar and
  per-repo controls into the GitHub page, styled with GitHub's own Primer
  CSS custom properties (`--fgColor-*`, `--bgColor-*`, `--borderColor-*`) so
  it matches the active theme automatically. Repositories vs. Stars (quite
  different markup) are handled through a small page-adapter interface —
  everything else (toolbar, filters, drag-and-drop, pinning) is written
  once against that interface.
- `src/storage.js` — shared storage layer (`chrome.storage.sync`/`local`),
  used by both the content script and the popup.
- `src/popup.html` / `src/popup.js` — the toolbar-icon popup for managing
  folders, stats, and import/export.
- `src/background.js` — a classic (non-module) service worker that reuses
  `storage.js` via `importScripts` to keep the toolbar icon's badge in sync
  (metric configurable in Settings), and to build/handle the right-click
  context menu.
- `src/options.html` / `src/options.js` — the Settings page (MV3
  `options_page`), opened from the popup's ⚙ button.
- `src/theme.css` — shared colors/dark-mode/buttons for the extension's own
  standalone pages (popup, options, dashboard), which can't read GitHub's
  CSS and so detect dark mode via the OS/browser's `prefers-color-scheme`
  instead.
- `src/dashboard.html` / `src/dashboard.js` — the kanban/list overview,
  reached from the popup.

## Feedback

Found a bug or have an idea? Open an issue on this repository.

## License

[MIT](LICENSE)
