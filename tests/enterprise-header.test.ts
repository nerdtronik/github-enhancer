import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import {
  findEnterpriseRow,
  isComputedColor,
  isRelevantMutation,
  OBSERVE_INIT,
  refreshEnterpriseBackground,
  resetDiagnostics,
  syncEnterpriseTab,
  UNSAFE,
} from "../src/ts/features/enterprise-header/enterpriseRow";
import { watchThemeChanges } from "../src/ts/features/enterprise-header/themeWatch";

const fixture = readFileSync(join(__dirname, "fixtures/enterprise-row.html"), "utf8");
const css = readFileSync(join(__dirname, "../src/css/enterprise-header.css"), "utf8");
const MAIN = `<div data-row="main"><svg class="octicon octicon-mark-github"></svg><nav><a href="/">Home</a></nav><input type="search"></div>`;
const LABEL = 'aria-label="Global navigation menu"';
const GLOBE = '<svg class="octicon octicon-globe" data-component="Octicon" width="16" height="16"></svg>';
const FULL_TEXT = "GitHub Enterprise Users managed by Wolters Kluwer";

const mount = (inner: string, attrs = LABEL) => {
  document.body.innerHTML = `<header ${attrs}>${inner}</header>`;
  return document.querySelector("header")!;
};
const flatRow = (inner: string) => `<div data-row="banner">${GLOBE}${inner}</div>`;
const banner = () => document.querySelector<HTMLElement>(".border-bottom")!;
const tabs = () => [...document.querySelectorAll<HTMLElement>("[data-gha-enterprise-tab]")];
const marked = () => [...document.querySelectorAll("[data-gha-enterprise-row]")];
const expectUntouched = () => {
  expect(tabs()).toHaveLength(0);
  expect(marked()).toHaveLength(0);
  expect(document.querySelector("[data-gha-enterprise-host]")).toBeNull();
  expect(document.querySelector("[data-gha-enterprise-inline]")).toBeNull();
  for (const element of document.querySelectorAll<HTMLElement>("[style]"))
    expect(element.style.getPropertyValue("display")).not.toBe("none");
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findEnterpriseRow", () => {
  test("finds the banner row when it is a direct child of the header", () => {
    mount(fixture + MAIN);
    const found = findEnterpriseRow(document);
    expect(found?.row).toBe(banner());
    expect(found?.header).toBe(document.querySelector("header"));
    expect(found?.globe).toBe(banner().querySelector("svg.octicon-globe"));
    expect(found?.text).toBe(FULL_TEXT);
    expect(found?.link).toBe("/enterprises/wolterskluwer");
  });

  test("picks the banner row, not a wrapper that also holds the main row", () => {
    mount(`<div data-wrapper>${fixture}${MAIN}</div>`);
    expect(findEnterpriseRow(document)?.row).toBe(banner());
  });

  test("prefers the labelled header but accepts a plain one", () => {
    mount(fixture + MAIN, "");
    expect(findEnterpriseRow(document)?.row).toBe(banner());
  });

  test("returns nothing without a globe", () => {
    mount(MAIN);
    expect(findEnterpriseRow(document)).toBeUndefined();
  });
});

