/**
 * Forces a real page load when navigation crosses route groups, since content scripts inject only
 * on full loads.
 */
import { routeGroup, shouldFullLoad, type RouteGroup } from "../../core/routes";

// Browser calls are injected so the rules can be tested.
export type GuardOptions = {
  loaded: RouteGroup | null;
  assign: (url: string) => void;
  reload: () => void;
  getPathname: () => string;
};

const isPlainLeftClick = (event: MouseEvent) =>
  event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;

// Only a plain left click on a same-origin link in this tab counts; modified clicks, other targets
// and downloads are not in-page navigations.
function destinationOf(event: MouseEvent): URL | null {
  if (!isPlainLeftClick(event) || !(event.target instanceof Element)) return null;
  const anchor = event.target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  const url = new URL(anchor.href, location.href);
  return url.origin === location.origin ? url : null;
}

// Fallback when the Navigation API is missing: we rely on a soft navigation changing the head.
// Waits for <head>, which may not exist yet.
function watchHead(callback: () => void): () => void {
  let observer: MutationObserver;
  const observeHead = (head: HTMLHeadElement) => {
    observer = new MutationObserver(callback);
    observer.observe(head, { childList: true, subtree: true, characterData: true });
  };
  if (document.head) observeHead(document.head);
  else {
    observer = new MutationObserver(() => {
      if (!document.head) return;
      observer.disconnect();
      observeHead(document.head);
    });
    observer.observe(document.documentElement, { childList: true });
  }
  return () => observer.disconnect();
}

/**
 * `loaded` is the route group whose bundles this page was injected with. Only a destination in
 * another supported group triggers a real load. Returns an uninstaller.
 */
export function installNavigationGuard(options: GuardOptions): () => void {
  const { loaded, assign, reload, getPathname } = options;

  const onClick = (event: MouseEvent) => {
    const url = destinationOf(event);
    // Same path (hash or query change) never needs a reload.
    if (!url || url.pathname === getPathname()) return;
    if (!shouldFullLoad(url.pathname, loaded)) return;
    event.preventDefault();
    // Capture phase plus this stops GitHub's own click handling from starting a soft navigation
    // first.
    event.stopImmediatePropagation();
    assign(url.href);
  };

  // Covers visits that are not clicks; cancelling the Turbo visit and loading the page for real
  // replaces it.
  const onBeforeVisit = (event: Event) => {
    const href = (event as CustomEvent<{ url?: string }>).detail?.url;
    if (!href || !shouldFullLoad(new URL(href, location.href).pathname, loaded)) return;
    event.preventDefault();
    assign(href);
  };

  // Back and forward cannot be cancelled and the URL has already changed, so reload to inject the
  // right bundles.
  const onPopState = () => {
    if (shouldFullLoad(getPathname(), loaded)) reload();
  };

  let lastPath = getPathname();
  // Safety net for navigations no click or before-visit event announced (for example script-driven
  // history changes).
  const onSoftNavigation = () => {
    const path = getPathname();
    if (path === lastPath) return;
    lastPath = path;
    if (shouldFullLoad(path, loaded)) reload();
  };

  const navigation = (window as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener("navigatesuccess", onSoftNavigation);
  const stopWatching = navigation ? () => {} : watchHead(onSoftNavigation);

  document.addEventListener("click", onClick, true);
  document.addEventListener("turbo:before-visit", onBeforeVisit, true);
  window.addEventListener("popstate", onPopState);
  return () => {
    navigation?.removeEventListener("navigatesuccess", onSoftNavigation);
    stopWatching();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("turbo:before-visit", onBeforeVisit, true);
    window.removeEventListener("popstate", onPopState);
  };
}
