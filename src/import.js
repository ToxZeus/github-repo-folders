(function () {
  const preview = document.getElementById("preview");
  const actions = document.getElementById("actions");
  const mergeBtn = document.getElementById("mergeBtn");
  const replaceBtn = document.getElementById("replaceBtn");
  const resultNote = document.getElementById("resultNote");

  let pendingJsonStr = null;
  let pendingSettings = null;

  function renderError(message) {
    preview.textContent = message;
    preview.classList.add("ghrf-import-error");
  }

  function renderPreview(parsed) {
    const folderCount = Array.isArray(parsed.folders) ? parsed.folders.length : 0;
    const repoCount = parsed.assignments ? Object.keys(parsed.assignments).length : 0;
    const pinnedCount = Array.isArray(parsed.pinned) ? parsed.pinned.length : 0;

    const summary = document.createElement("p");
    summary.textContent =
      `${folderCount} dossier${folderCount > 1 ? "s" : ""} · ${repoCount} repo${repoCount > 1 ? "s" : ""} classé${
        repoCount > 1 ? "s" : ""
      } · ${pinnedCount} épinglé${pinnedCount > 1 ? "s" : ""}` + (parsed.settings ? " · réglages inclus" : "");
    preview.appendChild(summary);

    if (folderCount > 0) {
      const list = document.createElement("ul");
      list.className = "ghrf-import-folder-list";
      parsed.folders.slice(0, 20).forEach((f) => {
        const li = document.createElement("li");
        const dot = document.createElement("span");
        dot.className = "ghrf-dot";
        dot.style.background = f.color || "#888";
        li.appendChild(dot);
        li.appendChild(document.createTextNode(" " + f.name));
        list.appendChild(li);
      });
      preview.appendChild(list);
      if (folderCount > 20) {
        const more = document.createElement("p");
        more.className = "ghrf-hint";
        more.textContent = `+ ${folderCount - 20} autre(s) dossier(s)...`;
        preview.appendChild(more);
      }
    }
  }

  async function init() {
    const hash = location.hash.slice(1);
    if (!hash) {
      renderError("Aucune donnée à importer dans ce lien.");
      return;
    }
    try {
      const jsonStr = await window.GHRFShareLink.readShareLink(hash);
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed.folders) || typeof parsed.assignments !== "object") {
        throw new Error("Structure inattendue.");
      }
      pendingJsonStr = jsonStr;
      pendingSettings = parsed.settings || null;
      renderPreview(parsed);
      actions.classList.remove("ghrf-hidden");
    } catch (err) {
      renderError("Impossible de lire ce lien : " + err.message);
    }
  }

  async function doImport(mode) {
    if (!pendingJsonStr) return;
    try {
      await window.GHRF.importJSON(pendingJsonStr, mode);
      if (pendingSettings) await window.GHRF.setSettings(pendingSettings);
      resultNote.textContent = "Importé avec succès ✓. Tu peux fermer cet onglet.";
      actions.classList.add("ghrf-hidden");
    } catch (err) {
      resultNote.textContent = "Erreur : " + err.message;
    }
  }

  mergeBtn.addEventListener("click", () => doImport("merge"));
  replaceBtn.addEventListener("click", () => {
    if (!window.confirm("Remplacer tous les dossiers actuels par ceux de ce lien ?")) return;
    doImport("replace");
  });

  init();
})();
