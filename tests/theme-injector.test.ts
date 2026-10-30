import { describe, expect, test } from "@rstest/core";
import { BUILTIN_THEMES } from "../src/ts/features/themes/builtins";
import { generateStylesheet } from "../src/ts/features/themes/generate";
import { createInjector, createThemeController, resolveActive } from "../src/ts/features/themes/injector";
import { validateTheme, type Theme } from "../src/ts/features/themes/theme";

const base = BUILTIN_THEMES[0];
const make = (id: string, name: string): Theme => validateTheme({ ...base, id, name });
const dark = BUILTIN_THEMES.find((t) => t.mode === "dark")!;
const light = BUILTIN_THEMES.find((t) => t.mode === "light")!;

describe("resolveActive", () => {
  test("dark theme in dark slot only", () => {
    const active = resolveActive(null, "dracula", []);
    expect(active.light).toBeUndefined();
    expect(active.dark?.id).toBe("dracula");
  });

  test("mode mismatch is ignored", () => {
    const active = resolveActive("alucard", "alucard", []);
    expect(active.dark).toBeUndefined();
    expect(active.light?.id).toBe("alucard");
  });

  test("unknown id resolves nothing", () => {
    expect(resolveActive("nope", "nope", [])).toEqual({});
  });

  test("custom theme resolves by id", () => {
    const custom = make("custom-one", "Custom One");
    const slot = custom.mode === "light" ? "light" : "dark";
    const active = resolveActive(custom.mode === "light" ? custom.id : null, custom.mode === "dark" ? custom.id : null, [custom]);
    expect(active[slot]?.id).toBe("custom-one");
  });

  test("custom theme cannot shadow a built-in id", () => {
    const shadow = make(dark.id, "Shadow");
    expect(resolveActive(null, dark.id, [shadow]).dark?.name).toBe(dark.name);
  });
});

describe("createInjector", () => {
  const active = { light, dark };

  test("creates one style under documentElement with the stylesheet", () => {
    const injector = createInjector(document);
    injector.apply(active);
    const styles = document.querySelectorAll("style#gha-themes");
    expect(styles.length).toBe(1);
    expect(styles[0].parentNode).toBe(document.documentElement);
    expect(styles[0].textContent).toBe(generateStylesheet(active));
    injector.dispose();
  });

  test("identical apply keeps the same element", () => {
    const injector = createInjector(document);
    injector.apply(active);
    const first = document.getElementById("gha-themes");
    injector.apply(active);
    expect(document.getElementById("gha-themes")).toBe(first);
    injector.dispose();
  });

  test("empty apply and dispose remove the element", () => {
    const injector = createInjector(document);
    injector.apply(active);
    injector.apply({});
    expect(document.getElementById("gha-themes")).toBeNull();
    injector.apply(active);
    injector.dispose();
    expect(document.getElementById("gha-themes")).toBeNull();
  });

  test("ensure re-adds a removed element", () => {
    const injector = createInjector(document);
    injector.apply(active);
    document.getElementById("gha-themes")!.remove();
    injector.ensure();
    expect(document.querySelectorAll("style#gha-themes").length).toBe(1);
    injector.dispose();
  });

  test("hostile theme name never reaches the stylesheet", () => {
    const hostile = 'a"}</style><script>x';
    const theme = make("hostile", hostile);
    const injector = createInjector(document);
    injector.apply({ [theme.mode]: theme });
    const text = document.getElementById("gha-themes")?.textContent ?? "";
    expect(text).not.toContain(hostile);
    expect(text).not.toContain("</style>");
    expect(text).not.toContain("<script");
    injector.dispose();
  });
});

describe("createInjector without documentElement", () => {
  test("ensure and apply do not throw", () => {
    const injector = createInjector({ documentElement: null } as unknown as Document);
    expect(() => injector.ensure()).not.toThrow();
    expect(() => injector.apply({ dark })).not.toThrow();
  });
});

describe("createThemeController", () => {
  const style = () => document.getElementById("gha-themes")?.textContent ?? "";
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
    return { promise, resolve, reject };
  };
  const setup = (loads: Array<Promise<Theme[]>>, ids = { light: null as string | null, dark: dark.id as string | null }) => {
    const handlers: { ids?: () => void; custom?: () => void } = {};
    const queue = [...loads];
    const controller = createThemeController({
      doc: document,
      ready: Promise.resolve(),
      readIds: () => ids,
      loadCustom: () => queue.shift() ?? Promise.resolve([]),
      watchCustom: (listener) => (handlers.custom = listener),
      onIdsChange: (listener) => (handlers.ids = listener),
    });
    return { controller, handlers, ids };
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const clean = () => document.getElementById("gha-themes")?.remove();

  test("built-in theme paints before the custom load resolves", async () => {
    clean();
    const load = deferred<Theme[]>();
    const { controller } = setup([load.promise]);
    const started = controller.start();
    await flush();
    expect(style()).toBe(generateStylesheet({ dark }));
    load.resolve([]);
    await started;
    clean();
  });

  test("a rejecting load keeps the built-in theme and does not throw", async () => {
    clean();
    const { controller } = setup([Promise.reject(new Error("boom"))]);
    await expect(controller.start()).resolves.toBeUndefined();
    expect(style()).toBe(generateStylesheet({ dark }));
    clean();
  });

  test("a stale reload cannot overwrite a newer one", async () => {
    clean();
    const custom = make("stale-custom", "Stale");
    const customDark = { ...custom, mode: "dark" as const };
    const first = deferred<Theme[]>();
    const second = deferred<Theme[]>();
    const { controller, handlers, ids } = setup([Promise.resolve([]), first.promise, second.promise]);
    await controller.start();
    ids.dark = "stale-custom";
    handlers.custom!();
    handlers.custom!();
    second.resolve([customDark]);
    await flush();
    first.resolve([]);
    await flush();
    expect(style()).toBe(generateStylesheet({ dark: customDark }));
    clean();
  });

  test("getCustom exposes the loaded themes and subscribers hear every successful load", async () => {
    clean();
    const mine = make("custom-one", "One");
    const failed = Promise.reject(new Error("boom"));
    failed.catch(() => {});
    const { controller } = setup([Promise.resolve([mine]), failed, Promise.resolve([])]);
    let heard = 0;
    controller.onCustomChange(() => heard++);
    expect(controller.getCustom()).toEqual([]);
    await controller.start();
    expect(controller.getCustom()).toEqual([mine]);
    expect(heard).toBe(1);
    await controller.reload();
    expect(controller.getCustom()).toEqual([mine]);
    expect(heard).toBe(1);
    await controller.reload();
    expect(controller.getCustom()).toEqual([]);
    expect(heard).toBe(2);
    clean();
  });

  test("listeners are registered before ready resolves", async () => {
    clean();
    const load = deferred<Theme[]>();
    const { controller, handlers, ids } = setup([load.promise]);
    const started = controller.start();
    expect(handlers.ids).toBeDefined();
    expect(handlers.custom).toBeDefined();
    ids.dark = null;
    ids.light = light.id;
    handlers.ids!();
    await flush();
    expect(style()).toBe(generateStylesheet({ light }));
    load.resolve([]);
    await started;
    clean();
  });
});
