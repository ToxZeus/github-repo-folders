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

  const state = { activeFolderId: null, language: "", hideArchived: false, hideForks: false };
  let toolbarEl = null;
  let debounceTimer = null;
  let outsideCloseHandler = null;
  let escCloseHandler = null;

  function getRepoContainer() {
    return document.getElementById("user-repositories-list");
  }

  function extractRepoInfo(li) {
    const a = li.querySelector('a[itemprop="name codeRepository"]');
    if (!a) return null;
    const fullName = (a.getAttribute("href") || "").replace(/^\//, "").trim();
    if (!fullName) return null;
    const langEl = li.querySelector('[itemprop="programmingLanguage"]');
    const language = langEl ? langEl.textContent.trim() : "";
    const isFork = li.classList.contains("fork");
    const labels = Array.from(li.querySelectorAll("h3 .Label")).map((s) => s.textContent.trim());
    const isArchived = labels.includes("Archived");
    return { fullName, language, isFork, isArchived };
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

  function positionNear(pop, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top = Math.min(rect.bottom + 6, window.innerHeight - 20) + "px";
    const maxLeft = window.innerWidth - 272;
    pop.style.left = Math.max(8, Math.min(rect.left, maxLeft)) + "px";
  }

  function openPopover(anchorEl, buildFn) {
    closeAnyPopover();
    const pop = document.createElement("div");
    pop.className = "ghrf-popover";
    buildFn(pop);
    document.body.appendChild(pop);
    positionNear(pop, anchorEl);

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
    window.GHRF.PALETTE.forEach((color) => {
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

      const swatches = buildSwatchRow(window.GHRF.PALETTE[0]);
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

  function applyPinnedOrder(container, pinned) {
    const ul = container.querySelector("ul");
    if (!ul) return;
    const oldHeading = ul.querySelector(".ghrf-pinned-heading-row");
    if (oldHeading) oldHeading.remove();

    const pinnedSet = new Set(pinned || []);
    const items = Array.from(container.querySelectorAll('li[itemprop="owns"]'));
    const visible = items.filter((li) => li.style.display !== "none");
    const pinnedVisible = visible.filter((li) => pinnedSet.has(li.dataset.ghrfRepo));
    const restVisible = visible.filter((li) => !pinnedSet.has(li.dataset.ghrfRepo));
    if (pinnedVisible.length === 0 || restVisible.length === 0) return;

    const heading = document.createElement("li");
    heading.className = "ghrf-pinned-heading-row";
    heading.style.listStyle = "none";
    const headingLabel = document.createElement("div");
    headingLabel.className = "ghrf-pinned-heading";
    headingLabel.textContent = "★ Épinglés";
    heading.appendChild(headingLabel);

    pinnedVisible.forEach((li) => ul.appendChild(li));
    ul.appendChild(heading);
    restVisible.forEach((li) => ul.appendChild(li));
  }

  function applyFilters(container) {
    window.GHRF.getData().then((data) => {
      const items = container.querySelectorAll('li[itemprop="owns"]');
      let shown = 0;
      items.forEach((li) => {
        const info = extractRepoInfo(li);
        if (!info) return;
        let visible = true;
        if (state.activeFolderId) {
          const ids = data.assignments[info.fullName] || [];
          if (!ids.includes(state.activeFolderId)) visible = false;
        }
        if (visible && state.language && info.language !== state.language) visible = false;
        if (visible && state.hideArchived && info.isArchived) visible = false;
        if (visible && state.hideForks && info.isFork) visible = false;
        if (visible) {
          li.style.removeProperty("display");
        } else {
          // GitHub's own ".d-flex{display:flex!important}" class on these
          // <li> elements beats a plain inline style, so force ours too.
          li.style.setProperty("display", "none", "important");
        }
        if (visible) shown++;
      });
      applyPinnedOrder(container, data.pinned);
      const countLabel = toolbarEl && toolbarEl.querySelector(".ghrf-count-label");
      if (countLabel) {
        countLabel.textContent = `${shown} / ${items.length} repo${items.length > 1 ? "s" : ""} affiché${
          shown > 1 ? "s" : ""
        }`;
      }
    });
  }

  function renderToolbar(data, container) {
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

      chip.addEventListener("dragover", (e) => {
        e.preventDefault();
        chip.classList.add("ghrf-drop-hover");
      });
      chip.addEventListener("dragleave", () => chip.classList.remove("ghrf-drop-hover"));
      chip.addEventListener("drop", async (e) => {
        e.preventDefault();
        chip.classList.remove("ghrf-drop-hover");
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

    toolbarEl.appendChild(chipsRow);

    const filtersRow = document.createElement("div");
    filtersRow.className = "ghrf-filters";

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
      applyFilters(container);
    });
    filtersRow.appendChild(langSelect);

    const archLabel = document.createElement("label");
    archLabel.className = "ghrf-check-label";
    const archCb = document.createElement("input");
    archCb.type = "checkbox";
    archCb.checked = state.hideArchived;
    archCb.addEventListener("change", () => {
      state.hideArchived = archCb.checked;
      applyFilters(container);
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
      applyFilters(container);
    });
    forkLabel.appendChild(forkCb);
    forkLabel.appendChild(document.createTextNode(" Masquer forks"));
    filtersRow.appendChild(forkLabel);

    const countLabel = document.createElement("span");
    countLabel.className = "ghrf-count-label";
    filtersRow.appendChild(countLabel);

    toolbarEl.appendChild(filtersRow);

    const syncNote = document.createElement("div");
    syncNote.className = "ghrf-sync-note";
    syncNote.textContent = "🔄 Dossiers synchronisés via ton compte Chrome";
    toolbarEl.appendChild(syncNote);

    applyFilters(container);
  }

  function decorateRepoItems(container, data) {
    const items = container.querySelectorAll('li[itemprop="owns"]');
    items.forEach((li) => {
      const info = extractRepoInfo(li);
      if (!info) return;
      li.dataset.ghrfRepo = info.fullName;

      if (!li.dataset.ghrfBound) {
        li.dataset.ghrfBound = "1";
        li.classList.add("ghrf-li-anchor");
        li.draggable = true;
        li.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", li.dataset.ghrfRepo);
          e.dataTransfer.effectAllowed = "copy";
          li.classList.add("ghrf-dragging");
        });
        li.addEventListener("dragend", () => li.classList.remove("ghrf-dragging"));

        const controls = document.createElement("div");
        controls.className = "ghrf-repo-controls";

        const pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = "ghrf-pin-btn";
        pinBtn.title = "Épingler ce repo";
        pinBtn.innerHTML = STAR_ICON_SVG;
        pinBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await window.GHRF.togglePin(li.dataset.ghrfRepo);
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
          openAssignPopover(btn, li.dataset.ghrfRepo, renderAll);
        });
        controls.appendChild(btn);
        li.appendChild(controls);

        const h3 = li.querySelector("h3.wb-break-all");
        if (h3) {
          const dots = document.createElement("span");
          dots.className = "ghrf-title-dots";
          h3.appendChild(dots);
        }
      }

      const dotsEl = li.querySelector(".ghrf-title-dots");
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
      const pinBtn = li.querySelector(".ghrf-pin-btn");
      if (pinBtn) {
        pinBtn.classList.toggle("pinned", isPinned);
        pinBtn.title = isPinned ? "Désépingler ce repo" : "Épingler ce repo";
      }
    });
  }

  function ensureToolbar(container) {
    if (toolbarEl && document.body.contains(toolbarEl)) return toolbarEl;
    toolbarEl = document.createElement("div");
    toolbarEl.id = "ghrf-toolbar";
    toolbarEl.className = "ghrf-toolbar";
    container.parentNode.insertBefore(toolbarEl, container);
    return toolbarEl;
  }

  async function renderAll() {
    const container = getRepoContainer();
    if (!container) {
      if (toolbarEl) {
        toolbarEl.remove();
        toolbarEl = null;
      }
      return;
    }
    ensureToolbar(container);
    const data = await window.GHRF.getData();
    decorateRepoItems(container, data);
    renderToolbar(data, container);
  }

  function scheduleRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderAll, 200);
  }

  const observer = new MutationObserver(() => {
    const container = getRepoContainer();
    if (container && (!toolbarEl || !document.body.contains(toolbarEl))) {
      scheduleRender();
    } else if (!container && toolbarEl) {
      toolbarEl.remove();
      toolbarEl = null;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("turbo:load", scheduleRender);
  document.addEventListener("turbo:render", scheduleRender);

  // Re-render when data changes elsewhere (another tab, or a pull from sync
  // after an edit made on a different device).
  window.GHRF.onChange(scheduleRender);

  // Safety net: GitHub's soft navigation can occasionally swap the repo
  // list without the toolbar surviving; this catches that within ~1.5s.
  setInterval(() => {
    const container = getRepoContainer();
    if (container && (!toolbarEl || !document.body.contains(toolbarEl))) {
      scheduleRender();
    }
  }, 1500);

  scheduleRender();
})();
