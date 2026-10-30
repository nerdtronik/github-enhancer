import { expect, test } from "@rstest/core";
import { routeGroup, shouldFullLoad, type RouteGroup } from "../src/ts/core/routes";
import { installNavigationGuard } from "../src/ts/features/navigation-guard/guard";

test("routeGroup maps routes to groups", () => {
  expect(routeGroup("/o/r/actions")).toBe("actions");
  expect(routeGroup("/o/r/actions/runs/1")).toBe("actions");
  expect(routeGroup("/o/r/pull/3")).toBe("pull");
  expect(routeGroup("/o/r/pull/3/files")).toBe("pull");
  expect(routeGroup("/o/r")).toBeNull();
  expect(routeGroup("/o/r/issues/3")).toBeNull();
});

test("shouldFullLoad only when entering a different non-null group", () => {
  expect(shouldFullLoad("/o/r/actions/runs/1", null)).toBe(true);
  expect(shouldFullLoad("/o/r/actions", "actions")).toBe(false);
  expect(shouldFullLoad("/o/r/pull/3", "actions")).toBe(true);
  expect(shouldFullLoad("/o/r", "actions")).toBe(false);
});

function setup(loaded: RouteGroup | null, pathname = "/o/r") {
  const assign = rstestAssign();
  const reload = rstestAssign();
  const dispose = installNavigationGuard({
    loaded,
    assign: assign.fn,
    reload: reload.fn,
    getPathname: () => pathname,
  });
  return { assign, reload, dispose };
}

function rstestAssign() {
  const calls: string[] = [];
  return { calls, fn: (url?: string) => void calls.push(url ?? "") };
}

function click(href: string, init: MouseEventInit = {}, attrs: Record<string, string> = {}) {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  for (const [key, value] of Object.entries(attrs)) anchor.setAttribute(key, value);
  document.body.append(anchor);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  anchor.dispatchEvent(event);
  anchor.remove();
  return event;
}

test("plain click into a new group is prevented and assigned", () => {
  const { assign, dispose } = setup(null);
  const event = click("/o/r/actions");
  expect(event.defaultPrevented).toBe(true);
  expect(assign.calls).toEqual(["https://github.com/o/r/actions"]);
  dispose();
});

test("clicks that must be left alone", () => {
  const { assign, dispose } = setup(null);
  const cases = [
    click("/o/r/actions", { ctrlKey: true }),
    click("/o/r/actions", { metaKey: true }),
    click("/o/r/actions", { button: 1 }),
    click("/o/r/actions", {}, { target: "_blank" }),
    click("/o/r/actions", {}, { download: "" }),
    click("https://example.com/o/r/actions"),
    click("/o/r"),
    click("/o/r#top"),
  ];
  for (const event of cases) expect(event.defaultPrevented).toBe(false);
  expect(assign.calls).toEqual([]);
  dispose();
});

test("same-group click is left alone", () => {
  const { assign, dispose } = setup("actions", "/o/r/actions");
  expect(click("/o/r/actions/runs/1").defaultPrevented).toBe(false);
  expect(assign.calls).toEqual([]);
  dispose();
});

test("turbo:before-visit into a new group is prevented and assigned", () => {
  const { assign, dispose } = setup(null);
  const event = new CustomEvent("turbo:before-visit", {
    cancelable: true,
    detail: { url: "https://github.com/o/r/pull/3" },
  });
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(assign.calls).toEqual(["https://github.com/o/r/pull/3"]);
  dispose();
});

test("turbo:before-visit within the loaded group is ignored", () => {
  const { assign, dispose } = setup("pull", "/o/r/pull/3");
  const event = new CustomEvent("turbo:before-visit", {
    cancelable: true,
    detail: { url: "https://github.com/o/r/pull/4" },
  });
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(assign.calls).toEqual([]);
  dispose();
});

test("popstate reloads only when entering a new group", () => {
  const into = setup(null, "/o/r/actions");
  window.dispatchEvent(new Event("popstate"));
  expect(into.reload.calls).toHaveLength(1);
  into.dispose();

  const out = setup("actions", "/o/r");
  window.dispatchEvent(new Event("popstate"));
  expect(out.reload.calls).toHaveLength(0);
  out.dispose();
});

async function softNavigate(path: string) {
  history.pushState({}, "", path);
  document.title = `t${Math.random()}`;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setupLive(loaded: RouteGroup | null) {
  const reload = rstestAssign();
  const dispose = installNavigationGuard({
    loaded,
    assign: () => {},
    reload: reload.fn,
    getPathname: () => location.pathname,
  });
  return { reload, dispose };
}

test("pushState into a new group followed by a head mutation reloads once", async () => {
  history.pushState({}, "", "/o/r/actions");
  const { reload, dispose } = setupLive("actions");
  await softNavigate("/o/r/pull/3");
  expect(reload.calls).toHaveLength(1);
  dispose();
});

test("pushState within the group or to a non-group path does not reload", async () => {
  history.pushState({}, "", "/o/r/actions");
  const { reload, dispose } = setupLive("actions");
  await softNavigate("/o/r/actions/runs/1");
  await softNavigate("/o/r");
  expect(reload.calls).toHaveLength(0);
  dispose();
});

test("repeated head mutations with an unchanged path do not reload", async () => {
  history.pushState({}, "", "/o/r");
  const { reload, dispose } = setupLive(null);
  await softNavigate("/o/r");
  await softNavigate("/o/r");
  expect(reload.calls).toHaveLength(0);
  dispose();
});

test("pull files and changes pages classify as pull", () => {
  expect(routeGroup("/o/r/pull/3/changes")).toBe("pull");
  expect(routeGroup("/o/r/pull/3/files")).toBe("pull");
});

function spyObservers() {
  const Original = globalThis.MutationObserver;
  const observed: { target: Node; options?: MutationObserverInit }[] = [];
  globalThis.MutationObserver = class extends Original {
    observe(target: Node, options?: MutationObserverInit) {
      observed.push({ target, options });
      super.observe(target, options);
    }
  };
  return { observed, restore: () => void (globalThis.MutationObserver = Original) };
}

test("with the Navigation API only navigatesuccess is used", () => {
  const navigation = new EventTarget();
  (window as any).navigation = navigation;
  const spy = spyObservers();
  history.pushState({}, "", "/o/r/actions");
  const { reload, dispose } = setupLive("actions");
  history.pushState({}, "", "/o/r/pull/3");
  navigation.dispatchEvent(new Event("navigatesuccess"));
  expect(spy.observed).toHaveLength(0);
  expect(reload.calls).toHaveLength(1);
  dispose();
  spy.restore();
  delete (window as any).navigation;
});

test("without the Navigation API a missing head is awaited, then observed", async () => {
  delete (window as any).navigation;
  const head = document.head;
  head.remove();
  const spy = spyObservers();
  history.pushState({}, "", "/o/r/actions");
  const { reload, dispose } = setupLive("actions");
  expect(spy.observed).toHaveLength(1);
  expect(spy.observed[0].target).toBe(document.documentElement);
  expect(spy.observed[0].options).toEqual({ childList: true });
  document.documentElement.prepend(head);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(spy.observed[1].target).toBe(head);
  await softNavigate("/o/r/pull/3");
  expect(reload.calls).toHaveLength(1);
  dispose();
  spy.restore();
});
