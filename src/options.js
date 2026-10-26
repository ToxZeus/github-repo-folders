(function () {
  const els = {
    badgeMetric: document.getElementById("badgeMetric"),
    renderDebounceMs: document.getElementById("renderDebounceMs"),
    safetyIntervalMs: document.getElementById("safetyIntervalMs"),
    popoverWidth: document.getElementById("popoverWidth"),
    storagePreference: document.getElementById("storagePreference"),
    searchMatchLanguageToo: document.getElementById("searchMatchLanguageToo"),
    paletteList: document.getElementById("paletteList"),
    addPaletteColorBtn: document.getElementById("addPaletteColorBtn"),
    resetPaletteBtn: document.getElementById("resetPaletteBtn"),
    saveBtn: document.getElementById("saveBtn"),
    savedNote: document.getElementById("savedNote")
  };

  let paletteColors = [];
  let loadedStoragePreference = null;

  function renderPaletteList() {
    els.paletteList.innerHTML = "";
    paletteColors.forEach((color, idx) => {
      const row = document.createElement("div");
      row.className = "ghrf-palette-row";

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = color;
      colorInput.addEventListener("input", () => {
        paletteColors[idx] = colorInput.value;
      });
      row.appendChild(colorInput);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ghrf-icon-btn";
      removeBtn.textContent = "✕";
      removeBtn.title = "Retirer cette couleur";
      removeBtn.disabled = paletteColors.length <= 1;
      removeBtn.addEventListener("click", () => {
        if (paletteColors.length <= 1) return;
        paletteColors.splice(idx, 1);
        renderPaletteList();
      });
      row.appendChild(removeBtn);

      els.paletteList.appendChild(row);
    });
  }

  els.addPaletteColorBtn.addEventListener("click", () => {
    if (paletteColors.length >= 20) return;
    paletteColors.push("#888888");
    renderPaletteList();
  });

  els.resetPaletteBtn.addEventListener("click", () => {
    paletteColors = window.GHRF.DEFAULT_SETTINGS_FALLBACK.defaultPalette.slice();
    renderPaletteList();
  });

  els.storagePreference.addEventListener("change", () => {
    if (els.storagePreference.value === loadedStoragePreference) return;
    const ok = window.confirm(
      "Changer la zone de stockage copiera tes dossiers et affectations actuels vers la nouvelle zone. " +
        "L'ancienne copie sera conservée comme sauvegarde, rien n'est supprimé. Continuer ?"
    );
    if (!ok) els.storagePreference.value = loadedStoragePreference;
  });

  async function load() {
    const settings = await window.GHRF.getSettings();
    els.badgeMetric.value = settings.badgeMetric;
    els.renderDebounceMs.value = settings.renderDebounceMs;
    els.safetyIntervalMs.value = settings.safetyIntervalMs;
    els.popoverWidth.value = settings.popoverWidth;
    els.storagePreference.value = settings.storagePreference;
    loadedStoragePreference = settings.storagePreference;
    els.searchMatchLanguageToo.checked = settings.searchMatchLanguageToo;
    paletteColors = settings.defaultPalette.slice();
    renderPaletteList();
  }

  els.saveBtn.addEventListener("click", async () => {
    const next = await window.GHRF.setSettings({
      badgeMetric: els.badgeMetric.value,
      renderDebounceMs: Number(els.renderDebounceMs.value),
      safetyIntervalMs: Number(els.safetyIntervalMs.value),
      popoverWidth: Number(els.popoverWidth.value),
      storagePreference: els.storagePreference.value,
      searchMatchLanguageToo: els.searchMatchLanguageToo.checked,
      defaultPalette: paletteColors
    });
    loadedStoragePreference = next.storagePreference;
    els.savedNote.classList.remove("ghrf-hidden");
    setTimeout(() => els.savedNote.classList.add("ghrf-hidden"), 2000);
  });

  load();

  // Live refresh if settings change elsewhere (e.g. this page open on two
  // devices), but don't yank a field out from under an in-progress edit.
  window.GHRF.onChange(() => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "SELECT") return;
    load();
  });
})();
