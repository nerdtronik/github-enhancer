(() => {
  "use strict";

  const modules = globalThis.__ghaRunViewModules;
  const { state, statusOptions, createIcon, addHoverHighlights } = modules;
  const { selectedStatuses, scrollbars } = state;
  function addScrollbar(graph, canvas, stages) {
    const listeners = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      listeners.push([target, type, handler, options]);
    };
    // Turbo snapshots copy the toolbar without its event listeners or bindings.
    for (const stale of graph.querySelectorAll(
      ".gha-run-scrollbar, .gha-run-resize-handle"
    ))
      stale.remove();
    const staleFrame = canvas.closest(".gha-run-canvas-frame");
    if (staleFrame) staleFrame.replaceWith(canvas);
    canvas.setAttribute("role", "region");
    canvas.setAttribute("aria-label", "Workflow jobs, scroll horizontally");
    canvas.tabIndex = 0;
    if (state.jobsViewHeight !== undefined)
      canvas.style.setProperty("--gha-run-canvas-height", `${state.jobsViewHeight}px`);
    const bar = document.createElement("div");
    bar.className = "gha-run-scrollbar";
    const controls = document.createElement("div");
    controls.className = "gha-run-controls";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "form-control input-sm gha-run-job-search";
    search.setAttribute("aria-label", "Search jobs");
    search.placeholder = "Search jobs";
    search.value = state.jobSearch;
    const searchWrap = document.createElement("div");
    searchWrap.className = "gha-run-job-search-wrap";
    const clearSearch = document.createElement("button");
    clearSearch.type = "button";
    clearSearch.className = "gha-run-job-search-clear";
    clearSearch.setAttribute("aria-label", "Clear job search");
    clearSearch.textContent = "×";
    clearSearch.hidden = !search.value;
    searchWrap.append(search, clearSearch);
    const applySearch = () => {
      state.searchTimeout = undefined;
      state.appliedSearch = state.jobSearch;
      canvas.scrollTop = 0;
      canvas.scrollLeft = 0;
      modules.scheduleUpdate();
    };
    const searchJobs = (immediate = false) => {
      state.jobSearch = search.value;
      clearSearch.hidden = !search.value;
      clearTimeout(state.searchTimeout);
      if (immediate) applySearch();
      else state.searchTimeout = setTimeout(applySearch, 250);
    };
    listen(search, "input", () => searchJobs());
    listen(clearSearch, "click", () => {
      search.value = "";
      searchJobs(true);
      search.focus();
    });
    const filter = document.createElement("details");
    filter.className = "gha-run-hide-filter";
    const trigger = document.createElement("summary");
    trigger.className = "gha-run-hide-trigger";
    const triggerLabel = document.createElement("span");
    triggerLabel.textContent = "Filter jobs";
    trigger.append(createIcon("filter"), triggerLabel);
    const popup = document.createElement("div");
    popup.className = "gha-run-hide-options";
    const options = document.createElement("div");
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", "Filter jobs by status");
    const heading = document.createElement("div");
    heading.className = "gha-run-hide-heading";
    const headingLabel = document.createElement("span");
    headingLabel.textContent = "Filter jobs by status";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn-link";
    clear.textContent = "Show all jobs";
    heading.append(headingLabel, clear);
    options.append(heading);
    const checkboxes = new Map();
    const countLabels = new Map();
    for (const [status, name, icon] of statusOptions) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = status;
      const count = document.createElement("span");
      count.className = "gha-run-hide-count";
      count.textContent = "0";
      label.append(checkbox, createIcon(icon), name, count);
      options.append(label);
      checkboxes.set(checkbox, status);
      countLabels.set(status, count);
    }
    const updateCounts = (counts) => {
      for (const [status, label] of countLabels) {
        const value = String(counts.get(status));
        if (label.textContent !== value) label.textContent = value;
      }
    };
    const select = (event) => {
      const status = checkboxes.get(event.target);
      if (!status) return;
      if (event.target.checked) selectedStatuses.add(status);
      else selectedStatuses.delete(status);
      modules.scheduleUpdate();
    };
    const reset = () => {
      selectedStatuses.clear();
      modules.scheduleUpdate();
    };
    const dismiss = (event) => {
      if (!filter.contains(event.target)) filter.open = false;
      if (!settings.contains(event.target)) settings.open = false;
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      filter.open = false;
      trigger.focus();
      event.preventDefault();
      event.stopPropagation();
    };
    const fit = () => {
      if (!filter.open) return;
      const bounds = controls.getBoundingClientRect();
      const below = window.innerHeight - bounds.bottom - 20;
      const above =
        bounds.top - (parseFloat(getComputedStyle(bar).top) || 0) - 20;
      const upwards =
        below < Math.min(420, popup.scrollHeight) && above > below;
      popup.style.top = upwards ? "auto" : "calc(100% + 8px)";
      popup.style.bottom = upwards ? "calc(100% + 8px)" : "auto";
      popup.style.maxHeight = `${Math.max(
        0,
        Math.min(420, upwards ? above : below)
      )}px`;
    };
    listen(options, "change", select);
    listen(clear, "click", reset);
    listen(filter, "keydown", escape);
    listen(filter, "toggle", fit);
    listen(document, "click", dismiss);
    listen(window, "resize", fit);
    listen(window, "scroll", fit, { passive: true });
    popup.append(options);
    filter.append(trigger, popup);
    const searchFilter = document.createElement("div");
    searchFilter.className = "gha-run-search-filter";
    searchFilter.append(searchWrap, filter);
    const jobTools = document.createElement("div");
    jobTools.className = "gha-run-job-tools";
    jobTools.append(searchFilter);
    controls.append(jobTools);
    const settings = document.createElement("details");
    settings.className = "gha-run-settings";
    const settingsTrigger = document.createElement("summary");
    settingsTrigger.className = "gha-run-settings-trigger";
    settingsTrigger.setAttribute("aria-label", "Job view settings");
    settingsTrigger.title = "Job view settings";
    settingsTrigger.append(createIcon("gear"));
    const settingsMenu = document.createElement("div");
    settingsMenu.className = "gha-run-settings-menu";
    const hoverSetting = document.createElement("div");
    hoverSetting.className = "gha-run-setting";
    const hoverLabel = document.createElement("span");
    hoverLabel.id = `gha-run-hover-label-${++state.settingsToggleId}`;
    hoverLabel.textContent = "Highlight related jobs on hover";
    const hoverToggle = document.createElement("button");
    hoverToggle.type = "button";
    hoverToggle.className = "gha-run-hover-toggle gha-run-setting-toggle";
    hoverToggle.setAttribute("aria-labelledby", hoverLabel.id);
    const hoverTrack = document.createElement("span");
    hoverTrack.className = "gha-run-setting-track";
    hoverTrack.setAttribute("aria-hidden", "true");
    const hoverStatus = document.createElement("span");
    hoverStatus.setAttribute("aria-hidden", "true");
    hoverToggle.append(hoverTrack, hoverStatus);
    hoverSetting.append(hoverLabel, hoverToggle);
    const groupSetting = document.createElement("div");
    groupSetting.className = "gha-run-setting";
    const groupLabel = document.createElement("span");
    groupLabel.id = `gha-run-group-label-${++state.settingsToggleId}`;
    groupLabel.textContent = "Group by status";
    const groupToggle = document.createElement("button");
    groupToggle.type = "button";
    groupToggle.className = "gha-run-group-toggle gha-run-setting-toggle";
    groupToggle.setAttribute("aria-labelledby", groupLabel.id);
    const groupTrack = document.createElement("span");
    groupTrack.className = "gha-run-setting-track";
    groupTrack.setAttribute("aria-hidden", "true");
    const groupStatus = document.createElement("span");
    groupStatus.setAttribute("aria-hidden", "true");
    groupToggle.append(groupTrack, groupStatus);
    groupSetting.append(groupLabel, groupToggle);
    const createChoiceSetting = (labelText, key, choices, syncMethod) => {
      const setting = document.createElement("div");
      setting.className = "gha-run-setting";
      const label = document.createElement("span");
      label.id = `gha-run-choice-label-${++state.settingsToggleId}`;
      label.textContent = labelText;
      const group = document.createElement("div");
      group.className = "gha-run-setting-choices";
      group.setAttribute("role", "group");
      group.setAttribute("aria-labelledby", label.id);
      const buttons = new Map();
      for (const [value, name] of choices) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = name;
        button.dataset.value = value;
        group.append(button);
        buttons.set(value, button);
        listen(button, "click", () => {
          state[key] = value;
          for (const scrollbar of scrollbars.values())
            scrollbar[syncMethod]();
          modules.saveSettings({ [key]: value });
        });
      }
      setting.append(label, group);
      return {
        setting,
        sync() {
          for (const [value, button] of buttons)
            button.setAttribute("aria-pressed", String(state[key] === value));
        },
      };
    };
    const searchSetting = createChoiceSetting(
      "Search and filter",
      "searchPosition",
      [
        ["left", "Left"],
        ["right", "Right"],
      ],
      "syncSearchPosition"
    );
    const arrowSetting = createChoiceSetting(
      "Scroll arrows",
      "arrowPlacement",
      [
        ["left", "Left"],
        ["right", "Right"],
        ["both", "Both"],
      ],
      "syncArrowPlacement"
    );
    settingsMenu.append(
      hoverSetting,
      groupSetting,
      searchSetting.setting,
      arrowSetting.setting
    );
    settings.append(settingsTrigger, settingsMenu);
    controls.append(settings);
    const syncSearchPosition = () => {
      if (state.searchPosition === "left") {
        if (controls.lastElementChild !== jobTools) controls.append(jobTools);
        if (searchFilter.firstElementChild !== filter)
          searchFilter.insertBefore(filter, searchWrap);
      } else {
        if (controls.firstElementChild !== jobTools)
          controls.insertBefore(jobTools, settings);
        if (searchFilter.firstElementChild !== searchWrap)
          searchFilter.insertBefore(searchWrap, filter);
      }
      controls.dataset.searchPosition = state.searchPosition;
      bar.dataset.searchPosition = state.searchPosition;
      searchSetting.sync();
    };
    syncSearchPosition();
    listen(settings, "keydown", (event) => {
      if (event.key !== "Escape") return;
      settings.open = false;
      settingsTrigger.focus();
      event.preventDefault();
      event.stopPropagation();
    });
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.step = "1";
    input.value = "0";
    input.setAttribute("aria-label", "Scroll workflow jobs horizontally");
    const header = document.createElement("div");
    header.className = "gha-run-scrollbar-header";
    const navigation = document.createElement("div");
    navigation.className = "gha-run-scroll-navigation";
    const resetScope = document.createElement("button");
    resetScope.type = "button";
    resetScope.className = "gha-run-scope-reset";
    resetScope.textContent = "Exit scoped view";
    resetScope.hidden = true;
    const arrows = new Map();
    for (const direction of [-1, 1]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gha-run-scroll-arrow";
      button.dataset.direction = String(direction);
      button.setAttribute(
        "aria-label",
        `Scroll workflow jobs ${direction < 0 ? "left" : "right"}`
      );
      const move = () => {
        const columns = stages.querySelectorAll(
          ":scope > .WorkflowStage:not([data-gha-status-hidden])"
        );
        if (!columns.length) return;
        const origin = columns[0].offsetLeft;
        const current = canvas.scrollLeft;
        let target = direction > 0 ? Number(input.max) : 0;
        for (const column of columns) {
          const position = column.offsetLeft - origin;
          if (direction > 0 && position > current + 1) {
            target = position;
            break;
          }
          if (direction < 0 && position < current - 1) target = position;
        }
        canvas.scrollLeft = Math.min(Number(input.max), target);
        sync();
      };
      listen(button, "click", move);
      arrows.set(direction, { button });
    }
    const syncArrowPlacement = () => {
      const left = arrows.get(-1).button;
      const right = arrows.get(1).button;
      if (state.arrowPlacement === "right")
        header.replaceChildren(input, left, right);
      else if (state.arrowPlacement === "both")
        header.replaceChildren(left, input, right);
      else header.replaceChildren(left, right, input);
      arrowSetting.sync();
    };
    syncArrowPlacement();
    navigation.append(resetScope, header);
    const filterStatus = document.createElement("span");
    filterStatus.className = "gha-run-filter-status";
    filterStatus.setAttribute("role", "status");
    bar.append(controls, navigation, filterStatus);
    canvas.before(bar);
    const frame = document.createElement("div");
    frame.className = "gha-run-canvas-frame";
    canvas.before(frame);
    frame.append(canvas);
    const resizeHandle = document.createElement("button");
    resizeHandle.type = "button";
    resizeHandle.className = "gha-run-resize-handle";
    resizeHandle.setAttribute("aria-label", "Resize jobs view vertically");
    resizeHandle.title = "Drag or use arrow keys to resize jobs view";
    frame.append(resizeHandle);
    const setHeight = (height) => {
      state.jobsViewHeight = Math.max(180, Math.round(height));
      canvas.style.setProperty("--gha-run-canvas-height", `${state.jobsViewHeight}px`);
    };
    let resizeDrag;
    const startResize = (event) => {
      if (event.button !== 0 || resizeDrag) return;
      resizeDrag = {
        id: event.pointerId,
        startY: event.clientY,
        height: canvas.getBoundingClientRect().height,
      };
      resizeHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    };
    const moveResize = (event) => {
      if (resizeDrag?.id !== event.pointerId) return;
      setHeight(resizeDrag.height + event.clientY - resizeDrag.startY);
      event.preventDefault();
      event.stopPropagation();
    };
    const stopResize = (event) => {
      if (resizeDrag?.id !== event.pointerId) return;
      resizeDrag = undefined;
      modules.saveSettings({ jobsViewHeight: state.jobsViewHeight });
      event.stopPropagation();
    };
    const resizeKeys = (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      setHeight(
        (state.jobsViewHeight ?? canvas.getBoundingClientRect().height) +
          (event.key === "ArrowUp" ? -40 : 40)
      );
      modules.saveSettings({ jobsViewHeight: state.jobsViewHeight });
      event.preventDefault();
      event.stopPropagation();
    };
    listen(resizeHandle, "pointerdown", startResize);
    listen(resizeHandle, "pointermove", moveResize);
    listen(resizeHandle, "pointerup", stopResize);
    listen(resizeHandle, "pointercancel", stopResize);
    listen(resizeHandle, "lostpointercapture", stopResize);
    listen(resizeHandle, "keydown", resizeKeys);
    const hover = addHoverHighlights(stages, (active) => {
      resetScope.hidden = !active;
      bar.classList.toggle("gha-run-scoped", active);
      if (active) canvas.scrollLeft = 0;
      modules.scheduleUpdate();
    });
    const syncHoverToggle = () => {
      hoverToggle.setAttribute("aria-pressed", String(state.hoverFocusEnabled));
      hoverStatus.textContent = state.hoverFocusEnabled ? "On" : "Off";
      hover.paint();
    };
    const toggleHoverFocus = () => {
      state.hoverFocusEnabled = !state.hoverFocusEnabled;
      for (const scrollbar of scrollbars.values()) scrollbar.syncHoverToggle();
      modules.saveSettings({ hoverFocusEnabled: state.hoverFocusEnabled });
    };
    listen(hoverToggle, "click", toggleHoverFocus);
    syncHoverToggle();
    const syncGroupingToggle = () => {
      groupToggle.setAttribute(
        "aria-pressed",
        String(state.statusGroupingEnabled)
      );
      groupStatus.textContent = state.statusGroupingEnabled ? "On" : "Off";
    };
    listen(groupToggle, "click", () => {
      state.statusGroupingEnabled = !state.statusGroupingEnabled;
      if (!state.statusGroupingEnabled) state.collapsedStageGroups.clear();
      for (const scrollbar of scrollbars.values()) scrollbar.syncGroupingToggle();
      modules.scheduleUpdate();
      modules.saveSettings({ statusGroupingEnabled: state.statusGroupingEnabled });
    });
    syncGroupingToggle();
    const exitScope = () => {
      hover.clearScope();
      canvas.focus({ preventScroll: true });
    };
    listen(resetScope, "click", exitScope);

    const sync = () => {
      input.value = String(canvas.scrollLeft);
      arrows.get(-1).button.disabled = canvas.scrollLeft <= 0;
      arrows.get(1).button.disabled = canvas.scrollLeft >= Number(input.max);
    };
    const refresh = () => {
      if (search.value !== state.jobSearch) search.value = state.jobSearch;
      clearSearch.hidden = !search.value;
      for (const [checkbox, status] of checkboxes)
        checkbox.checked = selectedStatuses.has(status);
      const selection =
        selectedStatuses.size === 1
          ? statusOptions.find(([status]) => selectedStatuses.has(status))?.[1]
          : `${selectedStatuses.size} selected`;
      const label = selectedStatuses.size ? selection : "Filter jobs";
      if (triggerLabel.textContent !== label) triggerLabel.textContent = label;
      const accessibleLabel = selectedStatuses.size
        ? `Filter jobs: ${selection}`
        : "Filter jobs";
      if (trigger.getAttribute("aria-label") !== accessibleLabel)
        trigger.setAttribute("aria-label", accessibleLabel);
      const resultCount = graph.querySelectorAll(
        ".WorkflowStage > .WorkflowCard:not([data-gha-status-hidden]):not([data-gha-scope-hidden])"
      ).length;
      const announcement =
        selectedStatuses.size || state.appliedSearch
          ? `${resultCount} matching job ${
              resultCount === 1 ? "card" : "cards"
            }`
          : "";
      if (filterStatus.textContent !== announcement)
        filterStatus.textContent = announcement;
      clear.disabled = selectedStatuses.size === 0;
      fit();
      let max = Math.max(0, canvas.scrollWidth - canvas.clientWidth);
      const visibleStages = stages.querySelectorAll(
        ":scope > .WorkflowStage:not([data-gha-status-hidden]):not([data-gha-scope-hidden])"
      );
      const firstStage = visibleStages[0];
      const lastStage = visibleStages[visibleStages.length - 1];
      if (!lastStage) max = 0;
      else if (lastStage.offsetWidth) {
        const visibleWidth =
          lastStage.offsetLeft - firstStage.offsetLeft + lastStage.offsetWidth;
        max = Math.min(max, Math.max(0, visibleWidth - canvas.clientWidth));
      }
      input.max = String(max);
      input.disabled = max === 0;
      if (max > 0 && input.clientWidth > 0) {
        const width = Math.min(
          input.clientWidth,
          Math.max(
            64,
            Math.round(
              (input.clientWidth * canvas.clientWidth) /
                (canvas.clientWidth + max * 1.5)
            )
          )
        );
        input.style.setProperty("--gha-run-scroll-thumb-width", `${width}px`);
      }
      canvas.scrollLeft = Math.min(max, Math.max(0, canvas.scrollLeft));
      sync();
    };
    const scroll = () => {
      canvas.scrollLeft = Number(input.value);
      sync();
    };
    let drag;
    const moveDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      canvas.scrollLeft = Math.round(
        Math.max(
          0,
          Math.min(
            drag.max,
            drag.scrollLeft +
              ((event.clientX - drag.startX) * drag.max) / drag.travel
          )
        )
      );
      sync();
      event.preventDefault();
    };
    const startDrag = (event) => {
      if (input.disabled || event.button !== 0 || drag) return;
      const rect = input.getBoundingClientRect();
      const width = Math.min(
        rect.width,
        parseFloat(
          input.style.getPropertyValue("--gha-run-scroll-thumb-width")
        ) || 64
      );
      const travel = rect.width - width;
      if (travel <= 0) return;
      const thumbLeft =
        rect.left + (canvas.scrollLeft / Number(input.max)) * travel;
      if (event.clientX < thumbLeft || event.clientX > thumbLeft + width)
        return;
      drag = {
        id: event.pointerId,
        startX: event.clientX,
        scrollLeft: canvas.scrollLeft,
        travel,
        max: Number(input.max),
      };
      input.setPointerCapture(event.pointerId);
      input.focus();
      event.preventDefault();
    };
    const stopDrag = (event) => {
      if (drag?.id === event.pointerId) drag = undefined;
    };
    const scrollWheel = (event) => {
      if (!event.deltaX) return;
      canvas.scrollLeft = Math.min(
        Number(input.max),
        Math.max(0, canvas.scrollLeft + event.deltaX)
      );
      sync();
    };
    const scrollKeys = (event) => {
      if (
        event.target !== canvas ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
        input.disabled
      )
        return;
      canvas.scrollLeft = Math.min(
        Number(input.max),
        Math.max(0, canvas.scrollLeft + (event.key === "ArrowLeft" ? -40 : 40))
      );
      sync();
      event.preventDefault();
    };
    const stopCanvasInput = (event) => {
      if (event.type !== "keydown" || event.key.startsWith("Arrow"))
        event.stopPropagation();
    };
    const canvasEvents = [
      "wheel",
      "pointerdown",
      "pointermove",
      "selectstart",
      "dragstart",
      "keydown",
    ];
    for (const type of canvasEvents) {
      listen(canvas, type, stopCanvasInput, { capture: true });
    }
    const stopGraphInput = (event) => event.stopPropagation();
    for (const type of ["pointerdown", "pointermove", "wheel", "keydown"]) {
      listen(bar, type, stopGraphInput);
    }
    listen(input, "pointerdown", startDrag);
    listen(input, "pointermove", moveDrag);
    listen(input, "pointerup", stopDrag);
    listen(input, "pointercancel", stopDrag);
    listen(input, "lostpointercapture", stopDrag);
    listen(input, "input", scroll);
    listen(canvas, "scroll", sync, { passive: true });
    listen(canvas, "wheel", scrollWheel, {
      capture: true,
      passive: true,
    });
    listen(canvas, "keydown", scrollKeys, { capture: true });
    const resize = new ResizeObserver(refresh);
    resize.observe(canvas);
    resize.observe(stages);
    resize.observe(input);
    scrollbars.set(graph, {
      canvas,
      stages,
      prepare: hover.refresh,
      refresh,
      updateCounts,
      syncHoverToggle,
      syncGroupingToggle,
      syncSearchPosition,
      syncArrowPlacement,
      remove() {
        hover.remove();
        for (const [target, type, handler, options] of listeners)
          target.removeEventListener(type, handler, options);
        resizeHandle.remove();
        frame.replaceWith(...frame.childNodes);
        clearTimeout(state.searchTimeout);
        state.searchTimeout = undefined;
        state.appliedSearch = state.jobSearch;
        resize.disconnect();
        bar.remove();
      },
    });
  }


  modules.addScrollbar = addScrollbar;
})();
