/**
 * Per-feature update loop: coalesces update requests to one per frame, runs only while active() holds,
 * and with idle waits for load plus an idle callback. Seam: createPageScheduler().
 */
type PageEvent =
  | "turbo:load"
  | "popstate"
  | "resize"
  | "scroll"
  | "hashchange"
  | "pageshow";

export interface PageScheduler {
  schedule(): void;
  start(): void;
  stop(): void;
}

/**
 * relevant: filters mutation records so unrelated page churn does not cost a frame.
 * observe: what to watch; the target defaults to documentElement.
 * events: extra triggers. turbo:load and popstate are also used for re-evaluating `active`.
 * active: gate re-checked on every navigation; listeners and the observer exist only while true.
 */
export interface PageSchedulerOptions {
  update: () => void;
  relevant?: (records: MutationRecord[]) => boolean;
  observe?: MutationObserverInit & { target?: Node };
  idle?: boolean;
  events?: PageEvent[];
  active?: () => boolean;
}

// One path watcher shared by all schedulers in this bundle. navigatesuccess (Navigation API, where
// available) is relied on for Turbo's pushState navigations; the <head> observer is the fallback and
// relies on Turbo replacing <title> on each visit.
const watchers = new Set<() => void>();
let watchedPath = "";
let titleObserver: MutationObserver | undefined;
let navigation: EventTarget | undefined;

// Iterate a snapshot: an active() callback may start or stop schedulers.
function pathChanged(): void {
  if (location.pathname === watchedPath) return;
  watchedPath = location.pathname;
  for (const evaluate of [...watchers]) evaluate();
}

function watchPath(evaluate: () => void): void {
  watchers.add(evaluate);
  if (watchers.size > 1) return;
  watchedPath = location.pathname;
  navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener("navigatesuccess", pathChanged);
  titleObserver = new MutationObserver(pathChanged);
  titleObserver.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

// Last watcher out tears down the shared listeners so a stopped page leaks nothing.
function unwatchPath(evaluate: () => void): void {
  if (!watchers.delete(evaluate) || watchers.size) return;
  navigation?.removeEventListener("navigatesuccess", pathChanged);
  navigation = undefined;
  titleObserver?.disconnect();
  titleObserver = undefined;
}

/**
 * Creates a scheduler. start() is idempotent and begins gating on `active`; schedule() requests an
 * update (ignored if not running or inactive); stop() removes every listener, the observer, the
 * pending frame and the path-watch registration, so the page can be torn down cleanly.
 */
export function createPageScheduler({
  update,
  relevant,
  observe,
  idle = false,
  events = [],
  active: isActive = () => true,
}: PageSchedulerOptions): PageScheduler {
  // running: start() has completed its idle wait. attached: listeners and observer are installed
  // (follows active()). frame: pending rAF id, 0 when none; it doubles as the coalescing flag.
  let running = false;
  let attached = false;
  let frame = 0;
  let observer: MutationObserver | undefined;
  let controller: AbortController | undefined;
  let attachment: AbortController | undefined;

  function schedule(): void {
    if (!running || !attached || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      // Re-check after update(): the update itself may have changed the page so that the feature is
      // no longer active (for example by leaving the route), which must detach immediately.
      update();
      evaluate();
    });
  }

  function attach(): void {
    attached = true;
    attachment = new AbortController();
    const { signal } = attachment;
    const listener = () => schedule();
    for (const name of events) {
      if (name === "turbo:load" || name === "popstate") continue;
      window.addEventListener(name, listener, { signal, passive: name === "scroll" });
    }
    if (!observe) return;
    const { target = document.documentElement, ...init } = observe;
    observer = new MutationObserver((records) => {
      if (!relevant || relevant(records)) schedule();
    });
    observer.observe(target, init);
  }

  function detach(): void {
    attached = false;
    attachment?.abort();
    attachment = undefined;
    observer?.disconnect();
    observer = undefined;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function evaluate(): void {
    if (!controller) return;
    const wanted = isActive();
    if (wanted === attached) return;
    if (!wanted) return detach();
    attach();
    schedule();
  }

  // First run happens synchronously (not via schedule) so the initial DOM is processed at once.
  function activate(): void {
    if (!controller) return;
    running = true;
    if (!isActive()) return;
    if (!attached) attach();
    update();
  }

  // Fallback where requestIdleCallback is missing (e.g. Safari); the timeout bounds the wait.
  function activateWhenIdle(): void {
    if (window.requestIdleCallback)
      window.requestIdleCallback(activate, { timeout: 2000 });
    else setTimeout(activate, 0);
  }

  const reevaluate = () => evaluate();

  function start(): void {
    if (controller) return;
    controller = new AbortController();
    const { signal } = controller;
    watchPath(reevaluate);
    document.addEventListener("turbo:load", reevaluate, { signal });
    window.addEventListener("popstate", reevaluate, { signal });
    const listener = () => schedule();
    for (const name of events) {
      if (name !== "turbo:load" && name !== "popstate") continue;
      const target = name === "turbo:load" ? document : window;
      target.addEventListener(name, listener, { signal });
    }
    // Attach now; schedule() is a no-op until `running`, so nothing updates before the idle gate.
    if (isActive()) attach();
    if (!idle) {
      running = true;
      return;
    }
    if (document.readyState === "complete") activateWhenIdle();
    else window.addEventListener("load", activateWhenIdle, { once: true, signal });
  }

  function stop(): void {
    controller?.abort();
    controller = undefined;
    unwatchPath(reevaluate);
    detach();
    running = false;
  }

  return { schedule, start, stop };
}