describe("syncEnterpriseTab", () => {
  test("hides the row and shows a compact tab as the last header child", () => {
    const header = mount(fixture + MAIN);
    syncEnterpriseTab(document);
    expect(banner().hasAttribute("data-gha-enterprise-row")).toBe(true);
    expect(marked()).toHaveLength(1);
    expect(tabs()).toHaveLength(1);
    const tab = tabs()[0];
    expect(header.lastElementChild).toBe(tab);
    expect(tab.tagName).toBe("SPAN");
    expect(tab.classList.contains("gha-enterprise-tab")).toBe(true);
    expect(tab.getAttribute("title")).toBe(FULL_TEXT);
    const svg = tab.querySelector("svg.octicon-globe");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(tab.querySelector(".gha-enterprise-text")?.textContent).toBe("GitHub Enterprise · Users managed by Wolters Kluwer");
    const links = tab.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].classList.contains("gha-enterprise-link")).toBe(true);
    expect(links[0].getAttribute("href")).toBe("https://github.com/enterprises/wolterskluwer");
    expect(links[0].textContent).toBe("Wolters Kluwer");
    expect(header.hasAttribute("data-gha-enterprise-host")).toBe(true);
  });

  test("works when the row is wrapped together with the main row", () => {
    const header = mount(`<div data-wrapper>${fixture}${MAIN}</div>`);
    syncEnterpriseTab(document);
    expect(marked()).toEqual([banner()]);
    expect(header.querySelector("[data-wrapper]")?.hasAttribute("data-gha-enterprise-row")).toBe(false);
    expect(header.lastElementChild).toBe(tabs()[0]);
  });

  test("handles the React-rendered header without a label", () => {
    document.body.innerHTML = `<div><div></div><div><react-partial></react-partial><react-partial><div><header><div>${fixture}</div>${MAIN}</header></div></react-partial></div></div>`;
    const header = document.querySelector("header")!;
    const [first, main] = [...header.children];
    syncEnterpriseTab(document);
    expect(marked()).toEqual([first]);
    expect(main.hasAttribute("data-gha-enterprise-row")).toBe(false);
    expect(tabs()).toHaveLength(1);
    expect(header.lastElementChild).toBe(tabs()[0]);
    expect(main.outerHTML).toBe(`${MAIN}`);
  });

  test("re-creates the tab exactly once after React drops it", () => {
    const header = mount(fixture + MAIN);
    syncEnterpriseTab(document);
    tabs()[0].remove();
    syncEnterpriseTab(document);
    syncEnterpriseTab(document);
    expect(tabs()).toHaveLength(1);
    expect(header.lastElementChild).toBe(tabs()[0]);
  });

  test("does not override an already positioned header", () => {
    const header = mount(fixture + MAIN, `${LABEL} style="position: sticky"`);
    syncEnterpriseTab(document);
    expect(header.hasAttribute("data-gha-enterprise-host")).toBe(false);
    expect(tabs()).toHaveLength(1);
  });

  test("is idempotent", () => {
    const header = mount(fixture + MAIN);
    syncEnterpriseTab(document);
    const tab = tabs()[0];
    const html = header.innerHTML;
    syncEnterpriseTab(document);
    expect(tabs()).toEqual([tab]);
    expect(header.innerHTML).toBe(html);
    expect(banner().hasAttribute("data-gha-enterprise-row")).toBe(true);
  });

  test("updates the tab in place when the text changes", () => {
    mount(fixture + MAIN);
    syncEnterpriseTab(document);
    const tab = tabs()[0];
    banner().querySelector("a")!.textContent = "Another Org";
    syncEnterpriseTab(document);
    expect(tabs()).toEqual([tab]);
    expect(tab.querySelector("a")?.textContent).toBe("Another Org");
    expect(tab.getAttribute("title")).toBe("GitHub Enterprise Users managed by Another Org");
  });

  test("re-hides a row that was replaced by a fresh copy", () => {
    mount(fixture + MAIN);
    syncEnterpriseTab(document);
    const tab = tabs()[0];
    const fresh = banner().cloneNode(true) as HTMLElement;
    fresh.removeAttribute("data-gha-enterprise-row");
    banner().replaceWith(fresh);
    syncEnterpriseTab(document);
    expect(fresh.hasAttribute("data-gha-enterprise-row")).toBe(true);
    expect(tabs()).toEqual([tab]);
  });

  test("restores everything when the row disappears", () => {
    const header = mount(fixture + MAIN);
    syncEnterpriseTab(document);
    banner().remove();
    syncEnterpriseTab(document);
    expectUntouched();
    expect(header.isConnected).toBe(true);
  });

  test("restores everything after navigating to a page without the row", () => {
    mount(fixture + MAIN);
    syncEnterpriseTab(document);
    const row = banner();
    row.remove();
    document.body.append(row);
    document.querySelector("header")!.innerHTML = MAIN;
    syncEnterpriseTab(document);
    expect(tabs()).toHaveLength(0);
    expect(row.hasAttribute("data-gha-enterprise-row")).toBe(false);
  });

  test("does nothing when the row text is longer than 120 characters", () => {
    mount(flatRow(`<span>${"x".repeat(121)}</span>`) + MAIN);
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test.each([
    ["an input", '<input type="text">'],
    ["a textarea", "<textarea></textarea>"],
    ["a nav", "<nav></nav>"],
    ["a search role", '<div role="search"></div>'],
    ["the GitHub mark", '<svg class="octicon octicon-mark-github"></svg>'],
    ["a button", "<button>x</button>"],
    ["two links", '<a href="/a">a</a><a href="/b">b</a>'],
  ])("does nothing when the row holds %s", (_, extra) => {
    mount(flatRow(`<span>GitHub Enterprise</span>${extra}`) + MAIN);
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test.each([
    ["a button in the second segment", fixture.replace("Users managed by<!--", "Users managed by<button>x</button><!--")],
    ["a second link in the second segment", fixture.replace("Users managed by<!--", 'Users managed by<a href="/x">x</a><!--')],
    ["total text over 120 characters", fixture.replace("Users managed by<!--", `${"z".repeat(110)}<!--`)],
  ])("never half-hides a row with %s", (_, row) => {
    mount(row + MAIN);
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test("never half-hides a row wrapped with the main row", () => {
    const row = fixture.replace("Users managed by<!--", "Users managed by<button>x</button><!--");
    mount(`<div>${row}${MAIN}</div>`);
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test("leaves a wrapper with a menu next to the row untouched", () => {
    mount(`<div>${fixture}<div><details><summary><img class="avatar" alt=""></summary></details></div></div>`);
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test("the unsafe list matches nothing in the real row", () => {
    document.body.innerHTML = fixture;
    expect(banner().matches(UNSAFE)).toBe(false);
    expect(banner().querySelectorAll(UNSAFE)).toHaveLength(0);
  });

  test("ignores a globe inside page content", () => {
    document.body.innerHTML = `<header ${LABEL}>${MAIN}</header><main><header><div>${GLOBE}<span>Public</span></div><h1>Repo</h1></header></main>`;
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test.each([["article"], ["section"]])("ignores a header inside an %s", (tag) => {
    document.body.innerHTML = `<${tag}><header><div>${GLOBE}<span>Public</span></div><h1>Repo</h1></header></${tag}>`;
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test("clones only allowlisted globe markup", () => {
    mount(`<div><svg class="octicon octicon-globe" viewBox="0 0 16 16"><path d="M0 0"></path></svg><span>GitHub Enterprise</span></div>${MAIN}`);
    const globe = document.querySelector("svg.octicon-globe")!;
    const ns = "http://www.w3.org/2000/svg";
    globe.setAttribute("onload", "void 0");
    globe.querySelector("path")!.setAttribute("onclick", "void 0");
    globe.append(document.createElementNS(ns, "script"), document.createElementNS(ns, "foreignObject"));
    syncEnterpriseTab(document);
    const icon = tabs()[0].querySelector("svg")!;
    expect(icon.hasAttribute("onload")).toBe(false);
    expect(icon.querySelector("script")).toBeNull();
    expect(icon.querySelector("foreignObject, foreignobject")).toBeNull();
    expect(icon.querySelector("path")?.getAttribute("d")).toBe("M0 0");
    expect(icon.querySelector("path")?.hasAttribute("onclick")).toBe(false);
    expect(icon.getAttribute("class")).toBe("octicon octicon-globe");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  test("does nothing when no ancestor of the globe passes the checks", () => {
    mount(`<div>${GLOBE}<span>GitHub Enterprise</span>${MAIN}</div>`);
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test("does nothing when the row is the only header content", () => {
    mount(fixture);
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test("does nothing on a page without the globe", () => {
    mount(MAIN);
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test("a same-origin link becomes an anchor", () => {
    mount(flatRow('<span>GitHub Enterprise</span><a href="/enterprises/acme">Acme</a>') + MAIN);
    syncEnterpriseTab(document);
    expect(tabs()[0].querySelector("a")?.getAttribute("href")).toBe("https://github.com/enterprises/acme");
  });

  test.each([["javascript:alert(1)"], ["https://evil.example/x"], ["http://github.com/x"]])(
    "an unsafe link %s becomes plain text",
    (href) => {
      mount(flatRow(`<span>GitHub Enterprise</span><a href="${href}">Acme</a>`) + MAIN);
      syncEnterpriseTab(document);
      const tab = tabs()[0];
      expect(tab.querySelector("a")).toBeNull();
      expect(tab.textContent).toContain("Acme");
    },
  );

  test("hostile text renders literally", () => {
    mount(flatRow("<span>&lt;img src=x onerror=alert(1)&gt;</span>") + MAIN);
    syncEnterpriseTab(document);
    const tab = tabs()[0];
    expect(tab.querySelector("img")).toBeNull();
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(tab.innerHTML).toContain("&lt;img");
    expect(tab.getAttribute("title")).toBe("<img src=x onerror=alert(1)>");
  });

  test("truncates long segments", () => {
    mount(flatRow(`<span>${"y".repeat(50)}</span>`) + MAIN);
    syncEnterpriseTab(document);
    expect(tabs()[0].querySelector(".gha-enterprise-text")?.textContent).toBe(`${"y".repeat(40)}…`);
  });

  test("never throws on unexpected documents", () => {
    document.body.innerHTML = "<div>no header</div>";
    expect(() => syncEnterpriseTab(document)).not.toThrow();
    document.body.innerHTML = `<div>${GLOBE}<span>GitHub Enterprise</span></div>`;
    expect(() => syncEnterpriseTab(document)).not.toThrow();
    expectUntouched();
  });
});

describe("hiding robustness", () => {
  const stubDisplay = (display: string) => {
    const original = window.getComputedStyle;
    window.getComputedStyle = ((element: Element) => {
      const style = original.call(window, element);
      if (!element.hasAttribute("data-gha-enterprise-row")) return style;
      return { display, position: style.position, backgroundColor: style.backgroundColor } as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle;
    return () => (window.getComputedStyle = original);
  };

  test("every header with the row gets its own hidden row and one tab", () => {
    document.body.innerHTML = `<header ${LABEL}>${fixture}${MAIN}</header><div><header class="sticky">${fixture}${MAIN}</header></div>`;
    syncEnterpriseTab(document);
    syncEnterpriseTab(document);
    const headers = [...document.querySelectorAll("header")];
    for (const header of headers) {
      expect(header.querySelectorAll(":scope > [data-gha-enterprise-tab]")).toHaveLength(1);
      expect(header.querySelector(".border-bottom")?.hasAttribute("data-gha-enterprise-row")).toBe(true);
      expect(header.lastElementChild?.hasAttribute("data-gha-enterprise-tab")).toBe(true);
    }
    expect(tabs()).toHaveLength(2);
    headers[1].querySelector(".border-bottom")!.remove();
    syncEnterpriseTab(document);
    expect(tabs()).toHaveLength(1);
    expect(headers[1].querySelector("[data-gha-enterprise-tab]")).toBeNull();
    for (const header of headers) header.remove();
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test("falls back to an inline display:none when the stylesheet loses", () => {
    mount(fixture + MAIN);
    const restore = stubDisplay("flex");
    try {
      syncEnterpriseTab(document);
    } finally {
      restore();
    }
    expect(banner().style.getPropertyValue("display")).toBe("none");
    expect(banner().style.getPropertyPriority("display")).toBe("important");
    expect(banner().hasAttribute("data-gha-enterprise-inline")).toBe(true);
  });

  test("no inline fallback when the stylesheet already hides the row", () => {
    mount(fixture + MAIN);
    const restore = stubDisplay("none");
    try {
      syncEnterpriseTab(document);
    } finally {
      restore();
    }
    expect(banner().hasAttribute("data-gha-enterprise-row")).toBe(true);
    expect(banner().style.getPropertyValue("display")).toBe("");
    expect(banner().hasAttribute("data-gha-enterprise-inline")).toBe(false);
  });

  test("cleanup removes the inline fallback", () => {
    mount(fixture + MAIN);
    syncEnterpriseTab(document);
    const row = banner();
    expect(row.style.getPropertyValue("display")).toBe("none");
    document.querySelector("header")!.innerHTML = MAIN;
    document.body.append(row);
    syncEnterpriseTab(document);
    expect(row.style.getPropertyValue("display")).toBe("");
    expectUntouched();
  });

  test("logs why nothing was hidden, once per reason", () => {
    resetDiagnostics();
    const original = console.debug;
    const calls: unknown[][] = [];
    console.debug = (...args: unknown[]) => void calls.push(args);
    try {
      mount(flatRow("<span>GitHub Enterprise</span><button>x</button>") + MAIN);
      syncEnterpriseTab(document);
      syncEnterpriseTab(document);
      mount(fixture);
      syncEnterpriseTab(document);
      mount(MAIN);
      syncEnterpriseTab(document);
    } finally {
      console.debug = original;
    }
    expect(calls.map((args) => args[1])).toEqual([
      "no ancestor of the globe passes the safety checks",
      "the row is the only header content",
    ]);
    expect(calls[0][0]).toBe("Enterprise header:");
  });

  test.each([
    [
      "a globe link inside the main row",
      `<header><div><svg class="octicon octicon-mark-github"></svg><a href="/settings/lang">${GLOBE}English</a><nav><a href="/">Home</a></nav></div></header>`,
    ],
    [
      "a globe span inside a second header's main row",
      `<header ${LABEL}>${MAIN}</header><header><div><svg class="octicon octicon-mark-github"></svg><span>${GLOBE} Public</span><a href="/a">a</a><a href="/b">b</a></div></header>`,
    ],
    [
      "a globe span directly in the header",
      `<header><span>${GLOBE} Public</span>${MAIN}</header>`,
    ],
  ])("leaves %s untouched and logs once", (_, html) => {
    resetDiagnostics();
    const original = console.debug;
    const calls: unknown[][] = [];
    console.debug = (...args: unknown[]) => void calls.push(args);
    try {
      document.body.innerHTML = html;
      syncEnterpriseTab(document);
      syncEnterpriseTab(document);
    } finally {
      console.debug = original;
    }
    expectUntouched();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("Enterprise header:");
  });

  test("a row next to the main row must come first", () => {
    mount(`<div>${MAIN}${fixture}</div>`);
    syncEnterpriseTab(document);
    expectUntouched();
  });

  test("a globe button before the banner does not hide the banner from detection", () => {
    const header = mount(`<button type="button">${GLOBE}</button>${fixture}${MAIN}`);
    syncEnterpriseTab(document);
    expect(marked()).toEqual([banner()]);
    expect(header.querySelector("button")?.hasAttribute("data-gha-enterprise-row")).toBe(false);
    expect(header.querySelector("button")?.isConnected).toBe(true);
    expect(tabs()).toHaveLength(1);
  });

  test("stays silent when the row is hidden", () => {
    resetDiagnostics();
    const original = console.debug;
    let count = 0;
    console.debug = () => void count++;
    try {
      mount(fixture + MAIN);
      syncEnterpriseTab(document);
    } finally {
      console.debug = original;
    }
    expect(count).toBe(0);
  });
});

describe("tab background", () => {
  const BG = "--gha-enterprise-bg";
  const FALLBACK = "gha-enterprise-tab--fallback-bg";
  const tab = () => tabs()[0];
  const styledMain = (style: string) => MAIN.replace('data-row="main"', `data-row="main" style="${style}"`);

  test("a painted header is inherited, not copied", () => {
    mount(fixture + MAIN, `${LABEL} style="background-color: rgb(1, 2, 3)"`);
    syncEnterpriseTab(document);
    expect(tab().style.getPropertyValue(BG)).toBe("");
    expect(tab().classList.contains(FALLBACK)).toBe(false);
  });

  test("a transparent header copies the first painted descendant outside the row", () => {
    mount(fixture + styledMain("background-color: rgb(21, 27, 35)"));
    syncEnterpriseTab(document);
    expect(tab().style.getPropertyValue(BG)).toBe("rgb(21, 27, 35)");
    expect(tab().classList.contains(FALLBACK)).toBe(false);
  });

  test("the hidden row and hidden elements are never used as the source", () => {
    const row = fixture.replace('class="tmp-px-3', 'style="background-color: rgb(9, 9, 9)" class="tmp-px-3');
    mount(`${row}<div style="display: none; background-color: rgb(8, 8, 8)"></div>${MAIN}`);
    syncEnterpriseTab(document);
    expect(tab().style.getPropertyValue(BG)).toBe("");
    expect(tab().classList.contains(FALLBACK)).toBe(true);
  });

  test("a fully transparent header falls back to the default background", () => {
    mount(fixture + MAIN);
    syncEnterpriseTab(document);
    expect(tab().style.getPropertyValue(BG)).toBe("");
    expect(tab().classList.contains(FALLBACK)).toBe(true);
  });

  test("a transparent rgba descendant is skipped", () => {
    mount(fixture + styledMain("background-color: rgba(0, 0, 0, 0)"));
    syncEnterpriseTab(document);
    expect(tab().classList.contains(FALLBACK)).toBe(true);
  });

  test("updates the copied background in place and stays idempotent", () => {
    const header = mount(fixture + styledMain("background-color: rgb(21, 27, 35)"));
    syncEnterpriseTab(document);
    const first = tab();
    const html = header.innerHTML;
    syncEnterpriseTab(document);
    expect(header.innerHTML).toBe(html);
    header.querySelector<HTMLElement>('[data-row="main"]')!.style.backgroundColor = "rgb(1, 1, 1)";
    syncEnterpriseTab(document);
    expect(tabs()).toEqual([first]);
    expect(first.style.getPropertyValue(BG)).toBe("rgb(1, 1, 1)");
    header.querySelector<HTMLElement>('[data-row="main"]')!.style.backgroundColor = "";
    syncEnterpriseTab(document);
    expect(first.style.getPropertyValue(BG)).toBe("");
    expect(first.classList.contains(FALLBACK)).toBe(true);
  });

  test("never copies a value the validator rejects", () => {
    mount(fixture + MAIN);
    const original = window.getComputedStyle;
    window.getComputedStyle = ((element: Element) => {
      const style = original.call(window, element);
      if (!(element as HTMLElement).matches('[data-row="main"]')) return style;
      return { ...style, display: "block", position: style.position, backgroundColor: "red; } body{display:none" } as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle;
    try {
      syncEnterpriseTab(document);
    } finally {
      window.getComputedStyle = original;
    }
    expect(tab().style.getPropertyValue(BG)).toBe("");
    expect(tab().classList.contains(FALLBACK)).toBe(true);
  });

  test.each([
    ["rgb(21, 27, 35)", true],
    ["rgba(0, 0, 0, 0.5)", true],
    ["rgb(1 2 3 / 50%)", true],
    ["rgba(255, 255, 255, 1)", true],
    ["red; } body{display:none", false],
    ["red", false],
    ["var(--x)", false],
    ["rgb(1, 2, 3); color: red", false],
    ["url(x)", false],
    ["", false],
  ])("isComputedColor(%s) is %s", (value, expected) => {
    expect(isComputedColor(value)).toBe(expected);
  });
});

describe("theme changes", () => {
  const BG = "--gha-enterprise-bg";
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const main = () => document.querySelector<HTMLElement>('[data-row="main"]')!;
  const tab = () => tabs()[0];
  let mainBackground = "rgb(21, 27, 35)";
  let restoreStyle = () => {};
  let restoreMedia = () => {};
  let stop = () => {};

  const stubMainBackground = () => {
    const original = window.getComputedStyle;
    window.getComputedStyle = ((element: Element) => {
      const style = original.call(window, element);
      if (element !== main()) return style;
      return { display: "block", position: style.position, backgroundColor: mainBackground } as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle;
    restoreStyle = () => (window.getComputedStyle = original);
  };

  const stubMedia = () => {
    const original = window.matchMedia;
    const media = new EventTarget();
    window.matchMedia = (() => media) as unknown as typeof window.matchMedia;
    restoreMedia = () => (window.matchMedia = original);
    return media;
  };

  const themeStyle = (css = "") => {
    const style = document.createElement("style");
    style.id = "gha-themes";
    style.textContent = css;
    document.documentElement.append(style);
    return style;
  };

  const watch = () => {
    const calls = { count: 0 };
    stop = watchThemeChanges(document, () => {
      calls.count++;
      refreshEnterpriseBackground(document);
    });
    return calls;
  };

  afterEach(() => {
    stop();
    restoreStyle();
    restoreMedia();
    for (const style of document.querySelectorAll("#gha-themes")) style.remove();
    document.documentElement.removeAttribute("data-color-mode");
    mainBackground = "rgb(21, 27, 35)";
  });

  test("a Themes recolor updates the copied background", async () => {
    const style = themeStyle(":root{}");
    mount(fixture + MAIN);
    stubMainBackground();
    syncEnterpriseTab(document);
    expect(tab().style.getPropertyValue(BG)).toBe("rgb(21, 27, 35)");
    const calls = watch();
    mainBackground = "rgb(40, 42, 54)";
    style.textContent = ":root{--x:1}";
    await flush();
    expect(tab().style.getPropertyValue(BG)).toBe("rgb(40, 42, 54)");
    expect(calls.count).toBe(1);
    await flush();
    expect(calls.count).toBe(1);
  });

  test("a light/dark switch updates the copied background", async () => {
    mount(fixture + MAIN);
    stubMainBackground();
    syncEnterpriseTab(document);
    const calls = watch();
    mainBackground = "rgb(250, 250, 250)";
    document.documentElement.setAttribute("data-color-mode", "light");
    await flush();
    expect(tab().style.getPropertyValue(BG)).toBe("rgb(250, 250, 250)");
    expect(calls.count).toBe(1);
  });

  test("a system color scheme change updates the copied background", async () => {
    const media = stubMedia();
    mount(fixture + MAIN);
    stubMainBackground();
    syncEnterpriseTab(document);
    const calls = watch();
    mainBackground = "rgb(1, 4, 9)";
    media.dispatchEvent(new Event("change"));
    expect(tab().style.getPropertyValue(BG)).toBe("rgb(1, 4, 9)");
    expect(calls.count).toBe(1);
  });

  test("an invalid new value falls back instead of being copied", async () => {
    mount(fixture + MAIN);
    stubMainBackground();
    syncEnterpriseTab(document);
    watch();
    mainBackground = "red; } body{display:none";
    document.documentElement.setAttribute("data-color-mode", "dark");
    await flush();
    expect(tab().style.getPropertyValue(BG)).toBe("");
    expect(tab().classList.contains("gha-enterprise-tab--fallback-bg")).toBe(true);
  });

  test("the inherit path is left untouched", async () => {
    mount(fixture + MAIN, `${LABEL} style="background-color: rgb(1, 2, 3)"`);
    syncEnterpriseTab(document);
    const before = tab().outerHTML;
    const calls = watch();
    document.documentElement.setAttribute("data-color-mode", "dark");
    await flush();
    expect(calls.count).toBe(1);
    expect(tab().outerHTML).toBe(before);
  });

  test("a refresh writes nothing the page scheduler would react to", async () => {
    mount(fixture + MAIN);
    stubMainBackground();
    syncEnterpriseTab(document);
    const observer = new MutationObserver(() => {});
    observer.observe(document.documentElement, OBSERVE_INIT);
    mainBackground = "rgb(40, 42, 54)";
    refreshEnterpriseBackground(document);
    expect(isRelevantMutation(observer.takeRecords())).toBe(false);
    refreshEnterpriseBackground(document);
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });

  test("a replaced Themes style element is watched again", async () => {
    const calls = watch();
    themeStyle("a{}").remove();
    await flush();
    const before = calls.count;
    const fresh = themeStyle("b{}");
    await flush();
    expect(calls.count).toBe(before + 1);
    fresh.textContent = "c{}";
    await flush();
    expect(calls.count).toBe(before + 2);
  });

  test("a stale row falls back to a full sync", () => {
    mount(fixture + MAIN);
    syncEnterpriseTab(document);
    banner().remove();
    refreshEnterpriseBackground(document);
    expectUntouched();
  });

  test("stopping removes every listener", async () => {
    const media = stubMedia();
    const style = themeStyle("a{}");
    const calls = watch();
    stop();
    style.textContent = "b{}";
    document.documentElement.setAttribute("data-color-mode", "light");
    media.dispatchEvent(new Event("change"));
    themeStyle("c{}");
    await flush();
    expect(calls.count).toBe(0);
  });
});

describe("isRelevantMutation", () => {
  const observe = () => {
    const observer = new MutationObserver(() => {});
    observer.observe(document.documentElement, OBSERVE_INIT);
    return observer;
  };

  test("a sync echoes at most one relevant update, then settles", () => {
    mount(fixture + MAIN);
    const observer = observe();
    syncEnterpriseTab(document);
    observer.takeRecords();
    syncEnterpriseTab(document);
    expect(isRelevantMutation(observer.takeRecords())).toBe(false);
    observer.disconnect();
  });

  test("our own row marker does not schedule an update", () => {
    mount(fixture + MAIN);
    syncEnterpriseTab(document);
    const observer = observe();
    banner().removeAttribute("data-gha-enterprise-row");
    observer.takeRecords();
    syncEnterpriseTab(document);
    const records = observer.takeRecords();
    expect(records.some((record) => record.type === "attributes")).toBe(true);
    expect(isRelevantMutation(records)).toBe(false);
    observer.disconnect();
  });

  test("a dropped row marker schedules an update", () => {
    mount(fixture + MAIN);
    syncEnterpriseTab(document);
    const observer = observe();
    banner().removeAttribute("data-gha-enterprise-row");
    expect(isRelevantMutation(observer.takeRecords())).toBe(true);
    observer.disconnect();
  });

  test("a replaced header row schedules an update", () => {
    mount(fixture + MAIN);
    syncEnterpriseTab(document);
    const observer = observe();
    const fresh = banner().cloneNode(true) as HTMLElement;
    fresh.removeAttribute("data-gha-enterprise-row");
    banner().replaceWith(fresh);
    expect(isRelevantMutation(observer.takeRecords())).toBe(true);
    observer.disconnect();
  });
});

describe("enterprise-header.css", () => {
  test("uses no color literals", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgba?\(/i);
  });

  const rule = (selector: string) => css.match(new RegExp(`(^|\\n)${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`))?.[2] ?? "";
  const tokens: string[] = JSON.parse(readFileSync(join(__dirname, "fixtures/primer-tokens.json"), "utf8")).tokens;

  test("uses only known Primer color tokens", () => {
    const used = [...css.matchAll(/var\((--[\w-]*Color[\w-]*)/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(tokens, name).toContain(name);
  });

  test("the tab matches the header surface and has room to breathe", () => {
    const tab = rule(".gha-enterprise-tab");
    expect(tab).toContain("background-color: var(--gha-enterprise-bg, inherit);");
    expect(css).not.toContain("--bgColor-inset");
    expect(rule(".gha-enterprise-tab--fallback-bg")).toContain("background-color: var(--bgColor-default);");
    expect(css.indexOf(".gha-enterprise-tab--fallback-bg")).toBeGreaterThan(css.indexOf(".gha-enterprise-tab {"));
    expect(tab).toContain("color: var(--fgColor-muted);");
    expect(tab).toContain("border-top: 0;");
    expect(tab).toContain("padding: 3px 10px;");
    expect(tab).toContain("gap: 6px;");
    expect(tab).toContain("line-height: 1.4;");
    expect(tab).toContain("font-size: 80%;");
    expect(tab).toContain("border-radius: 0 0 var(--borderRadius-medium) var(--borderRadius-medium);");
  });

  test("long text is clipped with an ellipsis", () => {
    const text = rule(".gha-enterprise-text");
    expect(text).toContain("max-width: min(60vw, 520px);");
    expect(text).toContain("overflow: hidden;");
    expect(text).toContain("text-overflow: ellipsis;");
    expect(rule(".gha-enterprise-link")).toContain("color: inherit;");
    expect(rule(".gha-enterprise-link:hover")).toContain("text-decoration: underline;");
  });

  test("keeps the tab low in the stacking order", () => {
    expect(css).toMatch(/\.gha-enterprise-tab \{[^}]*z-index: 1;/);
  });

  test("hides the marked row", () => {
    const compact = css.replace(/\s+/g, "");
    expect(compact).toContain("[data-gha-enterprise-row],header[data-gha-enterprise-row]{display:none!important;");
    for (const declaration of ["visibility:hidden!important", "height:0!important", "min-height:0!important", "overflow:hidden!important"])
      expect(compact).toContain(declaration);
  });
});
