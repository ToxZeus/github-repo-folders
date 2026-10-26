/**
 * Shared storage layer for GitHub Repo Folders.
 * Loaded as a plain script in both the content script and the popup,
 * exposing everything under window.GHRF.
 *
 * Data lives in chrome.storage.sync so it follows the user across devices
 * signed into the same Chrome profile. Sync has tight per-item (8KB) and
 * total (100KB) quotas, so the assignments map is sharded across several
 * fixed keys instead of being stored as one big blob. On first run, any
 * pre-1.1 data found in chrome.storage.local is migrated in automatically.
 */
(function (global) {
  const FOLDERS_KEY = "ghrf_folders_v1";
  const PINNED_KEY = "ghrf_pinned_v1";
  const SETTINGS_KEY = "ghrf_settings_v1";
  const CHUNK_COUNT = 10;
  const LEGACY_LOCAL_KEY = "ghRepoFolders_v1"; // flat format used by v1.0.x (local only)

  const PALETTE = [
    "#e05d44", // rouge
    "#f1a33c", // orange
    "#e8c547", // jaune
    "#57ab5a", // vert
    "#2ea3c7", // cyan
    "#4184e4", // bleu
    "#8957e5", // violet
    "#d6409f", // rose
    "#6e7781", // gris
    "#1a7f37" // vert foncé
  ];

  // Grows phase by phase as new settings are introduced; any key missing
  // from a stored blob (older install, or a brand new one) transparently
  // falls back to its default here, so no version-bumped migration is
  // needed the way folders/assignments required.
  const DEFAULT_SETTINGS = {
    badgeMetric: "pinned", // "pinned" | "tagged" | "both"
    renderDebounceMs: 200,
    safetyIntervalMs: 1500,
    popoverWidth: 240,
    storagePreference: "sync", // "sync" | "local-only"
    defaultPalette: [
      "#e05d44",
      "#f1a33c",
      "#e8c547",
      "#57ab5a",
      "#2ea3c7",
      "#4184e4",
      "#8957e5",
      "#d6409f",
      "#6e7781",
      "#1a7f37"
    ],
    searchMatchLanguageToo: false,
    notes: {
      enabled: true,
      maxLength: 300
    },
    staleness: {
      enabled: true,
      freshDays: 30,
      staleDays: 180,
      colors: { fresh: "#1a7f37", warning: "#9a6700", stale: "#d1242f" }
    },
    shortcuts: {
      enabled: true,
      showNumberBadges: true,
      modifier: "none" // "none" | "alt" | "shift"
    }
  };

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // Never trust a stored blob as-is: it may be hand-edited, from an older
  // version, or corrupted. Every field is validated/clamped against its own
  // bounds, and unknown keys are dropped rather than passed through.
  function sanitizeSettings(partial) {
    const s = Object.assign({}, DEFAULT_SETTINGS, partial && typeof partial === "object" ? partial : {});
    const badgeMetric = ["pinned", "tagged", "both"].includes(s.badgeMetric)
      ? s.badgeMetric
      : DEFAULT_SETTINGS.badgeMetric;
    const storagePreference = ["sync", "local-only"].includes(s.storagePreference)
      ? s.storagePreference
      : DEFAULT_SETTINGS.storagePreference;
    const isHex = (c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
    const defaultPalette =
      Array.isArray(s.defaultPalette) && s.defaultPalette.length && s.defaultPalette.every(isHex)
        ? s.defaultPalette.slice(0, 20)
        : DEFAULT_SETTINGS.defaultPalette.slice();

    const notesIn = s.notes && typeof s.notes === "object" ? s.notes : {};
    const notes = {
      enabled: notesIn.enabled !== undefined ? Boolean(notesIn.enabled) : DEFAULT_SETTINGS.notes.enabled,
      maxLength: clampNumber(notesIn.maxLength, 20, 2000, DEFAULT_SETTINGS.notes.maxLength)
    };

    const staleIn = s.staleness && typeof s.staleness === "object" ? s.staleness : {};
    const staleColorsIn = staleIn.colors && typeof staleIn.colors === "object" ? staleIn.colors : {};
    const staleness = {
      enabled: staleIn.enabled !== undefined ? Boolean(staleIn.enabled) : DEFAULT_SETTINGS.staleness.enabled,
      freshDays: clampNumber(staleIn.freshDays, 1, 3650, DEFAULT_SETTINGS.staleness.freshDays),
      staleDays: clampNumber(staleIn.staleDays, 1, 3650, DEFAULT_SETTINGS.staleness.staleDays),
      colors: {
        fresh: isHex(staleColorsIn.fresh) ? staleColorsIn.fresh : DEFAULT_SETTINGS.staleness.colors.fresh,
        warning: isHex(staleColorsIn.warning) ? staleColorsIn.warning : DEFAULT_SETTINGS.staleness.colors.warning,
        stale: isHex(staleColorsIn.stale) ? staleColorsIn.stale : DEFAULT_SETTINGS.staleness.colors.stale
      }
    };
    if (staleness.freshDays > staleness.staleDays) {
      // Keep the two thresholds honestly ordered rather than silently
      // producing a range where nothing is ever "warning".
      staleness.staleDays = staleness.freshDays;
    }

    const shortcutsIn = s.shortcuts && typeof s.shortcuts === "object" ? s.shortcuts : {};
    const shortcuts = {
      enabled: shortcutsIn.enabled !== undefined ? Boolean(shortcutsIn.enabled) : DEFAULT_SETTINGS.shortcuts.enabled,
      showNumberBadges:
        shortcutsIn.showNumberBadges !== undefined
          ? Boolean(shortcutsIn.showNumberBadges)
          : DEFAULT_SETTINGS.shortcuts.showNumberBadges,
      modifier: ["none", "alt", "shift"].includes(shortcutsIn.modifier)
        ? shortcutsIn.modifier
        : DEFAULT_SETTINGS.shortcuts.modifier
    };

    return {
      badgeMetric,
      renderDebounceMs: clampNumber(s.renderDebounceMs, 50, 2000, DEFAULT_SETTINGS.renderDebounceMs),
      safetyIntervalMs: clampNumber(s.safetyIntervalMs, 500, 10000, DEFAULT_SETTINGS.safetyIntervalMs),
      popoverWidth: clampNumber(s.popoverWidth, 180, 400, DEFAULT_SETTINGS.popoverWidth),
      storagePreference,
      defaultPalette,
      searchMatchLanguageToo: Boolean(s.searchMatchLanguageToo),
      notes,
      staleness,
      shortcuts
    };
  }

  function primaryAreaFor(storagePreference) {
    return storagePreference === "local-only" ? chrome.storage.local : chrome.storage.sync;
  }

  function chunkKey(i) {
    return `ghrf_assign_${i}_v1`;
  }

  function allChunkKeys() {
    const keys = [];
    for (let i = 0; i < CHUNK_COUNT; i++) keys.push(chunkKey(i));
    return keys;
  }

  // Notes get their own parallel set of sharded keys rather than riding
  // inside the assignments value shape, so none of the existing
  // assignment call sites (toggleAssignment, addAssignment, assignMany,
  // removeAssignment, every ".includes(folderId)" consumer) need to change.
  function notesChunkKey(i) {
    return `ghrf_notes_${i}_v1`;
  }

  function allNotesChunkKeys() {
    const keys = [];
    for (let i = 0; i < CHUNK_COUNT; i++) keys.push(notesChunkKey(i));
    return keys;
  }

  function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function chunkIndexFor(repoFullName) {
    return hashString(repoFullName) % CHUNK_COUNT;
  }

  function storageGet(area, keys) {
    return new Promise((resolve) => {
      area.get(keys, (res) => resolve(res || {}));
    });
  }

  function storageSet(area, items) {
    return new Promise((resolve, reject) => {
      area.set(items, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  function emptyData() {
    return { folders: [], assignments: {}, pinned: [], notes: {} };
  }

  function genId() {
    return "f_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function splitAssignmentsIntoChunks(assignments) {
    const chunks = Array.from({ length: CHUNK_COUNT }, () => ({}));
    for (const [repo, folderIds] of Object.entries(assignments || {})) {
      chunks[chunkIndexFor(repo)][repo] = folderIds;
    }
    return chunks;
  }

  function splitNotesIntoChunks(notes) {
    const chunks = Array.from({ length: CHUNK_COUNT }, () => ({}));
    for (const [repo, text] of Object.entries(notes || {})) {
      chunks[chunkIndexFor(repo)][repo] = text;
    }
    return chunks;
  }

  async function readBulkData(area) {
    const keys = [FOLDERS_KEY, PINNED_KEY, ...allChunkKeys(), ...allNotesChunkKeys()];
    const res = await storageGet(area, keys);
    const folders = Array.isArray(res[FOLDERS_KEY]) ? res[FOLDERS_KEY] : null;
    const pinned = Array.isArray(res[PINNED_KEY]) ? res[PINNED_KEY] : [];
    const assignments = {};
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const chunk = res[chunkKey(i)];
      if (chunk && typeof chunk === "object") Object.assign(assignments, chunk);
    }
    const notes = {};
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const chunk = res[notesChunkKey(i)];
      if (chunk && typeof chunk === "object") Object.assign(notes, chunk);
    }
    return { folders, assignments, pinned, notes };
  }

  function buildBulkPayload(data) {
    const payload = {
      [FOLDERS_KEY]: data.folders || [],
      [PINNED_KEY]: data.pinned || []
    };
    splitAssignmentsIntoChunks(data.assignments).forEach((chunk, i) => {
      payload[chunkKey(i)] = chunk;
    });
    splitNotesIntoChunks(data.notes).forEach((chunk, i) => {
      payload[notesChunkKey(i)] = chunk;
    });
    return payload;
  }

  async function writeData(data) {
    const settings = await getSettings();
    const area = primaryAreaFor(settings.storagePreference);
    const payload = buildBulkPayload(data);

    try {
      await storageSet(area, payload);
    } catch (err) {
      console.error(
        "[GitHub Repo Folders] Écriture impossible (quota dépassé ?). " +
          "Les données sont gardées en local sur cet appareil seulement.",
        err
      );
      await storageSet(chrome.storage.local, payload).catch(() => {});
    }

    // Safety mirror in the old flat format, in case the primary area ever
    // gets wiped. Always local, regardless of storagePreference.
    storageSet(chrome.storage.local, { [LEGACY_LOCAL_KEY]: data }).catch(() => {});
  }

  async function migrateLegacyIfNeeded() {
    const legacy = await storageGet(chrome.storage.local, [LEGACY_LOCAL_KEY]);
    const old = legacy[LEGACY_LOCAL_KEY];
    if (!old || !Array.isArray(old.folders)) return null;
    const migrated = {
      folders: old.folders,
      assignments: old.assignments || {},
      pinned: Array.isArray(old.pinned) ? old.pinned : [],
      notes: old.notes && typeof old.notes === "object" ? old.notes : {}
    };
    await writeData(migrated);
    return migrated;
  }

  async function getData() {
    const settings = await getSettings();
    const area = primaryAreaFor(settings.storagePreference);
    const current = await readBulkData(area);
    if (current.folders !== null) {
      return {
        folders: current.folders,
        assignments: current.assignments,
        pinned: current.pinned,
        notes: current.notes
      };
    }
    const migrated = await migrateLegacyIfNeeded();
    return migrated || emptyData();
  }

  function setData(data) {
    return writeData(data);
  }

  async function getSettings() {
    const res = await storageGet(chrome.storage.sync, [SETTINGS_KEY]);
    return sanitizeSettings(res[SETTINGS_KEY]);
  }

  async function setSettings(partial) {
    const current = await getSettings();
    const next = sanitizeSettings(Object.assign({}, current, partial));

    try {
      await storageSet(chrome.storage.sync, { [SETTINGS_KEY]: next });
    } catch (err) {
      console.error("[GitHub Repo Folders] Impossible d'enregistrer les réglages.", err);
      await storageSet(chrome.storage.local, { [SETTINGS_KEY]: next }).catch(() => {});
    }

    // Switching storage preference shouldn't make existing data appear to
    // vanish: copy it into the newly selected area. The old area is left
    // untouched as a backup, never deleted.
    if (current.storagePreference !== next.storagePreference) {
      const oldArea = primaryAreaFor(current.storagePreference);
      const bulk = await readBulkData(oldArea);
      if (bulk.folders !== null) {
        const newArea = primaryAreaFor(next.storagePreference);
        const payload = buildBulkPayload(bulk);
        await storageSet(newArea, payload).catch((err) => {
          console.error(
            "[GitHub Repo Folders] Impossible de copier les données vers la nouvelle zone de stockage.",
            err
          );
        });
      }
    }

    return next;
  }

  function nextColor(data) {
    const used = data.folders.map((f) => f.color);
    const free = PALETTE.find((c) => !used.includes(c));
    return free || PALETTE[data.folders.length % PALETTE.length];
  }

  async function addFolder(name, color) {
    const data = await getData();
    const folder = {
      id: genId(),
      name: name.trim().slice(0, 40) || "Dossier",
      color: color || nextColor(data)
    };
    data.folders.push(folder);
    await setData(data);
    return folder;
  }

  async function reorderFolders(orderedIds) {
    const data = await getData();
    const byId = new Map(data.folders.map((f) => [f.id, f]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    data.folders.forEach((f) => {
      if (!orderedIds.includes(f.id)) reordered.push(f);
    });
    data.folders = reordered;
    await setData(data);
    return data;
  }

  async function renameFolder(id, name) {
    const data = await getData();
    const f = data.folders.find((x) => x.id === id);
    if (f) {
      f.name = name.trim().slice(0, 40) || f.name;
      await setData(data);
    }
    return data;
  }

  async function recolorFolder(id, color) {
    const data = await getData();
    const f = data.folders.find((x) => x.id === id);
    if (f) {
      f.color = color;
      await setData(data);
    }
    return data;
  }

  async function deleteFolder(id) {
    const data = await getData();
    data.folders = data.folders.filter((f) => f.id !== id);
    for (const repo of Object.keys(data.assignments)) {
      data.assignments[repo] = data.assignments[repo].filter((fid) => fid !== id);
      if (data.assignments[repo].length === 0) delete data.assignments[repo];
    }
    await setData(data);
    return data;
  }

  async function toggleAssignment(repoFullName, folderId) {
    const data = await getData();
    const current = data.assignments[repoFullName] || [];
    const has = current.includes(folderId);
    const next = has ? current.filter((id) => id !== folderId) : [...current, folderId];
    if (next.length) {
      data.assignments[repoFullName] = next;
    } else {
      delete data.assignments[repoFullName];
    }
    await setData(data);
    return data;
  }

  async function addAssignment(repoFullName, folderId) {
    const data = await getData();
    const current = data.assignments[repoFullName] || [];
    if (!current.includes(folderId)) {
      data.assignments[repoFullName] = [...current, folderId];
      await setData(data);
    }
    return data;
  }

  async function assignMany(repoFullNames, folderId) {
    const data = await getData();
    repoFullNames.forEach((repoFullName) => {
      const current = data.assignments[repoFullName] || [];
      if (!current.includes(folderId)) {
        data.assignments[repoFullName] = [...current, folderId];
      }
    });
    await setData(data);
    return data;
  }

  async function removeAssignment(repoFullName, folderId) {
    const data = await getData();
    const current = data.assignments[repoFullName] || [];
    const next = current.filter((id) => id !== folderId);
    if (next.length) {
      data.assignments[repoFullName] = next;
    } else {
      delete data.assignments[repoFullName];
    }
    await setData(data);
    return data;
  }

  async function setNote(repoFullName, text) {
    const data = await getData();
    const settings = await getSettings();
    const trimmed = (text || "").slice(0, settings.notes.maxLength);
    data.notes = data.notes || {};
    if (trimmed.trim()) {
      data.notes[repoFullName] = trimmed;
    } else {
      delete data.notes[repoFullName];
    }
    await setData(data);
    return data;
  }

  async function clearNote(repoFullName) {
    return setNote(repoFullName, "");
  }

  async function togglePin(repoFullName) {
    const data = await getData();
    const pinned = new Set(data.pinned || []);
    if (pinned.has(repoFullName)) pinned.delete(repoFullName);
    else pinned.add(repoFullName);
    data.pinned = Array.from(pinned);
    await setData(data);
    return data;
  }

  function exportJSON(data) {
    return JSON.stringify(
      { version: 2, exportedAt: new Date().toISOString(), ...data },
      null,
      2
    );
  }

  async function importJSON(jsonStr, mode) {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed.folders) || typeof parsed.assignments !== "object") {
      throw new Error("Fichier invalide : structure inattendue.");
    }
    const parsedPinned = Array.isArray(parsed.pinned) ? parsed.pinned : [];
    // Older exports (pre-notes) simply don't have this field.
    const parsedNotes = parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {};

    if (mode === "replace") {
      const replaced = {
        folders: parsed.folders,
        assignments: parsed.assignments,
        pinned: parsedPinned,
        notes: parsedNotes
      };
      await setData(replaced);
      return getData();
    }

    // merge
    const data = await getData();
    const idMap = {};
    for (const f of parsed.folders) {
      const existing = data.folders.find(
        (x) => x.name.toLowerCase() === f.name.toLowerCase()
      );
      if (existing) {
        idMap[f.id] = existing.id;
      } else {
        const newId = genId();
        idMap[f.id] = newId;
        data.folders.push({ id: newId, name: f.name, color: f.color || nextColor(data) });
      }
    }
    for (const [repo, folderIds] of Object.entries(parsed.assignments)) {
      const mapped = folderIds.map((fid) => idMap[fid]).filter(Boolean);
      const current = new Set(data.assignments[repo] || []);
      mapped.forEach((id) => current.add(id));
      data.assignments[repo] = Array.from(current);
    }
    const pinnedSet = new Set(data.pinned || []);
    parsedPinned.forEach((repo) => pinnedSet.add(repo));
    data.pinned = Array.from(pinnedSet);

    data.notes = data.notes || {};
    for (const [repo, text] of Object.entries(parsedNotes)) {
      // Imported notes don't overwrite an existing note for the same repo.
      if (!data.notes[repo]) data.notes[repo] = text;
    }

    await setData(data);
    return getData();
  }

  function onChange(callback) {
    const keysOfInterest = new Set([
      FOLDERS_KEY,
      PINNED_KEY,
      SETTINGS_KEY,
      ...allChunkKeys(),
      ...allNotesChunkKeys()
    ]);
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" && areaName !== "local") return;
      const touched = Object.keys(changes).some((k) => keysOfInterest.has(k));
      if (touched) callback();
    });
  }

  global.GHRF = {
    PALETTE,
    DEFAULT_SETTINGS_FALLBACK: sanitizeSettings(DEFAULT_SETTINGS),
    getData,
    setData,
    addFolder,
    reorderFolders,
    renameFolder,
    recolorFolder,
    deleteFolder,
    toggleAssignment,
    addAssignment,
    assignMany,
    removeAssignment,
    togglePin,
    setNote,
    clearNote,
    exportJSON,
    importJSON,
    getSettings,
    setSettings,
    onChange
  };
})(typeof window !== "undefined" ? window : this);
