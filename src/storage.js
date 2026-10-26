/**
 * Shared storage layer for GitHub Repo Folders.
 * Loaded as a plain script in both the content script and the popup,
 * exposing everything under window.GHRF.
 */
(function (global) {
  const STORAGE_KEY = "ghRepoFolders_v1";

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

  function emptyData() {
    return { folders: [], assignments: {} };
  }

  function genId() {
    return "f_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function getData() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const data = res[STORAGE_KEY];
        if (!data || !Array.isArray(data.folders) || typeof data.assignments !== "object") {
          resolve(emptyData());
        } else {
          resolve(data);
        }
      });
    });
  }

  function setData(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
    });
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

  function exportJSON(data) {
    return JSON.stringify(
      { version: 1, exportedAt: new Date().toISOString(), ...data },
      null,
      2
    );
  }

  async function importJSON(jsonStr, mode) {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed.folders) || typeof parsed.assignments !== "object") {
      throw new Error("Fichier invalide : structure inattendue.");
    }
    if (mode === "replace") {
      await setData({ folders: parsed.folders, assignments: parsed.assignments });
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
    await setData(data);
    return getData();
  }

  global.GHRF = {
    PALETTE,
    getData,
    setData,
    addFolder,
    renameFolder,
    recolorFolder,
    deleteFolder,
    toggleAssignment,
    addAssignment,
    exportJSON,
    importJSON
  };
})(typeof window !== "undefined" ? window : this);
