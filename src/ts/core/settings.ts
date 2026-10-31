/**
 * Settings and storage for every content script. Seam: `settings` (Preferences), `store` (keyed
 * records), `shared()` and `createIcon()`; it also injects the native run-menu switches.
 */
import { DEFAULTS, PREFERENCES } from "./defaults";
import { parseSVG, THEME_ID_PATTERN, type Preferences } from "./definitions";
import { isRunPage } from "./routes";

// `browser` on Firefox, `chrome` on Chromium. In the MAIN world neither exposes storage, so this
// is undefined or lacks storage.local and Settings switches to bridge mode.
const api: typeof browser | undefined = (globalThis as any).browser ?? (globalThis as any).chrome;
const REGISTRY = "__ghaShared";

/**
 * Returns one instance per name across every bundled content script. Each bundle is its own IIFE,
 * but all isolated-world bundles on a page share one globalThis, so plain module singletons would be
 * duplicated per bundle (several storage listeners, divergent state). The first instance wins.
 * Per JS world: the MAIN world has its own registry.
 */
export function shared<T>(name: string, create: () => T): T {
  const registry: Record<string, unknown> = ((globalThis as any)[REGISTRY] ??= {});
  return (registry[name] ??= create()) as T;
}

type Listener = <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;

const LEGACY_RUN_LIST_KEY = "ghaRunAttentionSettingsV1";
const LEGACY_RUN_VIEW_KEY = "ghaRunViewPreferencesV1";
const LEGACY_RUN_VIEW_FIELDS = {
  enhancedViewEnabled: "actionRun_enhancedViewEnabled",
  jobsViewHeight: "actionRun_jobsViewHeight",
  hoverFocusEnabled: "actionRun_hoverFocusEnabled",
  statusGroupingEnabled: "actionRun_statusGroupingEnabled",
  searchPosition: "actionRun_searchPosition",
  arrowPlacement: "actionRun_arrowPlacement",
} as const;
// window.postMessage protocol between the isolated world (owns storage) and MAIN-world bundles
// (cannot reach extension storage). MAIN sends `request` once for the initial state and `set` to
// change a value; the isolated side answers/broadcasts `values` (a partial map plus baseUrl).
// Messages are only accepted from this window and origin; every value is re-validated on apply.
// The page itself passes this origin/source check, which is why every value is re-validated on apply.
const BRIDGE = { request: "gha-settings:request", values: "gha-settings:values", set: "gha-settings:set" };

const isThemeId = (v: unknown) =>
  v === null || (typeof v === "string" && v.length <= 64 && THEME_ID_PATTERN.test(v));

// Storage and bridge messages are untrusted input (old versions, manual edits, other scripts), so
// each value is checked by type and range. The jobs view minimum of 180 matches the clamp in
// features/run-view/resizeHandle.ts. Keys without a validator are accepted as is.
const VALID: { [K in keyof Preferences]?: (value: unknown) => boolean } = {
  actionRun_enhancedViewEnabled: (v) => typeof v === "boolean",
  actionRun_jobsViewHeight: (v) =>
    v === null || (Number.isSafeInteger(v) && (v as number) >= 180),
  actionRun_hoverFocusEnabled: (v) => typeof v === "boolean",
  actionRun_collapsibleSectionsEnabled: (v) => typeof v === "boolean",
  actionRun_statusGroupingEnabled: (v) => typeof v === "boolean",
  actionRun_searchPosition: (v) => v === "left" || v === "right",
  actionRun_arrowPlacement: (v) => v === "left" || v === "right" || v === "both",
  runList_enabled: (v) => typeof v === "boolean",
  runList_enhancedViewEnabled: (v) => typeof v === "boolean",
  runList_attentionCollapsed: (v) => typeof v === "boolean",
  runList_attentionLatestOnly: (v) => typeof v === "boolean",
  appearance_lightTheme: isThemeId,
  appearance_darkTheme: isThemeId,
};
export const isValidPreference = (key: keyof Preferences, value: unknown) =>
  VALID[key]?.(value) ?? true;

// Two modes. Isolated world: reads/writes storage and answers bridge requests. MAIN world
// (`bridged`): holds a mirror fed by messages and forwards writes. Either way get() is
// synchronous; await `ready` before trusting values on first load.
class Settings {
  private values: Preferences = { ...PREFERENCES };
  private listeners = new Set<Listener>();
  private resolveReady!: () => void;
  readonly ready = new Promise<void>((resolve) => (this.resolveReady = resolve));
  private readonly bridged = !api?.storage?.local;
  baseUrl: string = api?.runtime?.getURL?.("") ?? "";

