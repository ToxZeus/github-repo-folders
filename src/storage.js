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

  function chunkKey(i) {
    return `ghrf_assign_${i}_v1`;
  }

  function allChunkKeys() {
    const keys = [];
    for (let i = 0; i < CHUNK_COUNT; i++) keys.push(chunkKey(i));
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
    return { folders: [], assignments: {}, pinned: [] };
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

  async function readFromSync() {
    const keys = [FOLDERS_KEY, PINNED_KEY, ...allChunkKeys()];
    const res = await storageGet(chrome.storage.sync, keys);
    const folders = Array.isArray(res[FOLDERS_KEY]) ? res[FOLDERS_KEY] : null;
    const pinned = Array.isArray(res[PINNED_KEY]) ? res[PINNED_KEY] : [];
    const assignments = {};
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const chunk = res[chunkKey(i)];
      if (chunk && typeof chunk === "object") Object.assign(assignments, chunk);
    }
    return { folders, assignments, pinned };
  }

  async function writeData(data) {
    const payload = {
      [FOLDERS_KEY]: data.folders || [],
      [PINNED_KEY]: data.pinned || []
    };
    splitAssignmentsIntoChunks(data.assignments).forEach((chunk, i) => {
      payload[chunkKey(i)] = chunk;
    });

    try {
      await storageSet(chrome.storage.sync, payload);
    } catch (err) {
      console.error(
        "[GitHub Repo Folders] Synchronisation impossible (quota dépassé ?). " +
          "Les données sont gardées en local sur cet appareil seulement.",
        err
      );
      await storageSet(chrome.storage.local, payload).catch(() => {});
    }

    // Safety mirror in the old flat format, in case sync data ever gets wiped.
    storageSet(chrome.storage.local, { [LEGACY_LOCAL_KEY]: data }).catch(() => {});
  }

  async function migrateLegacyIfNeeded() {
    const legacy = await storageGet(chrome.storage.local, [LEGACY_LOCAL_KEY]);
    const old = legacy[LEGACY_LOCAL_KEY];
    if (!old || !Array.isArray(old.folders)) return null;
    const migrated = {
      folders: old.folders,
      assignments: old.assignments || {},
      pinned: Array.isArray(old.pinned) ? old.pinned : []
    };
    await writeData(migrated);
    return migrated;
  }

  async function getData() {
    const current = await readFromSync();
    if (current.folders !== null) {
      return { folders: current.folders, assignments: current.assignments, pinned: current.pinned };
    }
    const migrated = await migrateLegacyIfNeeded();
    return migrated || emptyData();
  }

  function setData(data) {
    return writeData(data);
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

    if (mode === "replace") {
      const replaced = { folders: parsed.folders, assignments: parsed.assignments, pinned: parsedPinned };
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

    await setData(data);
    return getData();
  }

  function onChange(callback) {
    const keysOfInterest = new Set([FOLDERS_KEY, PINNED_KEY, ...allChunkKeys()]);
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" && areaName !== "local") return;
      const touched = Object.keys(changes).some((k) => keysOfInterest.has(k));
      if (touched) callback();
    });
  }

  global.GHRF = {
    PALETTE,
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
    exportJSON,
    importJSON,
    onChange
  };
})(typeof window !== "undefined" ? window : this);
