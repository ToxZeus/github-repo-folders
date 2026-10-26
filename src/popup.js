(function () {
  const folderListEl = document.getElementById("folderList");
  const statsEl = document.getElementById("stats");
  const nameInput = document.getElementById("newFolderName");
  const swatchesEl = document.getElementById("newFolderSwatches");
  const createBtn = document.getElementById("createFolderBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importMergeBtn = document.getElementById("importMergeBtn");
  const importReplaceBtn = document.getElementById("importReplaceBtn");
  const importFile = document.getElementById("importFile");

  let pendingColor = window.GHRF.PALETTE[0];
  let pendingMode = "merge";

  function renderSwatches(container, selected, onPick) {
    container.innerHTML = "";
    window.GHRF.PALETTE.forEach((color) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ghrf-swatch" + (color === selected ? " selected" : "");
      b.style.background = color;
      b.addEventListener("click", () => {
        container.querySelectorAll(".ghrf-swatch").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        onPick(color);
      });
      container.appendChild(b);
    });
  }

  async function render() {
    const data = await window.GHRF.getData();
    const repoCount = Object.keys(data.assignments).length;
    statsEl.textContent = `${data.folders.length} dossier${data.folders.length > 1 ? "s" : ""} · ${repoCount} repo${
      repoCount > 1 ? "s" : ""
    } classé${repoCount > 1 ? "s" : ""}`;

    folderListEl.innerHTML = "";
    if (data.folders.length === 0) {
      const empty = document.createElement("p");
      empty.className = "ghrf-hint";
      empty.textContent = "Aucun dossier pour le moment.";
      folderListEl.appendChild(empty);
    }

    data.folders.forEach((folder) => {
      const count = Object.values(data.assignments).filter((ids) => ids.includes(folder.id)).length;

      const row = document.createElement("div");
      row.className = "ghrf-folder-row";

      const colorBtn = document.createElement("button");
      colorBtn.type = "button";
      colorBtn.className = "ghrf-color-btn";
      colorBtn.style.background = folder.color;
      colorBtn.title = "Changer la couleur";
      row.appendChild(colorBtn);

      const nameField = document.createElement("input");
      nameField.type = "text";
      nameField.className = "ghrf-name-field";
      nameField.value = folder.name;
      nameField.setAttribute("aria-label", "Nom du dossier");
      nameField.maxLength = 40;
      nameField.addEventListener("change", async () => {
        const v = nameField.value.trim();
        if (v && v !== folder.name) {
          await window.GHRF.renameFolder(folder.id, v);
          render();
        } else {
          nameField.value = folder.name;
        }
      });
      row.appendChild(nameField);

      const countEl = document.createElement("span");
      countEl.className = "ghrf-folder-count";
      countEl.textContent = String(count);
      row.appendChild(countEl);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "ghrf-icon-btn";
      delBtn.title = "Supprimer ce dossier";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", async () => {
        if (!window.confirm(`Supprimer "${folder.name}" ? Les repos ne seront pas supprimés, seulement déclassés.`))
          return;
        await window.GHRF.deleteFolder(folder.id);
        render();
      });
      row.appendChild(delBtn);

      folderListEl.appendChild(row);

      const palette = document.createElement("div");
      palette.className = "ghrf-swatches ghrf-inline-swatches ghrf-hidden";
      renderSwatches(palette, folder.color, async (color) => {
        await window.GHRF.recolorFolder(folder.id, color);
        colorBtn.style.background = color;
      });
      folderListEl.appendChild(palette);

      colorBtn.addEventListener("click", () => {
        palette.classList.toggle("ghrf-hidden");
      });
    });
  }

  renderSwatches(swatchesEl, pendingColor, (c) => (pendingColor = c));

  createBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    await window.GHRF.addFolder(name, pendingColor);
    nameInput.value = "";
    render();
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") createBtn.click();
  });

  exportBtn.addEventListener("click", async () => {
    const data = await window.GHRF.getData();
    const json = window.GHRF.exportJSON(data);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `github-repo-folders-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  importMergeBtn.addEventListener("click", () => {
    pendingMode = "merge";
    importFile.click();
  });
  importReplaceBtn.addEventListener("click", () => {
    if (!window.confirm("Remplacer tous les dossiers actuels par ceux du fichier importé ?")) return;
    pendingMode = "replace";
    importFile.click();
  });
  importFile.addEventListener("change", async () => {
    const file = importFile.files[0];
    importFile.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      await window.GHRF.importJSON(text, pendingMode);
      render();
    } catch (err) {
      window.alert("Import impossible : " + err.message);
    }
  });

  render();
})();
