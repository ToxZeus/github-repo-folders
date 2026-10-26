/**
 * Injects a folder toolbar + per-repo controls into the GitHub
 * "Repositories" tab (https://github.com/<user>?tab=repositories).
 * Relies on window.GHRF (src/storage.js), loaded before this file.
 */
(function () {
  const FOLDER_ICON_SVG =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">' +
    '<path d="M1.75 2A1.75 1.75 0 0 0 0 3.75v8.5A1.75 1.75 0 0 0 1.75 14h12.5A1.75 1.75 0 0 0 16 12.25v-7.5A1.75 1.75 0 0 0 14.25 3H8.19a.25.25 0 0 1-.177-.073L6.927 1.84A1.75 1.75 0 0 0 5.683 1.3H1.75Z"></path>' +
    "</svg>";

  const STAR_ICON_SVG =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">' +
    '<path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path>' +
    "</svg>";

  const FOLDER_REORDER_MIME = "application/x-ghrf-folder-id";

  const state = {
    activeFolderId: null,
    language: "",
    hideArchived: false,
    hideForks: false,
    searchQuery: "",
    selectMode: false,
    selected: new Set()
  };
  let toolbarEl = null;
  let debounceTimer = null;
  let outsideCloseHandler = null;
  let escCloseHandler = null;

  // Cached rather than fetched per-render: renderAll() runs on every
  // ~200ms debounce tick and 1.5s safety interval, and most of these
  // values are only read synchronously inside event handlers (e.g. the
  // swatch picker), where awaiting a fresh chrome.storage read isn't an
  // option anyway. Refreshed once at startup and whenever GHRF.onChange
  // fires (which now also covers the settings key).
  let settingsCache = null;

  function currentSettings() {
    return settingsCache || window.GHRF.DEFAULT_SETTINGS_FALLBACK;
  }

  async function refreshSettingsCache() {
    settingsCache = await window.GHRF.getSettings();
  }

  // ---------- page adapters ----------
  // The Repositories tab and the Stars tab render repo lists with
  // completely different markup (the former is schema.org itemprop-based,
  // server-rendered the same way for years; the latter has no itemprop
  // hooks at all and leans on utility classes that look more likely to
  // shift over time). Everything downstream (toolbar, filters, decorate,
  // pinned-reorder) works purely in terms of these two adapters' interface
  // so it doesn't care which page it's on.

  const reposAdapter = {
    name: "repos",
    supportsTypeFilters: true,
    titleSelector: "h3.wb-break-all",
    getContainer() {
      return document.getElementById("user-repositories-list");
    },
    getRows(container) {
      return Array.from(container.querySelectorAll('li[itemprop="owns"]'));
    },
    extractInfo(row) {
      const a = row.querySelector('a[itemprop="name codeRepository"]');
      if (!a) return null;
      const fullName = (a.getAttribute("href") || "").replace(/^\//, "").trim();
      if (!fullName) return null;
      const langEl = row.querySelector('[itemprop="programmingLanguage"]');
      const language = langEl ? langEl.textContent.trim() : "";
      const isFork = row.classList.contains("fork");
      const labels = Array.from(row.querySelectorAll("h3 .Label")).map((s) => s.textContent.trim());
      const isArchived = labels.includes("Archived");
      return { fullName, language, isFork, isArchived };
    }
  };

  const starsAdapter = {
    name: "stars",
    // No archived/fork signal exists in this markup at all (not "unknown",
    // genuinely absent) — hide those filters rather than let them silently
    // no-op.
    supportsTypeFilters: false,
    titleSelector: "h3",
    getContainer() {
      return document.getElementById("user-starred-repos");
    },
    getRows(container) {
      // Deliberately not keyed off this page's utility classes (they read
      // as transitional and more likely to change than schema.org
      // itemprop markup). The one stable signal is the repo link itself:
      // each row is <h3><a href="/owner/repo">...</a></h3> wrapped one
      // level deep, so climb from the anchor instead of matching classes.
      const anchors = Array.from(container.querySelectorAll("h3 > a[href]"));
      const rows = [];
      const seen = new Set();
      anchors.forEach((a) => {
        const h3 = a.parentElement;
        const row = h3 && h3.parentElement && h3.parentElement.parentElement;
        if (row && !seen.has(row)) {
          seen.add(row);
          rows.push(row);
        }
      });
      return rows;
    },
    extractInfo(row) {
      const a = row.querySelector("h3 > a[href]");
      if (!a) return null;
      const fullName = (a.getAttribute("href") || "").replace(/^\//, "").trim();
      if (!fullName || fullName.split("/").length !== 2) return null;
      const langEl = row.querySelector('[itemprop="programmingLanguage"]');
      const language = langEl ? langEl.textContent.trim() : "";
      return { fullName, language, isFork: false, isArchived: false };
    }
  };

  function getActiveAdapter() {
    const reposContainer = reposAdapter.getContainer();
    if (reposContainer) return { adapter: reposAdapter, container: reposContainer };
    const starsContainer = starsAdapter.getContainer();
    if (starsContainer) return { adapter: starsAdapter, container: starsContainer };
    return null;
  }

  function collectLanguages(container) {
    const set = new Set();
    container.querySelectorAll('[itemprop="programmingLanguage"]').forEach((el) => {
      const t = el.textContent.trim();
      if (t) set.add(t);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  // ---------- popovers ----------

  function closeAnyPopover() {
    const existing = document.querySelector(".ghrf-popover");
    if (existing) existing.remove();
    if (outsideCloseHandler) document.removeEventListener("mousedown", outsideCloseHandler, true);
    if (escCloseHandler) document.removeEventListener("keydown", escCloseHandler, true);
    outsideCloseHandler = null;
    escCloseHandler = null;
  }

  function positionNear(pop, anchorEl, width) {
    const rect = anchorEl.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    // Positioned relative to the document (not the viewport) so the
    // popover scrolls together with the button it's anchored to, instead
    // of staying fixed on screen while the page scrolls underneath it.
    pop.style.position = "absolute";
    const top = Math.min(rect.bottom + 6, window.innerHeight - 20);
    pop.style.top = top + scrollY + "px";
    const maxLeft = window.innerWidth - (width + 32);
    const left = Math.max(8, Math.min(rect.left, maxLeft));
    pop.style.left = left + scrollX + "px";
  }

  function openPopover(anchorEl, buildFn) {
    closeAnyPopover();
    const pop = document.createElement("div");
    pop.className = "ghrf-popover";
    const width = currentSettings().popoverWidth;
    pop.style.width = width + "px";
    buildFn(pop);
    document.body.appendChild(pop);
    positionNear(pop, anchorEl, width);

    outsideCloseHandler = (e) => {
      if (!pop.contains(e.target) && e.target !== anchorEl) closeAnyPopover();
    };
    escCloseHandler = (e) => {
      if (e.key === "Escape") closeAnyPopover();
    };
    setTimeout(() => {
      document.addEventListener("mousedown", outsideCloseHandler, true);
      document.addEventListener("keydown", escCloseHandler, true);
    }, 0);
    return pop;
  }

  function buildSwatchRow(selectedColor) {
    let current = selectedColor;
    const el = document.createElement("div");
    el.className = "ghrf-swatches";
    const buttons = [];
    currentSettings().defaultPalette.forEach((color) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ghrf-swatch" + (color === current ? " selected" : "");
      b.style.background = color;
      b.addEventListener("click", () => {
        current = color;
        buttons.forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
      });
      buttons.push(b);
      el.appendChild(b);
    });
    return { el, getColor: () => current };
  }

  function openNewFolderPopover(anchorEl, onDone) {
    openPopover(anchorEl, (pop) => {
      pop.classList.add("ghrf-popover-form");

      const title = document.createElement("div");
      title.className = "ghrf-popover-title";
      title.textContent = "Nouveau dossier";
      pop.appendChild(title);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "ghrf-popover-input";
      input.placeholder = "Ex : VPS, École, Perso...";
      input.setAttribute("aria-label", "Nom du nouveau dossier");
      input.maxLength = 40;
      pop.appendChild(input);

      const swatches = buildSwatchRow(currentSettings().defaultPalette[0]);
      pop.appendChild(swatches.el);

      const actions = document.createElement("div");
      actions.className = "ghrf-popover-actions";
      const createBtn = document.createElement("button");
      createBtn.type = "button";
      createBtn.className = "ghrf-btn ghrf-btn-primary";
      createBtn.textContent = "Créer";
      createBtn.addEventListener("click", async () => {
        const name = input.value.trim();
        if (!name) {
          input.focus();
          return;
        }
        await window.GHRF.addFolder(name, swatches.getColor());
        closeAnyPopover();
        onDone();
      });
      actions.appendChild(createBtn);
      pop.appendChild(actions);

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") createBtn.click();
      });
      setTimeout(() => input.focus(), 0);
    });
  }

  function openEditFolderPopover(anchorEl, folder, onDone) {
    openPopover(anchorEl, (pop) => {
      pop.classList.add("ghrf-popover-form");

      const title = document.createElement("div");
      title.className = "ghrf-popover-title";
      title.textContent = "Modifier le dossier";
      pop.appendChild(title);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "ghrf-popover-input";
      input.value = folder.name;
      input.setAttribute("aria-label", "Nom du dossier");
      input.maxLength = 40;
      pop.appendChild(input);

      const swatches = buildSwatchRow(folder.color);
      pop.appendChild(swatches.el);

      const actions = document.createElement("div");
      actions.className = "ghrf-popover-actions";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "ghrf-btn ghrf-btn-primary";
      saveBtn.textContent = "Enregistrer";
      saveBtn.addEventListener("click", async () => {
        const name = input.value.trim();
        if (name) await window.GHRF.renameFolder(folder.id, name);
        await window.GHRF.recolorFolder(folder.id, swatches.getColor());
        closeAnyPopover();
        onDone();
      });
      actions.appendChild(saveBtn);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "ghrf-btn ghrf-btn-danger";
      delBtn.textContent = "Supprimer";
      delBtn.addEventListener("click", async () => {
        if (
          !window.confirm(
            `Supprimer le dossier "${folder.name}" ? Les repos ne seront pas supprimés, seulement déclassés.`
          )
        )
          return;
        await window.GHRF.deleteFolder(folder.id);
        closeAnyPopover();
        onDone();
      });
      actions.appendChild(delBtn);

      pop.appendChild(actions);
      setTimeout(() => input.focus(), 0);
    });
  }

  async function openAssignPopover(anchorEl, fullName, onDone) {
    const data = await window.GHRF.getData();
    openPopover(anchorEl, (pop) => {
      pop.classList.add("ghrf-popover-assign");

      const title = document.createElement("div");
      title.className = "ghrf-popover-title";
      title.textContent = "Classer dans...";
      pop.appendChild(title);

      if (data.folders.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ghrf-popover-empty";
        empty.textContent = "Aucun dossier pour le moment. Crée-en un dans la barre au-dessus.";
        pop.appendChild(empty);
        return;
      }

      const assigned = new Set(data.assignments[fullName] || []);
      data.folders.forEach((folder) => {
        const row = document.createElement("label");
        row.className = "ghrf-check-row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = assigned.has(folder.id);
        cb.addEventListener("change", async () => {
          await window.GHRF.toggleAssignment(fullName, folder.id);
          onDone();
        });
        row.appendChild(cb);
        const dot = document.createElement("span");
        dot.className = "ghrf-dot";
        dot.style.background = folder.color;
        row.appendChild(dot);
        row.appendChild(document.createTextNode(folder.name));
        pop.appendChild(row);
      });
    });
  }

  // ---------- rendering ----------

  function applyPinnedOrder(adapter, container, pinned) {
    const rows = adapter.getRows(container);
    if (rows.length === 0) return;
    const listRoot = rows[0].parentElement;
    if (!listRoot) return;

    const oldHeading = listRoot.querySelector(".ghrf-pinned-heading-row");
    if (oldHeading) oldHeading.remove();

    const pinnedSet = new Set(pinned || []);
    const visible = rows.filter((row) => row.style.display !== "none");
    const pinnedVisible = visible.filter((row) => pinnedSet.has(row.dataset.ghrfRepo));
    const restVisible = visible.filter((row) => !pinnedSet.has(row.dataset.ghrfRepo));
    if (pinnedVisible.length === 0 || restVisible.length === 0) return;

    // Same tag as the rows themselves (<li> for Repositories, <div> for
    // Stars) so it's valid to interleave with them in their shared parent.
    const heading = document.createElement(rows[0].tagName.toLowerCase());
    heading.className = "ghrf-pinned-heading-row";
    heading.style.listStyle = "none";
    const headingLabel = document.createElement("div");
    headingLabel.className = "ghrf-pinned-heading";
    headingLabel.textContent = "★ Épinglés";
    heading.appendChild(headingLabel);

    pinnedVisible.forEach((row) => listRoot.appendChild(row));
    listRoot.appendChild(heading);
    restVisible.forEach((row) => listRoot.appendChild(row));
  }

  function applyFilters(adapter, container) {
    window.GHRF.getData().then((data) => {
      const rows = adapter.getRows(container);
      let shown = 0;
      rows.forEach((row) => {
        const info = adapter.extractInfo(row);
        if (!info) return;
        let visible = true;
        if (state.activeFolderId) {
          const ids = data.assignments[info.fullName] || [];
          if (!ids.includes(state.activeFolderId)) visible = false;
        }
        if (visible && state.language && info.language !== state.language) visible = false;
        if (visible && adapter.supportsTypeFilters && state.hideArchived && info.isArchived) visible = false;
        if (visible && adapter.supportsTypeFilters && state.hideForks && info.isFork) visible = false;
        if (visible && state.searchQuery) {
          const q = state.searchQuery.trim().toLowerCase();
          const matchesName = info.fullName.toLowerCase().includes(q);
          const matchesLanguage = currentSettings().searchMatchLanguageToo && info.language.toLowerCase().includes(q);
          if (q && !matchesName && !matchesLanguage) visible = false;
        }
        if (visible) {
          row.style.removeProperty("display");
        } else {
          // GitHub's own ".d-flex{display:flex!important}" class on these
          // rows beats a plain inline style, so force ours too.
          row.style.setProperty("display", "none", "important");
        }
        if (visible) shown++;
      });
      applyPinnedOrder(adapter, container, data.pinned);
      const countLabel = toolbarEl && toolbarEl.querySelector(".ghrf-count-label");
      if (countLabel) {
        countLabel.textContent = `${shown} / ${rows.length} repo${rows.length > 1 ? "s" : ""} affiché${
          shown > 1 ? "s" : ""
        }`;
      }
    });
  }

  function renderToolbar(adapter, data, container) {
    const prevSearch = toolbarEl.querySelector(".ghrf-search-input");
    const searchHadFocus = !!prevSearch && prevSearch === document.activeElement;
    const searchSelStart = searchHadFocus ? prevSearch.selectionStart : null;
    const searchSelEnd = searchHadFocus ? prevSearch.selectionEnd : null;

    toolbarEl.innerHTML = "";

    const chipsRow = document.createElement("div");
    chipsRow.className = "ghrf-chips-row";

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "ghrf-chip ghrf-chip-all" + (state.activeFolderId ? "" : " active");
    allChip.textContent = "Tous";
    allChip.addEventListener("click", () => {
      state.activeFolderId = null;
      renderAll();
    });
    chipsRow.appendChild(allChip);

    data.folders.forEach((folder) => {
      const count = Object.values(data.assignments).filter((ids) => ids.includes(folder.id)).length;
      const chip = document.createElement("div");
      chip.className = "ghrf-chip" + (state.activeFolderId === folder.id ? " active" : "");

      const dot = document.createElement("span");
      dot.className = "ghrf-chip-dot";
      dot.style.background = folder.color;
      chip.appendChild(dot);

      const label = document.createElement("span");
      label.className = "ghrf-chip-label";
      label.textContent = folder.name;
      chip.appendChild(label);

      const countEl = document.createElement("span");
      countEl.className = "ghrf-chip-count";
      countEl.textContent = String(count);
      chip.appendChild(countEl);

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ghrf-chip-edit";
      editBtn.title = "Modifier ce dossier";
      editBtn.textContent = "⋯";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditFolderPopover(editBtn, folder, renderAll);
      });
      chip.appendChild(editBtn);

      chip.addEventListener("click", () => {
        state.activeFolderId = state.activeFolderId === folder.id ? null : folder.id;
        renderAll();
      });

      // Dragging the chip itself reorders folders; dropping a repo <li> onto
      // it (existing behaviour) assigns that repo. Distinct dataTransfer
      // types keep the two gestures from colliding on the same element.
      chip.draggable = true;
      chip.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(FOLDER_REORDER_MIME, folder.id);
        e.dataTransfer.effectAllowed = "move";
        chip.classList.add("ghrf-chip-dragging");
      });
      chip.addEventListener("dragend", () => chip.classList.remove("ghrf-chip-dragging"));

      chip.addEventListener("dragover", (e) => {
        e.preventDefault();
        chip.classList.add("ghrf-drop-hover");
      });
      chip.addEventListener("dragleave", () => chip.classList.remove("ghrf-drop-hover"));
      chip.addEventListener("drop", async (e) => {
        e.preventDefault();
        chip.classList.remove("ghrf-drop-hover");

        const draggedFolderId = e.dataTransfer.getData(FOLDER_REORDER_MIME);
        if (draggedFolderId) {
          if (draggedFolderId !== folder.id) {
            const orderedIds = data.folders.map((f) => f.id);
            const fromIdx = orderedIds.indexOf(draggedFolderId);
            const toIdx = orderedIds.indexOf(folder.id);
            if (fromIdx !== -1 && toIdx !== -1) {
              orderedIds.splice(fromIdx, 1);
              orderedIds.splice(toIdx, 0, draggedFolderId);
              await window.GHRF.reorderFolders(orderedIds);
              renderAll();
            }
          }
          return;
        }

        const fullName = e.dataTransfer.getData("text/plain");
        if (!fullName) return;
        await window.GHRF.addAssignment(fullName, folder.id);
        renderAll();
      });

      chipsRow.appendChild(chip);
    });

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "ghrf-add-folder-btn";
    addBtn.textContent = "+ Nouveau dossier";
    addBtn.addEventListener("click", () => openNewFolderPopover(addBtn, renderAll));
    chipsRow.appendChild(addBtn);

    const selectToggleBtn = document.createElement("button");
    selectToggleBtn.type = "button";
    selectToggleBtn.className = "ghrf-select-toggle-btn" + (state.selectMode ? " active" : "");
    selectToggleBtn.textContent = state.selectMode ? "Terminer la sélection" : "Sélectionner";
    selectToggleBtn.addEventListener("click", () => {
      state.selectMode = !state.selectMode;
      if (!state.selectMode) state.selected.clear();
      renderAll();
    });
    chipsRow.appendChild(selectToggleBtn);

    toolbarEl.appendChild(chipsRow);

    if (state.selectMode) {
      const bulkRow = document.createElement("div");
      bulkRow.className = "ghrf-bulk-row";

      const countEl = document.createElement("span");
      countEl.className = "ghrf-bulk-count";
      countEl.textContent = `${state.selected.size} sélectionné${state.selected.size > 1 ? "s" : ""}`;
      bulkRow.appendChild(countEl);

      const bulkSelect = document.createElement("select");
      bulkSelect.className = "ghrf-bulk-folder-select";
      bulkSelect.setAttribute("aria-label", "Dossier à assigner aux repos sélectionnés");
      if (data.folders.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Aucun dossier";
        bulkSelect.appendChild(opt);
        bulkSelect.disabled = true;
      } else {
        data.folders.forEach((folder) => {
          const opt = document.createElement("option");
          opt.value = folder.id;
          opt.textContent = folder.name;
          bulkSelect.appendChild(opt);
        });
      }
      bulkRow.appendChild(bulkSelect);

      const assignBtn = document.createElement("button");
      assignBtn.type = "button";
      assignBtn.className = "ghrf-btn ghrf-btn-primary ghrf-bulk-assign-btn";
      assignBtn.textContent = "Assigner";
      assignBtn.disabled = state.selected.size === 0 || data.folders.length === 0;
      assignBtn.addEventListener("click", async () => {
        if (!bulkSelect.value || state.selected.size === 0) return;
        await window.GHRF.assignMany(Array.from(state.selected), bulkSelect.value);
        state.selectMode = false;
        state.selected.clear();
        renderAll();
      });
      bulkRow.appendChild(assignBtn);

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "ghrf-btn";
      cancelBtn.textContent = "Annuler";
      cancelBtn.addEventListener("click", () => {
        state.selectMode = false;
        state.selected.clear();
        renderAll();
      });
      bulkRow.appendChild(cancelBtn);

      toolbarEl.appendChild(bulkRow);
    }

    const filtersRow = document.createElement("div");
    filtersRow.className = "ghrf-filters";

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "ghrf-search-input";
    searchInput.placeholder = "Rechercher un repo...";
    searchInput.setAttribute("aria-label", "Rechercher un repo par nom");
    searchInput.value = state.searchQuery;
    searchInput.addEventListener("input", () => {
      state.searchQuery = searchInput.value;
      applyFilters(adapter, container);
    });
    filtersRow.appendChild(searchInput);
    if (searchHadFocus) {
      searchInput.focus();
      searchInput.setSelectionRange(searchSelStart, searchSelEnd);
    }

    const langSelect = document.createElement("select");
    langSelect.className = "ghrf-lang-select";
    langSelect.setAttribute("aria-label", "Filtrer par langage");
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Tous les langages";
    langSelect.appendChild(optAll);
    collectLanguages(container).forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      if (state.language === l) opt.selected = true;
      langSelect.appendChild(opt);
    });
    langSelect.addEventListener("change", () => {
      state.language = langSelect.value;
      applyFilters(adapter, container);
    });
    filtersRow.appendChild(langSelect);

    if (adapter.supportsTypeFilters) {
      const archLabel = document.createElement("label");
      archLabel.className = "ghrf-check-label";
      const archCb = document.createElement("input");
      archCb.type = "checkbox";
      archCb.checked = state.hideArchived;
      archCb.addEventListener("change", () => {
        state.hideArchived = archCb.checked;
        applyFilters(adapter, container);
      });
      archLabel.appendChild(archCb);
      archLabel.appendChild(document.createTextNode(" Masquer archivés"));
      filtersRow.appendChild(archLabel);

      const forkLabel = document.createElement("label");
      forkLabel.className = "ghrf-check-label";
      const forkCb = document.createElement("input");
      forkCb.type = "checkbox";
      forkCb.checked = state.hideForks;
      forkCb.addEventListener("change", () => {
        state.hideForks = forkCb.checked;
        applyFilters(adapter, container);
      });
      forkLabel.appendChild(forkCb);
      forkLabel.appendChild(document.createTextNode(" Masquer forks"));
      filtersRow.appendChild(forkLabel);
    }

    const countLabel = document.createElement("span");
    countLabel.className = "ghrf-count-label";
    filtersRow.appendChild(countLabel);

    toolbarEl.appendChild(filtersRow);

    const syncNote = document.createElement("div");
    syncNote.className = "ghrf-sync-note";
    syncNote.textContent = "🔄 Dossiers synchronisés via ton compte Chrome";
    toolbarEl.appendChild(syncNote);

    applyFilters(adapter, container);
  }

  function decorateRepoItems(adapter, container, data) {
    const rows = adapter.getRows(container);
    rows.forEach((row) => {
      const info = adapter.extractInfo(row);
      if (!info) return;
      row.dataset.ghrfRepo = info.fullName;

      if (!row.dataset.ghrfBound) {
        row.dataset.ghrfBound = "1";
        row.classList.add("ghrf-li-anchor");
        row.draggable = true;
        row.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", row.dataset.ghrfRepo);
          e.dataTransfer.effectAllowed = "copy";
          row.classList.add("ghrf-dragging");
        });
        row.addEventListener("dragend", () => row.classList.remove("ghrf-dragging"));

        const controls = document.createElement("div");
        controls.className = "ghrf-repo-controls";

        const selectCb = document.createElement("input");
        selectCb.type = "checkbox";
        selectCb.className = "ghrf-select-cb";
        selectCb.title = "Sélectionner ce repo";
        selectCb.addEventListener("click", (e) => e.stopPropagation());
        selectCb.addEventListener("change", () => {
          const fullName = row.dataset.ghrfRepo;
          if (selectCb.checked) state.selected.add(fullName);
          else state.selected.delete(fullName);
          updateBulkBar();
        });
        controls.appendChild(selectCb);

        const pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = "ghrf-pin-btn";
        pinBtn.title = "Épingler ce repo";
        pinBtn.innerHTML = STAR_ICON_SVG;
        pinBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await window.GHRF.togglePin(row.dataset.ghrfRepo);
          renderAll();
        });
        controls.appendChild(pinBtn);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ghrf-badge-btn";
        btn.title = "Classer ce repo dans un dossier";
        btn.innerHTML = FOLDER_ICON_SVG;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openAssignPopover(btn, row.dataset.ghrfRepo, renderAll);
        });
        controls.appendChild(btn);
        row.appendChild(controls);

        const titleEl = row.querySelector(adapter.titleSelector);
        if (titleEl) {
          const dots = document.createElement("span");
          dots.className = "ghrf-title-dots";
          titleEl.appendChild(dots);
        }
      }

      const dotsEl = row.querySelector(".ghrf-title-dots");
      if (dotsEl) {
        dotsEl.innerHTML = "";
        (data.assignments[info.fullName] || []).forEach((id) => {
          const folder = data.folders.find((f) => f.id === id);
          if (!folder) return;
          const dot = document.createElement("span");
          dot.className = "ghrf-dot";
          dot.style.background = folder.color;
          dot.title = folder.name;
          dotsEl.appendChild(dot);
        });
      }

      const isPinned = (data.pinned || []).includes(info.fullName);
      const pinBtn = row.querySelector(".ghrf-pin-btn");
      if (pinBtn) {
        pinBtn.classList.toggle("pinned", isPinned);
        pinBtn.title = isPinned ? "Désépingler ce repo" : "Épingler ce repo";
      }

      const selectCb = row.querySelector(".ghrf-select-cb");
      if (selectCb) {
        selectCb.style.display = state.selectMode ? "" : "none";
        selectCb.checked = state.selected.has(info.fullName);
      }
    });
  }

  function updateBulkBar() {
    if (!toolbarEl) return;
    const countEl = toolbarEl.querySelector(".ghrf-bulk-count");
    if (countEl) {
      countEl.textContent = `${state.selected.size} sélectionné${state.selected.size > 1 ? "s" : ""}`;
    }
    const assignBtn = toolbarEl.querySelector(".ghrf-bulk-assign-btn");
    if (assignBtn) {
      const bulkSelect = toolbarEl.querySelector(".ghrf-bulk-folder-select");
      assignBtn.disabled = state.selected.size === 0 || !bulkSelect || !bulkSelect.value;
    }
  }

  // Tracks which container the current toolbar was built for, so switching
  // between the Repositories and Stars tabs via Turbo's soft navigation
  // (which may not remove a toolbar left over from the other page type)
  // triggers a proper rebuild instead of reusing a stale, misplaced one.
  let toolbarForContainer = null;

  function ensureToolbar(container) {
    if (toolbarEl && document.body.contains(toolbarEl) && toolbarForContainer === container) {
      return toolbarEl;
    }
    if (toolbarEl) toolbarEl.remove();
    toolbarEl = document.createElement("div");
    toolbarEl.id = "ghrf-toolbar";
    toolbarEl.className = "ghrf-toolbar";
    container.parentNode.insertBefore(toolbarEl, container);
    toolbarForContainer = container;
    return toolbarEl;
  }

  function toolbarNeedsRebuild(active) {
    if (!active) return false;
    return !toolbarEl || !document.body.contains(toolbarEl) || toolbarForContainer !== active.container;
  }

  async function renderAll() {
    const active = getActiveAdapter();
    if (!active) {
      if (toolbarEl) {
        toolbarEl.remove();
        toolbarEl = null;
        toolbarForContainer = null;
      }
      return;
    }
    const { adapter, container } = active;
    ensureToolbar(container);
    const data = await window.GHRF.getData();
    decorateRepoItems(adapter, container, data);
    renderToolbar(adapter, data, container);
  }

  function scheduleRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderAll, currentSettings().renderDebounceMs);
  }

  const observer = new MutationObserver(() => {
    const active = getActiveAdapter();
    if (toolbarNeedsRebuild(active)) {
      scheduleRender();
    } else if (!active && toolbarEl) {
      toolbarEl.remove();
      toolbarEl = null;
      toolbarForContainer = null;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("turbo:load", scheduleRender);
  document.addEventListener("turbo:render", scheduleRender);

  // Re-render when data changes elsewhere (another tab, or a pull from sync
  // after an edit made on a different device) — also the trigger for
  // picking up settings changes, since settings now share this same
  // storage.onChanged plumbing.
  window.GHRF.onChange(() => {
    refreshSettingsCache();
    scheduleRender();
  });

  // Safety net: GitHub's soft navigation can occasionally swap the repo
  // list without the toolbar surviving; this catches that within
  // settings.safetyIntervalMs. Self-rescheduling (rather than
  // setInterval) so a settings change takes effect on its very next tick
  // instead of requiring a page reload.
  function scheduleSafetyCheck() {
    setTimeout(() => {
      if (toolbarNeedsRebuild(getActiveAdapter())) scheduleRender();
      scheduleSafetyCheck();
    }, currentSettings().safetyIntervalMs);
  }
  scheduleSafetyCheck();

  refreshSettingsCache().then(scheduleRender);
  scheduleRender();
})();
