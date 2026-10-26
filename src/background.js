/**
 * Background service worker. Hosts two things that need a background
 * context because they're unavailable to content scripts:
 *  - the toolbar icon's badge (pinned-repo count)
 *  - a right-click context menu to add/remove any GitHub repo link from a
 *    folder, from anywhere on github.com (not just the Repositories tab)
 *
 * Classic (non-module) service worker, so storage.js can be pulled in with
 * importScripts and reused as-is: GHRF.getData()/onChange() etc. are the
 * exact same API the content script and popup already use.
 */
importScripts("storage.js");

const BADGE_COLOR = "#0969da";

async function updateBadge() {
  const [data, settings] = await Promise.all([self.GHRF.getData(), self.GHRF.getSettings()]);
  const pinnedCount = (data.pinned || []).length;
  const taggedCount = Object.keys(data.assignments || {}).length;
  let count;
  if (settings.badgeMetric === "tagged") count = taggedCount;
  else if (settings.badgeMetric === "both") count = pinnedCount + taggedCount;
  else count = pinnedCount;

  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  if (count > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  }
}

// ---------- context menu ----------

const MENU_URL_PATTERNS = ["https://github.com/*"];
const ADD_PARENT_ID = "ghrf-add-parent";
const REMOVE_PARENT_ID = "ghrf-remove-parent";
const EMPTY_ID = "ghrf-no-folders";

// Best-effort: GitHub reserves these as top-level paths, so a link like
// /settings/profile is never a repo. Not exhaustive — context-menu repo
// detection from a bare URL can't be 100% reliable, only good enough.
const RESERVED_OWNER_SEGMENTS = new Set([
  "settings", "notifications", "marketplace", "search", "orgs", "login",
  "join", "logout", "explore", "issues", "pulls", "dashboard", "new",
  "organizations", "apps", "sponsors", "about", "pricing", "features",
  "security", "topics", "trending", "collections", "events", "codespaces",
  "copilot", "mobile", "cli", "gist", "gists", "watching", "stars",
  "account", "support", "contact", "site", "team", "enterprise"
]);

function extractRepoFullName(linkUrl) {
  if (!linkUrl) return null;
  let url;
  try {
    url = new URL(linkUrl);
  } catch (err) {
    return null;
  }
  if (url.hostname !== "github.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  const [owner, repo] = segments;
  if (RESERVED_OWNER_SEGMENTS.has(owner.toLowerCase())) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) return null;
  if (!repo) return null;
  return `${owner}/${repo}`;
}

function createMenu(options) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(options, () => {
      void chrome.runtime.lastError; // swallow "duplicate id" races, non-fatal
      resolve();
    });
  });
}

async function buildMenus() {
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  const data = await self.GHRF.getData();

  if (!data.folders.length) {
    await createMenu({
      id: EMPTY_ID,
      title: "GitHub Repo Folders : aucun dossier pour le moment",
      contexts: ["link"],
      documentUrlPatterns: MENU_URL_PATTERNS,
      enabled: false
    });
    return;
  }

  await createMenu({
    id: ADD_PARENT_ID,
    title: "Ajouter à un dossier",
    contexts: ["link"],
    documentUrlPatterns: MENU_URL_PATTERNS
  });
  await createMenu({
    id: REMOVE_PARENT_ID,
    title: "Retirer d'un dossier",
    contexts: ["link"],
    documentUrlPatterns: MENU_URL_PATTERNS
  });

  const topLevel = data.folders.filter((f) => !f.parentId);
  for (const folder of topLevel) {
    await createMenu({
      id: `ghrf-add-${folder.id}`,
      parentId: ADD_PARENT_ID,
      title: folder.name,
      contexts: ["link"],
      documentUrlPatterns: MENU_URL_PATTERNS
    });
    await createMenu({
      id: `ghrf-remove-${folder.id}`,
      parentId: REMOVE_PARENT_ID,
      title: folder.name,
      contexts: ["link"],
      documentUrlPatterns: MENU_URL_PATTERNS
    });

    const children = data.folders.filter((f) => f.parentId === folder.id);
    if (children.length === 0) continue;

    // A native context-menu item that has its own children generally stops
    // being directly clickable (it just opens the submenu) — add an
    // explicit leaf so a parent-with-children can still be assigned to
    // directly, not just its children.
    await createMenu({
      id: `ghrf-add-self-${folder.id}`,
      parentId: `ghrf-add-${folder.id}`,
      title: "(ce dossier)",
      contexts: ["link"],
      documentUrlPatterns: MENU_URL_PATTERNS
    });
    await createMenu({
      id: `ghrf-remove-self-${folder.id}`,
      parentId: `ghrf-remove-${folder.id}`,
      title: "(ce dossier)",
      contexts: ["link"],
      documentUrlPatterns: MENU_URL_PATTERNS
    });

    for (const child of children) {
      await createMenu({
        id: `ghrf-add-${child.id}`,
        parentId: `ghrf-add-${folder.id}`,
        title: child.name,
        contexts: ["link"],
        documentUrlPatterns: MENU_URL_PATTERNS
      });
      await createMenu({
        id: `ghrf-remove-${child.id}`,
        parentId: `ghrf-remove-${folder.id}`,
        title: child.name,
        contexts: ["link"],
        documentUrlPatterns: MENU_URL_PATTERNS
      });
    }
  }
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  const id = info.menuItemId;
  if (typeof id !== "string") return;

  // Check the "-self-" (parent-with-children leaf) prefixes before the
  // plain ones, since e.g. "ghrf-add-self-X" also starts with "ghrf-add-".
  let isAdd = false;
  let isRemove = false;
  let folderId = null;
  if (id.startsWith("ghrf-add-self-")) {
    isAdd = true;
    folderId = id.slice("ghrf-add-self-".length);
  } else if (id.startsWith("ghrf-remove-self-")) {
    isRemove = true;
    folderId = id.slice("ghrf-remove-self-".length);
  } else if (id.startsWith("ghrf-add-")) {
    isAdd = true;
    folderId = id.slice("ghrf-add-".length);
  } else if (id.startsWith("ghrf-remove-")) {
    isRemove = true;
    folderId = id.slice("ghrf-remove-".length);
  } else {
    return;
  }

  const fullName = extractRepoFullName(info.linkUrl);
  if (!fullName) return;

  if (isAdd) {
    await self.GHRF.addAssignment(fullName, folderId);
  } else {
    await self.GHRF.removeAssignment(fullName, folderId);
  }
});

// ---------- wiring ----------

// Registered synchronously at the top level so the listeners survive the
// service worker's suspend/wake cycles.
self.GHRF.onChange(updateBadge);
self.GHRF.onChange(buildMenus);
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  buildMenus();
});
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  buildMenus();
});
updateBadge();
buildMenus();
