(() => {
  "use strict";

  const storagePrefix = "ghaWorkflowCategoriesV2:";
  const legacyStoragePrefix = "ghaWorkflowCategoriesV1:";
  let repository = "";
  let sidebar;
  let workflows = [];
  let workflowPath = "";
  let query = "";
  let view;
  let loaded = false;
  let revision = 0;
  let renderKey = "";
  let renderedWorkflows = [];
  let renderedPins = [];
  let renderedAllLink;
  let hiddenAllRow;
  let nativePickerObserver;
  let nativePickerPositions = new Map();
  let data = { categories: [] };
  let pendingSave;
  let writing = false;
  let writeTask;
  let saveStatus = "";
  let saveStatusDismissed = false;
  let saveInvalidated = false;
  let pendingImport;
  let importError = "";
  let importNotice = "";
  const drafts = new Map();
  const invalidatedDrafts = new Set();
  let formMode = "";
  let formCategory = "";
  let pendingWorkflowId = "";
  let formValue = "";
  let editing = "";
  const editingRemoved = new Set();
  const editingAdded = new Set();

  const workflowId = (link) => link.pathname.slice(workflowPath.length);
  const categoryFor = (name) => data.categories.find((category) => category.name === name);
  const assigned = (id) => data.categories.filter((category) => category.workflows.includes(id))
    .map((category) => category.name);
  const matching = (link) => link.textContent.toLowerCase().includes(query.trim().toLowerCase());
  const pinButton = (row) => row?.querySelector(
    '[data-component="ActionList.TrailingAction"][class*="pinButton"] button, button[aria-label*="pin" i]') ??
    [...(row?.querySelectorAll("button[aria-labelledby]") ?? [])].find((button) =>
      /^(?:unpin|pin|remove pin)\b/i.test(
        document.getElementById(button.getAttribute("aria-labelledby"))?.textContent.trim() ?? ""));
  const pinLabel = (pin) => pin ? (pin.getAttribute("aria-label") ??
    document.getElementById(pin.getAttribute("aria-labelledby"))?.textContent.trim() ?? "Pin workflow") : "";
  const isPinned = (pin) => /^(?:Unpin|Remove pin)\b/i.test(pinLabel(pin));

  function fromLegacy(stored) {
    const names = Array.isArray(stored?.categories)
      ? [...new Set(stored.categories.filter((name) =>
        typeof name === "string" && name.trim() === name && name.length > 0))]
      : [];
    const assignments = Object.entries(stored?.assignments ?? {});
    return { categories: names.map((name) => ({
      name,
      workflows: assignments.filter(([id, values]) => id && Array.isArray(values) && values.includes(name))
        .map(([id]) => id),
      collapsed: Array.isArray(stored?.collapsed) && stored.collapsed.includes(name),
    })) };
  }

  function validateCategories(categories) {
    if (!Array.isArray(categories) || categories.some((category) =>
      !category || typeof category !== "object" || Array.isArray(category) ||
      typeof category.name !== "string" || !category.name ||
      category.name.trim() !== category.name || category.name.length > 40 ||
      !Array.isArray(category.workflows) ||
      category.workflows.some((id) => typeof id !== "string" || !id) ||
      new Set(category.workflows).size !== category.workflows.length ||
      typeof category.collapsed !== "boolean") ||
      new Set(categories.map((category) => category.name.toLowerCase())).size !== categories.length)
      throw new Error("Invalid category backup: categories or workflows are inconsistent.");
    return { categories: categories.map(({ name, workflows, collapsed }) =>
      ({ name, workflows: [...workflows], collapsed })) };
  }

  function snapshot() {
    return { categories: data.categories.map(({ name, workflows, collapsed }) =>
      ({ name, workflows: [...workflows], collapsed })) };
  }

  function validateBackup(backup) {
    if (!backup || backup.format !== "gha-workflow-categories" || ![1, 2].includes(backup.version) ||
      backup.repository !== repository)
      throw new Error(backup?.repository && backup.repository !== repository
        ? "This backup belongs to another repository."
        : "Invalid or unsupported category backup.");
    if (backup.version === 2) return validateCategories(backup.categories);
    const names = backup.categories;
    const assignments = backup.assignments;
    const hidden = backup.collapsed;
    if (!Array.isArray(names) || !assignments || typeof assignments !== "object" ||
      Array.isArray(assignments) || !Array.isArray(hidden) ||
      names.some((name) => typeof name !== "string" || !name || name.trim() !== name || name.length > 40) ||
      new Set(names.map((name) => name.toLowerCase())).size !== names.length ||
      hidden.some((name) => !names.includes(name)) || new Set(hidden).size !== hidden.length ||
      Object.entries(assignments).some(([id, values]) => !id || !Array.isArray(values) ||
        values.some((name) => !names.includes(name)) || new Set(values).size !== values.length))
      throw new Error("Invalid category backup: categories or assignments are inconsistent.");
    return fromLegacy(backup);
  }

  function mergeBackup(backup) {
    const current = snapshot();
    const names = new Map(current.categories.map((category) => [category.name.toLowerCase(), category]));
    for (const imported of backup.categories) {
      const existing = names.get(imported.name.toLowerCase());
      if (existing) existing.workflows = [...new Set([...existing.workflows, ...imported.workflows])];
      else current.categories.push(imported);
    }
    return current;
  }

  function sameSnapshot(left, right) {
    if (!left || !right) return false;
    const fields = (value) => value.categories?.map(({ name, workflows, collapsed }) =>
      [name, workflows, collapsed]);
    return JSON.stringify(fields(left)) === JSON.stringify(fields(right));
  }

  async function persist() {
    if (writing) return;
    writing = true;
    while (pendingSave) {
      const current = pendingSave;
      pendingSave = undefined;
      try {
        await chrome.storage.local.set({ [current.key]: current.snapshot });
        const stored = await chrome.storage.local.get(current.key);
        if (!sameSnapshot(stored[current.key], current.snapshot))
          throw new Error("Saved categories did not match the requested changes");
        const savedRepository = current.key.slice(storagePrefix.length);
        if (sameSnapshot(drafts.get(savedRepository), current.snapshot)) {
          drafts.delete(savedRepository);
          invalidatedDrafts.delete(savedRepository);
          if (repository === savedRepository && saveStatus === "error") {
            saveStatus = "";
            updateSaveStatus(view);
          }
        }
      } catch (error) {
        console.warn("Could not save workflow categories", error);
        if (revision === current.revision) {
          pendingSave = undefined;
          saveStatus = "error";
          saveStatusDismissed = false;
          saveInvalidated = /Extension context invalidated/i.test(String(error));
          updateSaveStatus(view);
          break;
        }
      }
      if (revision === current.revision && !pendingSave) {
        saveStatus = "";
        updateSaveStatus(view);
      }
    }
    writing = false;
  }

  function save(showSaving = true) {
    importNotice = "";
    view?.querySelector(".gha-workflow-category-import-notice")?.remove();
    const key = `${storagePrefix}${repository}`;
    pendingSave = { key, snapshot: snapshot(), revision };
    saveStatus = showSaving || saveStatus === "saving" ? "saving" : "pending";
    saveStatusDismissed = false;
    saveInvalidated = false;
    if (!writing) writeTask = persist();
    updateSaveStatus(view);
    return writeTask;
  }

  function exportCategories() {
    const backup = { format: "gha-workflow-categories", version: 2, repository, ...snapshot() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `gha-categories-${repository.replaceAll("/", "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function applyImport(mode) {
    if (!pendingImport) return;
    const next = mode === "merge" ? mergeBackup(pendingImport) : pendingImport;
    const importingRepository = repository;
    data = next;
    pendingImport = undefined;
    importError = "";
    importNotice = "";
    formMode = "";
    editing = "";
    editingRemoved.clear();
    editingAdded.clear();
    const write = save();
    render();
    await write;
    if (repository === importingRepository && !saveStatus) {
      importNotice = "Categories imported and saved.";
      render();
    }
  }

  function updateSaveStatus(root) {
    if (!root) return;
    let status = root.querySelector(":scope > .gha-workflow-category-save-status");
    if (!saveStatus || saveStatus === "pending" || saveStatusDismissed) {
      status?.remove();
      return;
    }
    if (!status) {
      status = document.createElement("div");
      status.className = "gha-workflow-category-save-status";
      root.querySelector(":scope > .gha-workflow-categories-heading")?.after(status);
    }
    status.setAttribute("role", saveStatus === "error" ? "alert" : "status");
    const message = saveStatus === "error"
      ? saveInvalidated
        ? "Category changes were not saved. This tab lost its extension connection; note the changes, refresh this tab, and redo them."
        : "Category changes were not saved. Retry before leaving or reloading this tab."
      : "Saving category changes…";
    status.replaceChildren(makeButton(message, () => {
      saveStatusDismissed = true;
      status.remove();
    }, "gha-workflow-category-message"));
    if (saveStatus === "error" && !saveInvalidated)
      status.append(makeButton("Retry save", () => save()));
  }

  function reset() {
    if (saveStatus && repository) {
      drafts.set(repository, snapshot());
      if (saveInvalidated) invalidatedDrafts.add(repository);
      else invalidatedDrafts.delete(repository);
    }
    revision++;
    nativePickerObserver?.disconnect();
    nativePickerPositions.clear();
    view?.remove();
    hiddenAllRow?.removeAttribute("data-gha-workflow-all-hidden");
    repository = "";
    sidebar = undefined;
    workflows = [];
    workflowPath = "";
    query = "";
    view = undefined;
    loaded = false;
    renderKey = "";
    renderedWorkflows = [];
    renderedPins = [];
    renderedAllLink = undefined;
    hiddenAllRow = undefined;
    data = { categories: [] };
    pendingSave = undefined;
    saveStatus = "";
    saveStatusDismissed = false;
    saveInvalidated = false;
    pendingImport = undefined;
    importError = "";
    importNotice = "";
    formMode = "";
    formCategory = "";
    pendingWorkflowId = "";
    formValue = "";
    editing = "";
    editingRemoved.clear();
    editingAdded.clear();
    document.querySelectorAll('[data-gha-workflow-add-native]').forEach((item) => item.remove());
  }

  function nativeVisibility() {
    for (const link of workflows) {
      const row = link.closest("li");
      row?.toggleAttribute("data-gha-workflow-hidden", !matching(link) || assigned(workflowId(link)).length > 0 ||
        isPinned(pinButton(row)));
    }
  }

  function makeButton(label, onClick, className) {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    if (className) item.className = className;
    item.addEventListener("click", onClick);
    return item;
  }

  function updateToggleAll(button = view?.querySelector(".gha-workflow-category-toggle-all")) {
    if (!button) return;
    const expand = data.categories.some((category) => category.collapsed);
    const label = expand ? "Expand all categories" : "Collapse all categories";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.querySelector("path")?.setAttribute("d", expand
      ? "M3 3l5 4 5-4M3 9l5 4 5-4" : "M3 13l5-4 5 4M3 7l5-4 5 4");
  }

  function menuClick(event) {
    event.stopPropagation();
    for (const menu of document.querySelectorAll(".gha-workflow-category-picker[open], .gha-workflow-category-options[open]")) {
      if (menu !== event.currentTarget) menu.open = false;
    }
  }

  function categoryForm() {
    const form = document.createElement("form");
    form.className = "gha-workflow-category-form";
    form.hidden = !formMode;
    const field = document.createElement("input");
    field.setAttribute("aria-label", "Category name");
    field.placeholder = "Category name";
    field.maxLength = 40;
    field.required = true;
    field.value = formValue;
    field.addEventListener("input", () => { formValue = field.value; });
    const error = document.createElement("span");
    error.className = "gha-workflow-category-error";
    error.setAttribute("role", "alert");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = field.value.trim();
      const duplicate = data.categories.some((item) =>
        item.name !== formCategory && item.name.toLowerCase() === name.toLowerCase());
      if (!name || duplicate) {
        error.textContent = duplicate ? "Category already exists" : "Enter a category name";
        return;
      }
      if (formMode === "new") {
        data.categories.push({ name, workflows: pendingWorkflowId ? [pendingWorkflowId] : [], collapsed: false });
      }
      else {
        categoryFor(formCategory).name = name;
        if (editing === formCategory) editing = name;
      }
      formMode = "";
      formCategory = "";
      pendingWorkflowId = "";
      formValue = "";
      save();
      render();
    });
    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.textContent = "Save";
    saveButton.className = "gha-workflow-category-save";
    form.append(field, saveButton,
      makeButton("Cancel", () => { formMode = ""; formCategory = ""; pendingWorkflowId = ""; formValue = ""; render(); }));
    form.append(error);
    return form;
  }

  function categoryPicker(link, native = false) {
    const id = workflowId(link);
    const menu = document.createElement("details");
    menu.className = "gha-workflow-category-picker";
    menu.addEventListener("click", menuClick);
    if (native) menu.setAttribute("data-gha-workflow-add-native", "");
    const summary = document.createElement("summary");
    summary.setAttribute("aria-label", `Add ${link.textContent.trim()} to categories`);
    summary.title = "Add to category";
    summary.textContent = "+";
    const panel = document.createElement("div");
    panel.className = "gha-workflow-category-menu";
    const populate = () => {
      panel.replaceChildren();
      for (const { name } of data.categories.filter((item) =>
        !item.workflows.includes(id) && !(editing === item.name && editingAdded.has(id)))) {
        panel.append(makeButton(name, () => {
          if (editing === name) editingAdded.add(id);
          else categoryFor(name).workflows.push(id);
          menu.open = false;
          if (editing !== name) save();
          render();
        }));
      }
      panel.append(makeButton("Create new category", () => {
        menu.open = false;
        formMode = "new";
        formCategory = "";
        pendingWorkflowId = id;
        formValue = "";
        render();
        view.querySelector('input[aria-label="Category name"]').focus();
      }));
    };
    summary.addEventListener("click", () => { if (!menu.open) populate(); });
    populate();
    menu.append(summary, panel);
    return menu;
  }

  function syncNativePickers() {
    const pinnedRows = new Map();
    for (const link of workflows) {
      const row = link.closest("li");
      if (!row) continue;
      const pin = pinButton(row);
      const key = JSON.stringify([link.textContent, assigned(workflowId(link)), !!pin]);
      const existing = row.querySelector(":scope > [data-gha-workflow-add-native]");
      if (existing?.dataset.key !== key) {
        const picker = categoryPicker(link, true);
        picker.dataset.key = key;
        if (pin) picker.setAttribute("data-gha-has-pin", "");
        if (existing) existing.replaceWith(picker);
        else row.append(picker);
      }
      row.querySelector(":scope > [data-gha-workflow-add-native]")
        ?.toggleAttribute("data-gha-pinned", isPinned(pin));
      if (!pin) {
        if (row.style.getPropertyValue("--gha-native-picker-inset"))
          row.style.removeProperty("--gha-native-picker-inset");
        continue;
      }
      if (!row.classList.contains("gha-workflow-api-row")) pinnedRows.set(row, pin);
    }
    if (pinnedRows.size && !nativePickerObserver)
      nativePickerObserver = new ResizeObserver(syncNativePickerPositions);
    for (const [row, pin] of nativePickerPositions) {
      if (pinnedRows.get(row) === pin) continue;
      nativePickerObserver.unobserve(row);
      nativePickerObserver.unobserve(pin);
    }
    for (const [row, pin] of pinnedRows) {
      if (nativePickerPositions.get(row) === pin) continue;
      nativePickerObserver.observe(row);
      nativePickerObserver.observe(pin);
    }
    nativePickerPositions = pinnedRows;
  }

  function syncNativePickerPositions() {
    const positions = [...nativePickerPositions].map(([row, pin]) => {
      const rowRect = row.getBoundingClientRect();
      const pinRect = pin.getBoundingClientRect();
      return [row, rowRect.width && pinRect.width
        ? `${Math.ceil(rowRect.right - pinRect.left)}px` : ""];
    });
    for (const [row, inset] of positions) {
      if (inset && row.style.getPropertyValue("--gha-native-picker-inset") !== inset)
        row.style.setProperty("--gha-native-picker-inset", inset);
    }
  }

  function categoryLink(link) {
    const row = document.createElement("li");
    row.className = "gha-workflow-category-row";
    row.style.fontSize = getComputedStyle(link).fontSize;
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.textContent = link.textContent.trim();
    if (link.hasAttribute("data-gha-workflow-disabled")) {
      anchor.setAttribute("data-gha-workflow-disabled", "");
      anchor.setAttribute("aria-label", `${anchor.textContent}, disabled workflow`);
    }
    if (link.pathname === location.pathname || link.hasAttribute("aria-current") ||
      link.closest("li")?.hasAttribute("aria-current")) {
      row.setAttribute("data-gha-active", "");
      anchor.setAttribute("aria-current", "page");
    }
    anchor.addEventListener("click", (event) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      link.click();
    });
    row.append(anchor, categoryPicker(link));
    const nativePin = pinButton(link.closest("li"));
    if (nativePin) {
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "gha-workflow-category-pin";
      pin.setAttribute("aria-label", pinLabel(nativePin));
      pin.title = pinLabel(nativePin);
      pin.toggleAttribute("data-gha-pinned", isPinned(nativePin));
      const icon = nativePin.querySelector("svg")?.cloneNode(true);
      pin.append(icon ?? document.createTextNode("Pin"));
      pin.addEventListener("click", () => {
        nativePin.click();
        window.setTimeout(render, 0);
      });
      row.append(pin);
    }
    return row;
  }

  function categorySection(name) {
    const category = categoryFor(name);
    const section = document.createElement("section");
    section.className = "gha-workflow-category";
    section.setAttribute("data-gha-category-name", name);
    const allMembers = workflows.filter((link) => category.workflows.includes(workflowId(link)) ||
      (editing === name && editingAdded.has(workflowId(link))));
    const members = allMembers.filter(matching);
    if (query.trim() && !members.length && editing !== name) section.hidden = true;
    const header = document.createElement("div");
    header.className = "gha-workflow-category-header";
    header.toggleAttribute("data-gha-editing", editing === name);
    const list = document.createElement("ul");
    list.className = "gha-workflow-category-list";
    const updateList = () => {
      const isCollapsed = category.collapsed;
      for (const row of list.children) row.hidden = isCollapsed;
      list.hidden = editing === name || isCollapsed;
    };
    const toggle = makeButton(name, () => {
      category.collapsed = !category.collapsed;
      updateList();
      const editor = section.querySelector(".gha-workflow-category-editor");
      if (editor) editor.hidden = category.collapsed;
      toggle.setAttribute("aria-expanded", String(!category.collapsed));
      updateToggleAll();
      syncNativePickers();
      save(false);
    }, "gha-workflow-category-toggle");
    toggle.setAttribute("aria-expanded", String(!category.collapsed));
    toggle.setAttribute("aria-label", name);
    const nameText = document.createElement("span");
    nameText.className = "gha-workflow-category-name";
    nameText.textContent = name;
    toggle.replaceChildren(nameText);
    const count = document.createElement("span");
    count.className = "gha-workflow-category-count";
    count.textContent = String(members.length);
    count.setAttribute("aria-hidden", "true");
    const options = document.createElement("details");
    options.className = "gha-workflow-category-options";
    options.addEventListener("click", menuClick);
    const optionsButton = document.createElement("summary");
    optionsButton.setAttribute("aria-label", `Options for ${name}`);
    optionsButton.textContent = "⋯";
    const optionsMenu = document.createElement("div");
    optionsMenu.className = "gha-workflow-category-menu";
    if (allMembers.length && !editing) {
      const edit = makeButton("Edit workflows", () => {
        editing = name;
        editingRemoved.clear();
        editingAdded.clear();
        if (category.collapsed) {
          category.collapsed = false;
          save(false);
        }
        render();
        view.querySelector(".gha-workflow-category-editor input")?.focus();
      });
      edit.setAttribute("aria-label", `Edit workflows in ${name}`);
      optionsMenu.append(edit);
    }
    const rename = makeButton("Rename", () => {
      formMode = "rename";
      formCategory = name;
      pendingWorkflowId = "";
      formValue = name;
      render();
      view.querySelector('input[aria-label="Category name"]').focus();
    });
    rename.setAttribute("aria-label", `Rename ${name}`);
    const remove = makeButton("Delete", () => {
      if (!window.confirm(`Delete category “${name}”?`)) return;
      data.categories = data.categories.filter((item) => item !== category);
      if (editing === name) editing = "";
      save();
      render();
      view.querySelector(".gha-workflow-category-new")?.focus();
    });
    remove.setAttribute("aria-label", `Delete ${name}`);
    optionsMenu.append(rename, remove);
    options.append(optionsButton, optionsMenu);
    header.append(toggle);
    if (editing === name) {
      const finishEditing = () => {
        editing = "";
        editingRemoved.clear();
        editingAdded.clear();
        render();
        [...view.querySelectorAll(".gha-workflow-category")]
          .find((item) => item.getAttribute("data-gha-category-name") === name)
          ?.querySelector(".gha-workflow-category-toggle")?.focus();
      };
      header.append(
        makeButton("Save", () => {
          for (const id of editingRemoved)
            category.workflows = category.workflows.filter((item) => item !== id);
          for (const id of editingAdded)
            if (!editingRemoved.has(id) && !category.workflows.includes(id)) category.workflows.push(id);
          if (editingRemoved.size || editingAdded.size) save();
          finishEditing();
        }, "gha-workflow-category-edit-save"),
        makeButton("Cancel", finishEditing, "gha-workflow-category-edit-cancel")
      );
    } else {
      toggle.append(count);
      header.append(options);
    }
    section.append(header);
    for (const link of members) list.append(categoryLink(link));
    updateList();
    section.append(list);
    if (editing === name && allMembers.length) {
      const editor = document.createElement("div");
      editor.className = "gha-workflow-category-editor";
      editor.hidden = category.collapsed;
      for (const link of allMembers) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.workflowId = workflowId(link);
        checkbox.checked = !editingRemoved.has(workflowId(link));
        checkbox.addEventListener("change", () => {
          const id = workflowId(link);
          if (checkbox.checked) editingRemoved.delete(id);
          else editingRemoved.add(id);
        });
        label.append(checkbox, document.createTextNode(link.textContent.trim()));
        editor.append(label);
      }
      section.append(editor);
    }
    return section;
  }

  function render() {
    if (!loaded || !sidebar?.isConnected) return;
    nativeVisibility();
    const allLink = [...sidebar.querySelectorAll("a[href]")].find((link) =>
      link.origin === location.origin && link.pathname.replace(/\/$/, "") === `/${repository}/actions`);
    const allRow = allLink?.closest("li") ?? allLink;
    if (hiddenAllRow !== allRow) {
      hiddenAllRow?.removeAttribute("data-gha-workflow-all-hidden");
      allRow?.setAttribute("data-gha-workflow-all-hidden", "");
      hiddenAllRow = allRow;
    }
    const pins = workflows.map((link) => pinButton(link.closest("li")));
    const signature = JSON.stringify([
      repository, data, query, allLink?.textContent, allLink?.getAttribute("aria-current"),
      workflows.map((link, index) => [workflowId(link), link.textContent, pinLabel(pins[index]),
        link.hasAttribute("aria-current") || link.closest("li")?.hasAttribute("aria-current")]),
      location.pathname,
      formMode, formCategory, pendingWorkflowId, editing, [...editingAdded],
      pendingImport?.categories.length, importError, importNotice,
    ]);
    if (view?.isConnected && view.nextElementSibling === sidebar && renderKey === signature &&
      renderedWorkflows.length === workflows.length &&
      renderedWorkflows.every((link, index) => link === workflows[index]) &&
      renderedPins.every((pin, index) => pin === pins[index]) &&
      renderedAllLink === allLink &&
      workflows.every((link) => link.closest("li")?.querySelector(":scope > [data-gha-workflow-add-native]"))) return;
    syncNativePickers();
    const fieldFocused = document.activeElement?.getAttribute("aria-label") === "Category name";
    const next = document.createElement("div");
    next.className = "gha-workflow-categories";
    if (allLink) {
      const movedLink = document.createElement("a");
      movedLink.className = "gha-workflow-all-link";
      movedLink.href = allLink.href;
      movedLink.style.fontSize = getComputedStyle(allLink).fontSize;
      movedLink.append(...[...allLink.childNodes].map((node) => node.cloneNode(true)));
      if (location.pathname.replace(/\/$/, "") === `/${repository}/actions`)
        movedLink.setAttribute("aria-current", "page");
      movedLink.addEventListener("click", (event) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        allLink.click();
      });
      next.append(movedLink);
    }
    const pinned = workflows.filter((link, index) => isPinned(pins[index]) && matching(link));
    if (pinned.length) {
      const section = document.createElement("section");
      section.className = "gha-workflow-pinned";
      section.setAttribute("aria-label", "Pinned workflows");
      const heading = document.createElement("div");
      heading.className = "gha-workflow-categories-heading";
      const title = document.createElement("h3");
      title.className = "gha-workflow-category-title";
      title.textContent = "Pinned workflows";
      heading.append(title);
      const list = document.createElement("ul");
      list.className = "gha-workflow-pinned-list";
      for (const link of pinned) list.append(categoryLink(link));
      section.append(heading, list);
      next.append(section);
    }
    const heading = document.createElement("div");
    heading.className = "gha-workflow-categories-heading";
    const title = document.createElement("h3");
    title.className = "gha-workflow-category-title";
    title.textContent = "Categories";
    const newCategory = makeButton("New category", () => {
      formMode = "new";
      formCategory = "";
      pendingWorkflowId = "";
      formValue = "";
      render();
      view.querySelector('input[aria-label="Category name"]').focus();
    }, "gha-workflow-category-new");
    heading.append(title);
    const backupOptions = document.createElement("details");
    backupOptions.className = "gha-workflow-category-options gha-workflow-category-backup";
    backupOptions.addEventListener("click", menuClick);
    const backupTrigger = document.createElement("summary");
    backupTrigger.setAttribute("aria-label", "Category backup options");
    backupTrigger.title = "Import or export categories";
    backupTrigger.textContent = "⋯";
    const backupMenu = document.createElement("div");
    backupMenu.className = "gha-workflow-category-menu";
    backupMenu.append(makeButton("Export categories", () => {
      backupOptions.open = false;
      exportCategories();
    }));
    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.hidden = true;
    file.setAttribute("aria-label", "Choose category backup");
    file.addEventListener("change", async () => {
      const selected = file.files?.[0];
      if (!selected) return;
      const selectedRepository = repository;
      try {
        const parsed = JSON.parse(await selected.text());
        if (repository !== selectedRepository) return;
        pendingImport = validateBackup(parsed);
        importError = "";
      } catch (error) {
        if (repository !== selectedRepository) return;
        pendingImport = undefined;
        importError = error instanceof SyntaxError ? "Invalid JSON category backup." : error.message;
      }
      importNotice = "";
      render();
    });
    backupMenu.append(makeButton("Import categories", () => {
      backupOptions.open = false;
      file.click();
    }));
    backupOptions.append(backupTrigger, backupMenu, file);
    const headingActions = document.createElement("div");
    headingActions.className = "gha-workflow-category-heading-actions";
    if (data.categories.length) {
      const toggleAll = makeButton("", () => {
        const expand = data.categories.some((category) => category.collapsed);
        for (const category of data.categories) category.collapsed = !expand;
        save(false);
        renderKey = "";
        render();
        view.querySelector(".gha-workflow-category-toggle-all")?.focus();
      }, "gha-workflow-category-toggle-all");
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 16 16");
      icon.setAttribute("width", "16");
      icon.setAttribute("height", "16");
      icon.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      icon.append(path);
      toggleAll.replaceChildren(icon);
      updateToggleAll(toggleAll);
      newCategory.textContent = "+";
      newCategory.title = "New category";
      newCategory.setAttribute("aria-label", "New category");
      headingActions.append(toggleAll, newCategory);
    }
    headingActions.append(backupOptions);
    heading.append(headingActions);
    next.append(heading);
    updateSaveStatus(next);
    if (!data.categories.length) {
      const emptyList = document.createElement("ul");
      emptyList.className = "gha-workflow-category-empty";
      const item = document.createElement("li");
      item.append(newCategory);
      emptyList.append(item);
      next.append(emptyList);
    }
    next.append(categoryForm());
    if (pendingImport) {
      const prompt = document.createElement("div");
      prompt.className = "gha-workflow-category-import-prompt";
      prompt.setAttribute("role", "group");
      prompt.setAttribute("aria-label", "Import categories");
      const message = document.createElement("div");
      message.textContent = `Import ${pendingImport.categories.length} categories for ${repository}. Merge adds to your categories; Replace removes the current categories.`;
      const actions = document.createElement("div");
      actions.className = "gha-workflow-category-import-actions";
      actions.append(
        makeButton("Merge", () => applyImport("merge")),
        makeButton("Replace", () => applyImport("replace")),
        makeButton("Cancel", () => { pendingImport = undefined; render(); }));
      prompt.append(message, actions);
      next.append(prompt);
    }
    if (importError || importNotice) {
      const message = document.createElement("div");
      message.className = importError ? "gha-workflow-category-import-error" : "gha-workflow-category-import-notice";
      message.setAttribute("role", importError ? "alert" : "status");
      message.append(makeButton(importError || importNotice, () => {
        importError = "";
        importNotice = "";
        render();
      }, "gha-workflow-category-message"));
      next.append(message);
    }
    for (const { name } of data.categories) next.append(categorySection(name));
    view?.remove();
    sidebar.before(next);
    view = next;
    renderKey = signature;
    renderedWorkflows = [...workflows];
    renderedPins = pins;
    renderedAllLink = allLink;
    if (fieldFocused) view.querySelector('input[aria-label="Category name"]')?.focus();
  }

  function sync(nextRepository, nextSidebar, nextWorkflows, nextQuery, nextWorkflowPath) {
    if (repository !== nextRepository) {
      reset();
      repository = nextRepository;
      const key = `${storagePrefix}${repository}`;
      const legacyKey = `${legacyStoragePrefix}${repository}`;
      const loadRevision = revision;
      const showStored = (saved, draft) => {
        if (revision !== loadRevision) return;
        data = validateCategories(saved?.categories ?? []);
        if (draft) {
          saveStatus = "error";
          saveInvalidated = invalidatedDrafts.has(nextRepository);
        }
        loaded = true;
        render();
      };
      chrome.storage.local.get([key, legacyKey]).then((stored) => {
        const draft = drafts.get(nextRepository);
        const legacy = stored[key] === undefined && stored[legacyKey] !== undefined;
        showStored(draft ?? stored[key] ?? (legacy ? fromLegacy(stored[legacyKey]) : undefined), !!draft);
        if (legacy && !draft && revision === loadRevision) save(false);
      }).catch((error) => {
        console.warn("Could not load workflow categories", error);
        if (drafts.has(nextRepository)) {
          if (/Extension context invalidated/i.test(String(error)))
            invalidatedDrafts.add(nextRepository);
          showStored(drafts.get(nextRepository), true);
        }
      });
    }
    sidebar = nextSidebar;
    workflows = nextWorkflows;
    query = nextQuery;
    workflowPath = nextWorkflowPath;
    nativeVisibility();
    render();
  }

  document.addEventListener("click", (event) => {
    for (const menu of document.querySelectorAll(".gha-workflow-category-picker[open], .gha-workflow-category-options[open]")) {
      if (!menu.contains(event.target)) menu.open = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const menu = document.activeElement?.closest(".gha-workflow-category-picker[open], .gha-workflow-category-options[open]");
    if (menu) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
  });
  window.addEventListener("resize", syncNativePickers);
  window.addEventListener("beforeunload", (event) => {
    if (!saveStatus && !drafts.size) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.GHAWorkflowCategories = { sync, reset };
})();