  constructor() {
    window.addEventListener("message", (event) => this.onMessage(event));
    if (this.bridged) {
      this.post({ type: BRIDGE.request });
      return;
    }
    api!.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      for (const key of Object.keys(changes))
        if (key in this.values) this.apply(key as keyof Preferences, changes[key].newValue as never);
    });
    void this.load();
  }

  // Always resolves `ready`, even when storage fails, so features start with defaults instead of
  // waiting forever. Invalid stored values are skipped, leaving the default.
  private async load(): Promise<void> {
    try {
      const stored = await api!.storage.local.get([
        ...Object.keys(this.values),
        LEGACY_RUN_LIST_KEY,
        LEGACY_RUN_VIEW_KEY,
      ]);
      for (const key of Object.keys(this.values) as (keyof Preferences)[])
        if (key in stored && isValidPreference(key, stored[key]))
          (this.values as any)[key] = stored[key];
      this.migrateRunList(stored[LEGACY_RUN_LIST_KEY]);
      this.migrateRunView(stored[LEGACY_RUN_VIEW_KEY], stored);
    } catch (error) {
      console.warn("Could not load settings", error);
    }
    this.resolveReady();
    this.publish(this.values);
  }

  // One-time migration of V1 run-list settings: only an explicit `false` is carried over (true was
  // the default), then the legacy key is removed so this never runs again.
  private migrateRunList(legacy: unknown): void {
    if (!legacy || typeof legacy !== "object") return;
    const { enabled, enhancedViewEnabled } = legacy as Record<string, unknown>;
    if (enabled === false) void this.set("runList_enabled", false);
    if (enhancedViewEnabled === false)
      void this.set("runList_enhancedViewEnabled", false);
    void api!.storage.local.remove(LEGACY_RUN_LIST_KEY);
  }

  // Same for V1 run-view preferences, but never overwrite a value already saved under the new
  // flat key (`!(key in stored)`), since the user may have changed it after upgrading.
  private migrateRunView(legacy: unknown, stored: Record<string, unknown>): void {
    if (!legacy || typeof legacy !== "object") return;
    const old = legacy as Record<string, unknown>;
    for (const [field, key] of Object.entries(LEGACY_RUN_VIEW_FIELDS))
      if (field in old && !(key in stored)) void this.set(key as keyof Preferences, old[field] as never);
    void api!.storage.local.remove(LEGACY_RUN_VIEW_KEY);
  }

  private publish(values: Partial<Preferences>): void {
    this.post({ type: BRIDGE.values, values, baseUrl: this.baseUrl });
  }

  private post(message: object): void {
    window.postMessage(message, location.origin);
  }

  // Every side also receives its own posts; each mode handles only the other mode's message types,
  // so nothing loops.
  private onMessage(event: MessageEvent): void {
    if (event.source !== window || event.origin !== location.origin) return;
    const { type, key, values, baseUrl } = event.data ?? {};
    if (this.bridged && type === BRIDGE.values) {
      if (baseUrl) this.baseUrl = baseUrl;
      for (const name of Object.keys(values) as (keyof Preferences)[])
        if (name in this.values) this.apply(name, values[name] as never);
      this.resolveReady();
    } else if (!this.bridged && type === BRIDGE.request) {
      this.publish(this.values);
    } else if (!this.bridged && type === BRIDGE.set && key in this.values) {
      void this.set(key, event.data.value);
    }
  }

  get<K extends keyof Preferences>(key: K): Preferences[K] {
    return this.values[key];
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Single entry point for changing in-memory state: validates, skips no-ops (which also stops
  // storage.onChanged echoes of our own writes from re-notifying) and then notifies listeners.
  private apply<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    if (!isValidPreference(key, value) || this.values[key] === value) return;
    this.values[key] = value;
    this.listeners.forEach((listener) => listener(key, value));
  }

  // Applies locally first so the UI reacts immediately, then persists. A save failure is logged
  // and not thrown; the value stays in memory for this page. Then (even if saving failed) the value is
  // published so MAIN-world mirrors update too. In bridge mode the owning side persists it.
  async set<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
    this.apply(key, value);
    if (this.bridged) return this.post({ type: BRIDGE.set, key, value });
    try {
      await api!.storage.local.set({ [key]: value });
    } catch (error) {
      console.warn(`Could not save setting ${key}`, error);
    }
    this.publish({ [key]: value });
  }
}

