(function () {
  const viewSelect = document.getElementById("viewSelect");
  const statsLine = document.getElementById("statsLine");
  const content = document.getElementById("content");

  function repoUrl(fullName) {
    return `https://github.com/${fullName}`;
  }

  function buildRepoRow(fullName, data) {
    const row = document.createElement("div");
    row.className = "ghrf-dash-repo";

    const link = document.createElement("a");
    link.href = repoUrl(fullName);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "ghrf-dash-repo-link";
    link.textContent = fullName;
    row.appendChild(link);

    if ((data.pinned || []).includes(fullName)) {
      const pin = document.createElement("span");
      pin.className = "ghrf-dash-repo-pin";
      pin.title = "Épinglé";
      pin.textContent = "⭐";
      row.appendChild(pin);
    }

    const note = data.notes && data.notes[fullName];
    if (note) {
      const noteEl = document.createElement("span");
      noteEl.className = "ghrf-dash-repo-note";
      noteEl.title = note;
      noteEl.textContent = "📝";
      row.appendChild(noteEl);
    }

    return row;
  }

  function reposForFolder(data, folderId) {
    return Object.entries(data.assignments)
      .filter(([, ids]) => ids.includes(folderId))
      .map(([repo]) => repo)
      .sort();
  }

  function countReposRecursive(data, folder, allFolders) {
    const own = reposForFolder(data, folder.id).length;
    const children = allFolders.filter((f) => f.parentId === folder.id);
    return own + children.reduce((sum, c) => sum + countReposRecursive(data, c, allFolders), 0);
  }

  function buildFolderCard(folder, repos, data, childCards) {
    const card = document.createElement("div");
    card.className = "ghrf-dash-card";

    const header = document.createElement("div");
    header.className = "ghrf-dash-card-header";

    const dot = document.createElement("span");
    dot.className = "ghrf-dot";
    dot.style.background = folder.color;
    header.appendChild(dot);

    const title = document.createElement("span");
    title.className = "ghrf-dash-card-title";
    title.textContent = folder.name;
    header.appendChild(title);

    const count = document.createElement("span");
    count.className = "ghrf-dash-card-count";
    count.textContent = String(repos.length);
    header.appendChild(count);

    card.appendChild(header);

    if (repos.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ghrf-hint";
      empty.textContent = "Aucun repo";
      card.appendChild(empty);
    } else {
      repos.forEach((fullName) => card.appendChild(buildRepoRow(fullName, data)));
    }

    childCards.forEach((childCard) => card.appendChild(childCard));

    return card;
  }

  async function render() {
    const [data, settings] = await Promise.all([window.GHRF.getData(), window.GHRF.getSettings()]);
    const view = viewSelect.value || settings.dashboard.defaultView;
    content.classList.toggle("ghrf-dash-kanban", view === "kanban");
    content.classList.toggle("ghrf-dash-list", view === "list");

    content.innerHTML = "";

    const pinned = (data.pinned || []).slice().sort();
    if (pinned.length > 0) {
      const pinnedCard = document.createElement("div");
      pinnedCard.className = "ghrf-dash-card ghrf-dash-card-pinned";
      const header = document.createElement("div");
      header.className = "ghrf-dash-card-header";
      const title = document.createElement("span");
      title.className = "ghrf-dash-card-title";
      title.textContent = "⭐ Épinglés";
      header.appendChild(title);
      pinnedCard.appendChild(header);
      pinned.forEach((fullName) => pinnedCard.appendChild(buildRepoRow(fullName, data)));
      content.appendChild(pinnedCard);
    }

    const topLevel = data.folders.filter((f) => !f.parentId);
    let shownAny = false;
    topLevel.forEach((folder) => {
      const totalCount = countReposRecursive(data, folder, data.folders);
      if (totalCount === 0 && !settings.dashboard.showEmptyFolders) return;
      shownAny = true;

      const children = data.folders.filter((f) => f.parentId === folder.id);
      const childCards = children
        .filter((child) => settings.dashboard.showEmptyFolders || reposForFolder(data, child.id).length > 0)
        .map((child) => buildFolderCard(child, reposForFolder(data, child.id), data, []));

      content.appendChild(buildFolderCard(folder, reposForFolder(data, folder.id), data, childCards));
    });

    if (!shownAny && pinned.length === 0) {
      const empty = document.createElement("p");
      empty.className = "ghrf-hint";
      empty.textContent =
        "Rien à afficher pour le moment. Classe ou épingle des repos depuis l'onglet Repositories ou Stars de GitHub.";
      content.appendChild(empty);
    }

    const totalRepos = new Set([...Object.keys(data.assignments), ...pinned]).size;
    statsLine.textContent = `${data.folders.length} dossier${data.folders.length > 1 ? "s" : ""} · ${totalRepos} repo${
      totalRepos > 1 ? "s" : ""
    } au total`;
  }

  viewSelect.addEventListener("change", render);

  (async () => {
    const settings = await window.GHRF.getSettings();
    viewSelect.value = settings.dashboard.defaultView;
    render();
  })();

  window.GHRF.onChange(render);
})();
