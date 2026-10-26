/**
 * Background service worker — keeps the extension icon's badge in sync
 * with the number of pinned repos. A badge needs a background context:
 * chrome.action.setBadgeText isn't available to content scripts.
 *
 * Classic (non-module) service worker, so storage.js can be pulled in with
 * importScripts and reused as-is: GHRF.getData()/onChange() are the exact
 * same API the content script and popup already use.
 */
importScripts("storage.js");

const BADGE_COLOR = "#0969da";

async function updateBadge() {
  const data = await self.GHRF.getData();
  const count = (data.pinned || []).length;
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  if (count > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  }
}

// Registered synchronously at the top level so the listener survives the
// service worker's suspend/wake cycles.
self.GHRF.onChange(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
updateBadge();