export type StoreKey = keyof typeof DEFAULTS.STORAGE_KEYS;

/**
 * Nested records kept under their own storage key, optionally suffixed by an id such as the repository.
 * Keys are DEFAULTS.STORAGE_KEYS[name] + id, so per-repository data lives under one key per repo and
 * one repo's writes never rewrite another's. read/write throw if storage is unavailable (the MAIN
 * world); callers run in the isolated world.
 */
class Store {
  private area() {
    if (!api?.storage?.local) throw new Error("Extension storage is unavailable");
    return api.storage.local;
  }

  private key(name: StoreKey, id = ""): string {
    return `${DEFAULTS.STORAGE_KEYS[name]}${id}`;
  }

  async read<T>(name: StoreKey, id?: string): Promise<T | undefined> {
    const key = this.key(name, id);
    return (await this.area().get(key))[key] as T | undefined;
  }

  write<T>(name: StoreKey, id: string | undefined, value: T): Promise<void> {
    return this.area().set({ [this.key(name, id)]: value });
  }

  // Returns a write function whose calls (any key) run strictly in order; errors go to onError without
  // breaking the chain. Direct store.write calls and other writers are not queued.
  writer(onError: (error: unknown) => void) {
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (task: () => Promise<void>) => (queue = queue.then(task).catch(onError));
    const write = <T>(name: StoreKey, id: string | undefined, value: T): Promise<void> =>
      enqueue(() => this.write(name, id, value));
    write.remove = (name: StoreKey, id?: string): Promise<void> =>
      enqueue(() => this.remove(name, id));
    return write;
  }

  remove(name: StoreKey, id?: string): Promise<void> {
    return this.area().remove(this.key(name, id));
  }

  // Fires when this exact key changes in local storage, including from other tabs. The change
  // payload is not passed on; listeners re-read. Returns an unsubscribe; a no-op without storage.
  watch(name: StoreKey, id: string | undefined, listener: () => void): () => void {
    const onChanged = api?.storage?.onChanged;
    if (!onChanged) return () => {};
    const key = this.key(name, id);
    const handler = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && key in changes) listener();
    };
    onChanged.addListener(handler as never);
    return () => onChanged.removeListener(handler as never);
  }
}

// A bundle importing settings in the MAIN world gets the bridged instance; elsewhere the owner.
export const settings = shared("settings", () => new Settings());

// Switches added to GitHub's run "more" menu, positioned right after "Create status badge".
const NATIVE_SWITCHES = [
  { id: "enhanced", label: "Enhanced view", key: "actionRun_enhancedViewEnabled" },
  { id: "sections", label: "Collapsible sections", key: "actionRun_collapsibleSectionsEnabled" },
] as const;

