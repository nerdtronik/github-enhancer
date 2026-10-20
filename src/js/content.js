(() => {
  "use strict";

  const CLICK_DELAY_MS = 50;
  const LOADING_TIMEOUT_MS = 500;
  const PIN_LOADING_TIMEOUT_MS = 15000;
  const CACHED_WORKFLOW_RELOADS = 3;
  let repository = "";
  let query = "";
  let scheduled = false;
  let fontRevision = 0;
  const loadingSidebars = new WeakMap();
  const cleanupTimers = new WeakMap();
  const workflowIndexLoads = new Map();
  let scrollContainers = new WeakMap();

  function workflowRoute(path) {
    if (typeof path !== "string") return "";
    const prefix = path.startsWith(".github/workflows/") ? ".github/workflows/" :
      path.startsWith("dynamic/") ? "dynamic/" : "";
    return prefix ? path.slice(prefix.length).split("/").map(encodeURIComponent).join("/") : "";
  }

  async function fetchWorkflowIndex(currentRepository) {
    async function page(number) {
      const response = await fetch(`/${currentRepository}/actions/_workflows?page=${number}&sort=default`, {
        credentials: "include",
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const route = (await response.json())?.payload?.workflowsSidebarRoute;
      if (!Array.isArray(route?.workflows) || !Number.isInteger(route.totalCount))
        throw new Error("Unexpected workflow response");
      return route;
    }

    const first = await page(1);
    const pageSize = first.workflows.length;
    if (first.totalCount && !pageSize) throw new Error("Incomplete workflow response");
    const workflows = [...first.workflows];
    for (let number = 2; number <= Math.ceil(first.totalCount / pageSize); number++) {
      const next = await page(number);
      workflows.push(...next.workflows);
    }
    if (workflows.length !== first.totalCount ||
      new Set(workflows.map((item) => item.id)).size !== workflows.length ||
      workflows.some((item) => typeof item.name !== "string" ||
        !workflowRoute(item.path)))
      throw new Error("Incomplete workflow response");
    return workflows;
  }

  function loadWorkflowIndex(currentRepository) {
    if (workflowIndexLoads.has(currentRepository)) return workflowIndexLoads.get(currentRepository);
    const loading = (async () => {
      const key = `ghaWorkflowIndexV1:${currentRepository}`;
      let cached;
      try {
        cached = (await chrome.storage.local.get(key))[key];
      } catch (error) {
        console.warn("Could not read cached workflow list", error);
      }
      if (Array.isArray(cached?.workflows) && Number.isInteger(cached.uses) &&
        cached.uses >= 0 && cached.uses < CACHED_WORKFLOW_RELOADS) {
        try {
          await chrome.storage.local.set({ [key]: { ...cached, uses: cached.uses + 1 } });
        } catch (error) {
          console.warn("Could not update cached workflow list", error);
        }
        return cached.workflows;
      }
      const workflows = await fetchWorkflowIndex(currentRepository);
      try {
        await chrome.storage.local.set({ [key]: { workflows, uses: 0 } });
      } catch (error) {
        console.warn("Could not cache workflow list", error);
      }
      return workflows;
    })();
    workflowIndexLoads.set(currentRepository, loading);
    loading.catch(() => workflowIndexLoads.delete(currentRepository));
    return loading;
  }

  function whenPageIdle(callback) {
    const schedule = () => {
      if (window.requestIdleCallback)
        window.requestIdleCallback(callback);
      else setTimeout(callback, 0);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
  }

  function syncFetchedRows(state, controls, sidebar, nativeWorkflows) {
    if (!state.index) return [];
    if (!state.apiList) {
      state.apiList = document.createElement("ul");
      state.apiList.className = "gha-workflow-api-list";
      state.apiRows = new Map();
    }
    if (state.apiList.previousElementSibling !== sidebar) sidebar.after(state.apiList);
    const fontSource = nativeWorkflows[0] ?? sidebar;
    const fontContext = [];
    for (let element = fontSource; element; element = element.parentElement)
      fontContext.push([element.tagName, element.id, element.className, element.getAttribute("style")]);
    const fontSignature = JSON.stringify(fontContext);
    if (state.fontSignature !== fontSignature || state.fontRevision !== fontRevision) {
      state.apiList.style.fontSize = getComputedStyle(fontSource).fontSize;
      state.fontSignature = fontSignature;
      state.fontRevision = fontRevision;
    }
    const workflowPath = `/${repository}/actions/workflows/`;
    const nativeIds = new Set(nativeWorkflows.map((link) => link.pathname.slice(workflowPath.length)));
    const nativeIcon = [...sidebar.querySelectorAll(
      '[data-component="ActionList.TrailingAction"][class*="pinButton"] button, button[aria-label*="pin" i]'
    )].find((button) => /^Pin\b/i.test(button.getAttribute("aria-label") ??
      document.getElementById(button.getAttribute("aria-labelledby"))?.textContent.trim() ?? ""))
      ?.querySelector("svg");
    for (const item of state.index) {
      const id = workflowRoute(item.path);
      if (nativeIds.has(id)) {
        state.apiRows.get(id)?.remove();
        state.apiRows.delete(id);
      } else if (!state.apiRows.has(id)) {
        const requestedRepository = repository;
        const row = document.createElement("li");
        row.className = "gha-workflow-api-row";
        const link = document.createElement("a");
        link.href = `/${repository}/actions/workflows/${id}`;
        link.textContent = item.name;
        if (typeof item.state === "string" && item.state.startsWith("disabled_")) {
          link.setAttribute("data-gha-workflow-disabled", "");
          link.setAttribute("aria-label", `${item.name}, disabled workflow`);
        }
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "gha-workflow-api-pin";
        pin.setAttribute("aria-label", `Pin ${item.name}`);
        pin.title = `Pin ${item.name}`;
        pin.append(nativeIcon?.cloneNode(true) ?? document.createTextNode("Pin"));
        pin.addEventListener("click", async () => {
          if (pin.disabled) return;
          pin.disabled = true;
          try {
            while (state.running && controls.isConnected && repository === requestedRepository)
              await new Promise((resolve) => setTimeout(resolve, CLICK_DELAY_MS));
            if (!controls.isConnected || repository !== requestedRepository) return;
            await loadAllWorkflows(state, controls, id);
            if (!controls.isConnected || repository !== requestedRepository) return;
            const native = nativePin(state.sidebar, id);
            if (native) native.click();
            else console.warn("Could not load pin control for workflow", item.name);
          } finally {
            pin.disabled = false;
          }
        });
        row.append(link, pin);
        state.apiList.append(row);
        state.apiRows.set(id, row);
      }
      const link = state.apiRows.get(id)?.firstElementChild;
      if (link) {
        if (link.pathname === location.pathname) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
    }
    return [...state.apiList.querySelectorAll('a[href*="/actions/workflows/"]')];
  }

  function findScrollContainer(element) {
    const cached = scrollContainers.get(element);
    if (cached?.container.isConnected && cached.path.every(([node, parent, className, style, expanded]) =>
      node.parentElement === parent && node.getAttribute("class") === className &&
      node.getAttribute("style") === style && node.getAttribute("data-expanded") === expanded))
      return cached.container;
    const path = [];
    for (
      let current = element;
      current && current !== document.body;
      current = current.parentElement
    ) {
      path.push([current, current.parentElement, current.getAttribute("class"),
        current.getAttribute("style"), current.getAttribute("data-expanded")]);
      if (["auto", "scroll"].includes(getComputedStyle(current).overflowY)) {
        scrollContainers.set(element, { container: current, path });
        return current;
      }
    }
    return null;
  }

  function findShowMore(sidebar) {
    return (
      sidebar.isConnected &&
      Array.from(sidebar.querySelectorAll("button")).find(
        (button) =>
          /^Show more(?: workflows)?(?:\.{3}|…)?$/i.test(
            button.textContent.trim()
          ) && !button.closest("[hidden], .gha-workflow-category-picker")
      )
    );
  }

  function nativePin(sidebar, id) {
    const path = `/${repository}/actions/workflows/${id}`;
    const link = [...sidebar.querySelectorAll('a[href*="/actions/workflows/"]')]
      .find((item) => item.pathname === path);
    return link?.closest("li")?.querySelector(
      '[data-component="ActionList.TrailingAction"][class*="pinButton"] button, button[aria-label*="pin" i]');
  }

  function finishExpansion(state) {
    if (
      !state.expanding ||
      !state.sidebar.isConnected ||
      findShowMore(state.sidebar)
    )
      return;
    for (
      let element = state.sidebar;
      element;
      element = element.parentElement
    ) {
      element.scrollTop = 0;
    }
    state.expanding = false;
  }

  function extendLoadingTimeout(controls, state) {
    const loading = controls.querySelector(".gha-workflow-loading");
    const actionsPath = `/${repository}/actions`;
    loading.hidden = !!state.index;
    clearTimeout(state.loadingTimeout);
    state.loadingTimeout = setTimeout(() => {
      loading.hidden = true;
      if (
        controls.isConnected &&
        (location.pathname === actionsPath ||
          location.pathname.startsWith(`${actionsPath}/`))
      ) {
        finishExpansion(state);
      }
    }, LOADING_TIMEOUT_MS);
  }

  async function loadAllWorkflows(state, controls, targetId) {
    if (state.running) return;
    state.running = true;
    const actionsPath = `/${repository}/actions`;
    const deadline = targetId ? Date.now() + PIN_LOADING_TIMEOUT_MS : Infinity;
    let clickedButton;
    let linkCountAtClick = 0;
    try {
      while (
        controls.isConnected &&
        Date.now() < deadline &&
        (location.pathname === actionsPath ||
          location.pathname.startsWith(`${actionsPath}/`))
      ) {
        if (targetId && nativePin(state.sidebar, targetId)) break;
        const button = findShowMore(state.sidebar);
        if (!button) {
          if (targetId && clickedButton) {
            await new Promise((resolve) => setTimeout(resolve, CLICK_DELAY_MS));
            continue;
          }
          if (!targetId && controls.querySelector(".gha-workflow-loading").hidden)
            finishExpansion(state);
          break;
        }
        if (!targetId) state.expanding = true;
        if (
          !button.disabled &&
          button.getAttribute("aria-disabled") !== "true" &&
          button.getAttribute("data-loading") !== "true" &&
          (!targetId || button !== clickedButton ||
            state.sidebar.querySelectorAll('a[href*="/actions/workflows/"]').length > linkCountAtClick)
        ) {
          if (!targetId) extendLoadingTimeout(controls, state);
          if (targetId) {
            clickedButton = button;
            linkCountAtClick = state.sidebar.querySelectorAll('a[href*="/actions/workflows/"]').length;
          }
          button.click();
        }
        await new Promise((resolve) => setTimeout(resolve, CLICK_DELAY_MS));
      }
    } finally {
      state.running = false;
      if (
        !state.sidebar.isConnected ||
        (location.pathname !== actionsPath &&
          !location.pathname.startsWith(`${actionsPath}/`))
      ) {
        scheduleUpdate();
      }
    }
  }

  function update() {
    const match = location.pathname.match(/^\/([^/]+\/[^/]+)\/actions(?:\/|$)/);
    const currentRepository = match?.[1] ?? "";
    if (currentRepository !== repository) {
      repository = currentRepository;
      query = "";
      window.GHAWorkflowCategories.reset();
      document
        .querySelectorAll(".gha-workflow-filter")
        .forEach((el) => el.remove());
      document.querySelectorAll(".gha-workflow-api-list").forEach((el) => el.remove());
      document.querySelectorAll("[data-gha-workflow-hidden]").forEach((el) => {
        el.removeAttribute("data-gha-workflow-hidden");
      });
    }
    if (!repository) return;
    const actionsAside = document.querySelector('aside[aria-label="Actions"]');
    const collapsed = actionsAside?.getAttribute("data-expanded") === "false";
    const flyout = collapsed && document.querySelector(
      '#__primerPortalRoot__ [data-component="AnchoredOverlay"] nav[aria-label="Workflows"]'
    );
    if (collapsed) {
      window.GHAWorkflowCategories.reset();
      document.querySelectorAll(".gha-workflow-filter, .gha-workflow-api-list")
        .forEach((element) => { if (!flyout?.parentElement.contains(element)) element.remove(); });
      document.querySelectorAll('aside[aria-label="Actions"] [data-gha-workflow-hidden], [data-gha-workflow-all-hidden]')
        .forEach((element) => {
          element.removeAttribute("data-gha-workflow-hidden");
          element.removeAttribute("data-gha-workflow-all-hidden");
        });
      document.querySelectorAll(".gha-workflow-show-more-hidden")
        .forEach((element) => {
          if (!flyout?.contains(element)) element.classList.remove("gha-workflow-show-more-hidden");
        });
      if (!flyout) return;
    }

    const workflowPath = `/${repository}/actions/workflows/`;
    const sidebars = new Set();
    if (flyout) sidebars.add(flyout);
    else {
      for (const link of document.querySelectorAll('a[href*="/actions/workflows/"]')) {
        if (link.origin !== location.origin || !link.pathname.startsWith(workflowPath)) continue;
        const sidebar = link.closest("nav, actions-workflow-list");
        if (sidebar && (!actionsAside || actionsAside.contains(sidebar))) sidebars.add(sidebar);
      }
    }

    const hosts = new Set();
    for (const sidebar of sidebars) {
      const host =
        findScrollContainer(sidebar.parentElement) ?? sidebar.parentElement;
      hosts.add(host);
      let controls = host.querySelector(":scope > .gha-workflow-filter");
      let input = controls?.querySelector("input");
      let clear = controls?.querySelector(".gha-workflow-filter-clear");
      let state = controls && loadingSidebars.get(controls);
      if (!input) {
        controls = document.createElement("div");
        controls.className = "gha-workflow-filter";
        const loading = document.createElement("div");
        loading.className = "gha-workflow-loading";
        loading.setAttribute("role", "status");
        loading.textContent = "Loading workflows…";
        const field = document.createElement("div");
        field.className = "gha-workflow-filter-field";
        input = document.createElement("input");
        input.type = "search";
        input.placeholder = "Filter workflows";
        input.setAttribute("aria-label", "Filter workflows");
        input.autocomplete = "off";
        input.spellcheck = false;
        input.addEventListener("input", () => {
          query = input.value;
          if (query && state?.showIndex) state.showIndex();
          else update();
        });
        clear = document.createElement("button");
        clear.type = "button";
        clear.className = "gha-workflow-filter-clear";
        clear.textContent = "×";
        clear.setAttribute("aria-label", "Clear workflow filter");
        clear.title = "Clear workflow filter";
        clear.hidden = true;
        clear.addEventListener("click", () => {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.focus();
        });
        field.append(input, clear);
        controls.append(loading, field);
        host.prepend(controls);
        state = { sidebar, running: false, expanding: false, fetching: !!window.fetch };
        loadingSidebars.set(controls, state);
        if (window.fetch) {
          const requestedRepository = repository;
          loadWorkflowIndex(requestedRepository).then((index) => {
            if (!controls.isConnected || repository !== requestedRepository) return;
            state.showIndex = () => {
              if (state.index || !controls.isConnected || repository !== requestedRepository) return;
              state.showIndex = null;
              state.fetching = false;
              state.index = index;
              loading.hidden = true;
              update();
            };
            if (query) state.showIndex();
            else whenPageIdle(state.showIndex);
          }).catch((error) => {
            if (!controls.isConnected || repository !== requestedRepository) return;
            console.warn("Could not fetch workflow list", error);
            state.fetching = false;
            extendLoadingTimeout(controls, state);
            update();
          });
        } else extendLoadingTimeout(controls, state);
      }
      state.sidebar = sidebar;
      input.value = query;
      const shouldHideClear = !query;
      if (clear.hidden !== shouldHideClear) clear.hidden = shouldHideClear;
      findShowMore(sidebar)?.classList.toggle("gha-workflow-show-more-hidden", !!state.index);

      const nativeWorkflows = Array.from(
        sidebar.querySelectorAll('a[href*="/actions/workflows/"]')
      ).filter(
        (link) =>
          link.origin === location.origin &&
          link.pathname.startsWith(workflowPath)
      );
      const workflows = [...nativeWorkflows, ...syncFetchedRows(state, controls, sidebar, nativeWorkflows)];
      if (collapsed) {
        for (const link of nativeWorkflows) {
          const row = link.closest("li");
          const pin = row?.querySelector('[data-component="ActionList.TrailingAction"] button');
          const label = pin?.getAttribute("aria-label") ??
            document.getElementById(pin?.getAttribute("aria-labelledby"))?.textContent.trim() ?? "";
          row?.toggleAttribute("data-gha-pinned", /^(?:Unpin|Remove pin)\b/i.test(label));
        }
        for (const link of workflows) link.closest("li")?.toggleAttribute("data-gha-workflow-hidden",
          !link.textContent.toLowerCase().includes(query.trim().toLowerCase()));
      } else if (!state.fetching)
        window.GHAWorkflowCategories.sync(repository, sidebar, workflows, query, workflowPath);

      if (!state.fetching && !state.index) void loadAllWorkflows(state, controls);
    }

    for (const controls of document.querySelectorAll(".gha-workflow-filter")) {
      if (
        hosts.has(controls.parentElement) ||
        loadingSidebars.get(controls)?.running
      ) {
        clearTimeout(cleanupTimers.get(controls));
        cleanupTimers.delete(controls);
      } else if (!cleanupTimers.has(controls)) {
        cleanupTimers.set(
          controls,
          setTimeout(() => {
            cleanupTimers.delete(controls);
            controls.parentElement?.querySelector(":scope > .gha-workflow-categories")?.remove();
            loadingSidebars.get(controls)?.apiList?.remove();
            controls.remove();
          }, LOADING_TIMEOUT_MS)
        );
      }
    }
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  }

  // GitHub replaces navigation in place; a content script only loads once per document.
  new MutationObserver((records) => {
    const currentRepository = location.pathname.match(/^\/([^/]+\/[^/]+)\/actions(?:\/|$)/)?.[1] ?? "";
    if (currentRepository !== repository) {
      scheduleUpdate();
      return;
    }
    if (!repository) return;
    const sidebarSelector = 'aside[aria-label="Actions"], nav[aria-label="Actions workflows"], ' +
      'nav[aria-label="Workflows"], actions-workflow-list, .gha-workflow-filter, ' +
      '.gha-workflow-api-list, .gha-workflow-categories';
    if (records.some(({ target, addedNodes, removedNodes }) => {
      const element = target.nodeType === 1 ? target : target.parentElement;
      if (element?.closest(".js-full-logs-container")) return false;
      if (element?.closest(".gha-workflow-filter, .gha-workflow-categories, .gha-workflow-api-list"))
        return false;
      if (element?.closest(sidebarSelector)) return true;
      const nav = element?.closest("nav");
      if (nav?.querySelector('a[href*="/actions/workflows/"]')) return true;
      if (element?.id && [...document.querySelectorAll(
        'aside[aria-label="Actions"] button[aria-labelledby], ' +
        'nav[aria-label="Actions workflows"] button[aria-labelledby], ' +
        'actions-workflow-list button[aria-labelledby], ' +
        'nav[aria-label="Workflows"] button[aria-labelledby]'
      )].some((button) => button.getAttribute("aria-labelledby").split(/\s+/).includes(element.id)))
        return true;
      return [...addedNodes, ...removedNodes].some((node) => {
        if (node.nodeType !== 1) return false;
        if (node.matches(".gha-workflow-categories") &&
          document.querySelector(".gha-workflow-categories")) return false;
        if (node.matches(sidebarSelector) ||
          node.querySelector(`${sidebarSelector}, nav a[href*="/actions/workflows/"]`)) return true;
        return nav && (node.matches('a[href*="/actions/workflows/"]') ||
          node.querySelector('a[href*="/actions/workflows/"]'));
      });
    })) scheduleUpdate();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "href",
      "hidden",
      "disabled",
      "aria-disabled",
      "aria-label",
      "aria-current",
      "data-loading",
      "data-expanded",
    ],
  });
  document.addEventListener("turbo:load", scheduleUpdate);
  window.addEventListener("popstate", scheduleUpdate);
  window.addEventListener("resize", () => {
    scrollContainers = new WeakMap();
    fontRevision++;
    scheduleUpdate();
  });
  update();
})();
