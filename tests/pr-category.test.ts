import { test, expect } from "@rstest/core";
import { category } from "../src/ts/features/pr-conversation/category";

function row(html: string, cls = ""): Element {
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

test("description card and load-more rows are null", () => {
  const r = row('<div class="timeline-comment"><div id="d"></div></div>');
  expect(category(r, r.querySelector("#d"))).toBeNull();
  expect(category(row("<button>Load more...</button>"), null)).toBeNull();
  expect(category(row("<button>Show more</button>"), null)).toBeNull();
});

test("class based families", () => {
  expect(category(row("", "discussion-item-deployed"), null)).toBe("deployments");
  expect(category(row("", "discussion-item-review"), null)).toBe("reviews");
  expect(category(row("", "discussion-item-pushed"), null)).toBe("commits");
  expect(category(row("", "discussion-item-check"), null)).toBe("checks");
});

test("comments split into people and bots", () => {
  expect(category(row('<div class="timeline-comment"><a class="author" href="/bob">bob</a></div>'), null)).toBe("people");
  expect(category(row('<div class="timeline-comment"><a class="author" href="/apps/x">x</a></div>'), null)).toBe("bots");
  expect(category(row('<div class="timeline-comment"><a class="author" href="/u">dependabot[bot]</a></div>'), null)).toBe("bots");
});

test("text based families and fallback", () => {
  expect(category(row("Bob deployed to prod"), null)).toBe("deployments");
  expect(category(row("Bob approved these changes"), null)).toBe("reviews");
  expect(category(row("Bob force-pushed the branch"), null)).toBe("commits");
  expect(category(row("All checks passed"), null)).toBe("checks");
  expect(category(row("Bob added a label"), null)).toBe("activity");
});