// Clones class names and a few attributes from GitHub's own menu item so it inherits native
// styling and behavior. Label text is set with textContent (never HTML). If the in-memory value
// changed, the page reloads so the run page is rebuilt under the new setting; if it was rejected,
// the button just re-enables. The data attribute on the li marks our items so syncNativeMenu can
// find them and skip re-adding.
function createSwitch(
  nativeItem: Element,
  createBadge: Element,
  { id, label, key }: (typeof NATIVE_SWITCHES)[number],
): HTMLElement {
  const item = document.createElement("li");
  item.className = nativeItem.className;
  item.setAttribute("role", "none");
  for (const name of ["data-targets", "data-view-component"])
    if (nativeItem.hasAttribute(name))
      item.setAttribute(name, nativeItem.getAttribute(name)!);
  item.dataset.ghaRunViewSwitch = id;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${createBadge.className} gha-run-view-switch-button`;
  button.setAttribute("role", "menuitem");
  for (const name of ["tabindex", "data-view-component"])
    if (createBadge.hasAttribute(name))
      button.setAttribute(name, createBadge.getAttribute(name)!);
  const text = document.createElement("span");
  text.textContent = label;
  const track = document.createElement("span");
  track.className = "gha-run-view-switch-track";
  track.setAttribute("aria-hidden", "true");
  track.append(document.createElement("span"));
  button.append(text, track);
  button.addEventListener("click", async () => {
    button.disabled = true;
    const previous = settings.get(key);
    await settings.set(key, !previous);
    if (settings.get(key) !== previous) {
      location.reload();
      return;
    }
    button.disabled = false;
    syncNativeMenu();
  });
  item.append(button);
  return item;
}

// Idempotent: GitHub re-renders the menu lazily on open, so this runs repeatedly and only adds
// switches that are missing, then refreshes aria-pressed. The menu has no stable id, so the
// "Create status badge" item text is used as the anchor.
function syncNativeMenu(): void {
  if (!isRunPage()) return;
  for (const createBadge of document.querySelectorAll(
    'ul[role="menu"] [role="menuitem"]',
  )) {
    if (createBadge.textContent?.trim() !== "Create status badge") continue;
    const nativeItem = createBadge.closest("li.ActionListItem");
    if (!nativeItem) continue;
    let anchor: Element = nativeItem;
    for (const definition of NATIVE_SWITCHES) {
      let item = nativeItem.parentElement?.querySelector<HTMLElement>(
        `:scope > li[data-gha-run-view-switch="${definition.id}"]`,
      );
      if (!item) {
        item = createSwitch(nativeItem, createBadge, definition);
        anchor.after(item);
      }
      item
        .querySelector("button")
        ?.setAttribute("aria-pressed", String(settings.get(definition.key)));
      anchor = item;
    }
  }
}

// Registered once per world via shared() (isolated and MAIN can each register); the data attribute
// check in syncNativeMenu keeps the DOM free of duplicates. The menu is created on demand, hence the
// observer; the rAF flag coalesces bursts of mutations.
shared("nativeMenu", () => {
  let scheduled = false;
  const schedule = () => {
    if (scheduled || !isRunPage()) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncNativeMenu();
    });
  };
  const hasMenu = (node: Node) =>
    node instanceof Element &&
    (node.matches('ul[role="menu"], ul[role="menu"] *') ||
      Boolean(node.querySelector('ul[role="menu"]')));
  settings.ready.then(() => {
    new MutationObserver((records) => {
      if (
        isRunPage() &&
        records.some(({ addedNodes }) => Array.from(addedNodes).some(hasMenu))
      )
        schedule();
    }).observe(document, { childList: true, subtree: true });
    document.addEventListener("turbo:load", schedule);
    schedule();
  });
  return true;
});
/** The single Store instance for this page; see Store for key composition. */
export const store = shared("store", () => new Store());
// Icons are fetched once per name and shared, since many buttons use the same icon. The cache
// holds the promise so concurrent requests do not fetch twice; failures cache null (no retry storm).
const svgCache = new Map<string, Promise<SVGElement | null>>();

// Waits for `ready` because baseUrl (the extension URL) is only known after the bridge replies in
// the MAIN world. The files are listed in web_accessible_resources so the page origin may fetch
// them.
/** Reads a JSON file packaged with the extension (a web_accessible_resource), e.g. dist/themes/index.json. */
export async function fetchExtensionJson(path: string): Promise<unknown> {
  await settings.ready;
  const response = await fetch(`${settings.baseUrl}${path}`);
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response.json();
}

function fetchIcon(name: string): Promise<SVGElement | null> {
  let icon = svgCache.get(name);
  if (!icon) {
    icon = settings.ready
      .then(() => fetch(`${settings.baseUrl}${DEFAULTS.ICONS_PATH}/${name}.svg`))
      .then((response) => response.text())
      .then((text) => parseSVG(text) as unknown as SVGElement)
      .catch((error) => {
        console.warn(`Could not load icon ${name}`, error);
        return null;
      });
    svgCache.set(name, icon);
  }
  return icon;
}

/**
 * Returns an svg right away and fills it with assets/icons/<name>.svg once loaded. Returning it
 * synchronously lets callers insert it immediately; the 16x16 placeholder box avoids layout shift.
 * xmlns declarations are skipped: the element already has the SVG namespace from createElementNS,
 * and copying them would only add plain null-namespace attributes.
 */
export function createIcon(name: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  fetchIcon(name).then((loaded) => {
    if (!loaded) return;
    for (const { name: attribute, value } of Array.from(loaded.attributes))
      if (!attribute.startsWith("xmlns")) svg.setAttribute(attribute, value);
    svg.replaceChildren(...Array.from(loaded.children).map((child) => child.cloneNode(true)));
  });
  return svg;
}

