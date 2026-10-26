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
- **Custom colors** per folder
- **Cross-device sync** via `chrome.storage.sync` (follows your Chrome profile)
- **JSON export/import** for manual backup or transfer
- **Automatic light/dark theme**, matched to GitHub's own active theme

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

- Works on your personal profile (`github.com/<user>?tab=repositories`) only.
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
  it matches the active theme automatically.
- `src/storage.js` — shared storage layer (`chrome.storage.sync`/`local`),
  used by both the content script and the popup.
- `src/popup.html` / `src/popup.js` — the toolbar-icon popup for managing
  folders, stats, and import/export.
- `src/background.js` — a classic (non-module) service worker that reuses
  `storage.js` via `importScripts` to keep the toolbar icon's badge (pinned
  repo count) in sync.

## Feedback

Found a bug or have an idea? Open an issue on this repository.

## License

[MIT](LICENSE)
