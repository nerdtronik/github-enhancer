(() => {
  "use strict";

  const key = "ghaRunViewPreferencesV1";
  const defaults = {
    enhancedViewEnabled: true,
    jobsViewHeight: null,
    hoverFocusEnabled: true,
    statusGroupingEnabled: false,
    searchPosition: "right",
    arrowPlacement: "left",
  };
  const validHeight = (value) => Number.isSafeInteger(value) && value >= 180;
  const validPatch = (value) => {
    if (!value || typeof value !== "object") return {};
    const patch = {};
    if (typeof value.enhancedViewEnabled === "boolean")
      patch.enhancedViewEnabled = value.enhancedViewEnabled;
    if (value.jobsViewHeight === null || validHeight(value.jobsViewHeight))
      patch.jobsViewHeight = value.jobsViewHeight;
    if (typeof value.hoverFocusEnabled === "boolean")
      patch.hoverFocusEnabled = value.hoverFocusEnabled;
    if (typeof value.statusGroupingEnabled === "boolean")
      patch.statusGroupingEnabled = value.statusGroupingEnabled;
    if (["left", "right"].includes(value.searchPosition))
      patch.searchPosition = value.searchPosition;
    if (["left", "right", "both"].includes(value.arrowPlacement))
      patch.arrowPlacement = value.arrowPlacement;
    return patch;
  };
  let preferences = { ...defaults };
  let pending = {};
  let loaded = false;
  let writes = Promise.resolve();
  let menuScheduled = false;
  const publish = () =>
    window.postMessage(
      { type: "gha-run-settings:loaded", settings: preferences },
      location.origin
    );
  const persist = () => {
    const snapshot = { ...preferences };
    const write = writes.then(() => chrome.storage.local.set({ [key]: snapshot }));
    writes = write.catch((error) => console.warn("Could not save job view settings", error));
    return write;
  };

  const isRunPage = () =>
    /^\/[^/]+\/[^/]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?\/?$/.test(location.pathname);

  function syncNativeMenu() {
    if (!loaded || !isRunPage()) return;
    for (const createBadge of document.querySelectorAll('ul[role="menu"] [role="menuitem"]')) {
      if (createBadge.textContent.trim() !== "Create status badge") continue;
      const nativeItem = createBadge.closest("li.ActionListItem");
      if (!nativeItem) continue;
      let item = nativeItem.parentElement.querySelector(":scope > li[data-gha-run-view-switch]");
      if (!item) {
        item = document.createElement("li");
        item.className = nativeItem.className;
        item.setAttribute("role", "none");
        if (nativeItem.hasAttribute("data-targets"))
          item.setAttribute("data-targets", nativeItem.getAttribute("data-targets"));
        if (nativeItem.hasAttribute("data-view-component"))
          item.setAttribute("data-view-component", nativeItem.getAttribute("data-view-component"));
        item.dataset.ghaRunViewSwitch = "";
        const button = document.createElement("button");
        button.type = "button";
        button.className = `${createBadge.className} gha-run-view-switch-button`;
        button.setAttribute("role", "menuitem");
        if (createBadge.hasAttribute("tabindex"))
          button.setAttribute("tabindex", createBadge.getAttribute("tabindex"));
        if (createBadge.hasAttribute("data-view-component"))
          button.setAttribute("data-view-component", createBadge.getAttribute("data-view-component"));
        const label = document.createElement("span");
        label.textContent = "Enhanced view";
        const track = document.createElement("span");
        track.className = "gha-run-view-switch-track";
        track.setAttribute("aria-hidden", "true");
        track.append(document.createElement("span"));
        button.append(label, track);
        button.addEventListener("click", async () => {
          button.disabled = true;
          const previous = preferences.enhancedViewEnabled;
          preferences = { ...preferences, enhancedViewEnabled: !previous };
          try {
            await persist();
            location.reload();
          } catch {
            preferences = { ...preferences, enhancedViewEnabled: previous };
            button.disabled = false;
            syncNativeMenu();
          }
        });
        item.append(button);
        nativeItem.after(item);
      }
      const button = item.querySelector("button");
      button.setAttribute("aria-pressed", String(preferences.enhancedViewEnabled));
    }
  }

  function scheduleNativeMenu() {
    if (menuScheduled || !loaded || !isRunPage()) return;
    menuScheduled = true;
    requestAnimationFrame(() => {
      menuScheduled = false;
      syncNativeMenu();
    });
  }

  new MutationObserver((records) => {
    if (!isRunPage()) return;
    if (records.some(({ addedNodes }) => Array.from(addedNodes).some((node) =>
      node.nodeType === 1 && (
        node.matches('ul[role="menu"], ul[role="menu"] *') ||
        node.querySelector('ul[role="menu"]')
      )
    ))) scheduleNativeMenu();
  }).observe(document, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("turbo:load", scheduleNativeMenu);

  window.addEventListener("message", (event) => {
    if (event.source && event.source !== window) return;
    if (event.origin && event.origin !== location.origin) return;
    if (event.data?.type === "gha-run-settings:request") {
      if (loaded) publish();
      return;
    }
    if (event.data?.type !== "gha-run-settings:update") return;
    const patch = validPatch(event.data.settings);
    if (!Object.keys(patch).length) return;
    if (!loaded) {
      pending = { ...pending, ...patch };
      return;
    }
    preferences = { ...preferences, ...patch };
    persist();
  });

  chrome.storage.local
    .get(key)
    .then((stored) => {
      preferences = { ...defaults, ...validPatch(stored[key]), ...pending };
    })
    .catch((error) => console.warn("Could not load job view settings", error))
    .finally(() => {
      loaded = true;
      publish();
      scheduleNativeMenu();
      if (Object.keys(pending).length) persist();
      pending = {};
    });
})();
