import { test, expect } from "@rstest/core";
import { actionsRepository, isRunPage, route, workflowRoute } from "../src/ts/core/routes";

test("classifies run pages", () => {
  expect(route("/a/b/actions/runs/12").kind).toBe("actionRun");
  expect(route("/a/b/actions/runs/12").runId).toBe("12");
  expect(route("/a/b/actions/runs/12/attempts/2").runId).toBe("12");
  expect(route("/a/b/actions/runs/12/attempts/2").rest).toBe("");
  expect(route("/a/b/actions/runs/12/job/3")).toMatchObject({ kind: "actionRun", rest: "/job/3" });
  expect(route("/a/b/actions/runs/abc").kind).not.toBe("actionRun");
});

test("isRunPage matches exact run pages only", () => {
  expect(isRunPage("/a/b/actions/runs/12")).toBe(true);
  expect(isRunPage("/a/b/actions/runs/12/")).toBe(true);
  expect(isRunPage("/a/b/actions/runs/12/attempts/2")).toBe(true);
  expect(isRunPage("/a/b/actions/runs/12/attempts/x")).toBe(false);
  expect(isRunPage("/a/b/actions/runs/12/job/3")).toBe(false);
  expect(isRunPage("/a/b/actions/runs/abc")).toBe(false);
});

test("classification is positional", () => {
  expect(route("/actions/actions/actions")).toMatchObject({ kind: "actions", owner: "actions", repo: "actions" });
  expect(route("/o/pull/pull/5")).toMatchObject({ kind: "pull", repo: "pull", number: "5" });
  expect(route("/o/r").kind).toBe("other");
  expect(route("/o/r/issues/5").kind).toBe("other");
  expect(route("/o/r/pull/abc").kind).toBe("other");
});

test("classifies pull pages", () => {
  expect(route("/o/r/pull/5/files").kind).toBe("pullFiles");
  expect(route("/o/r/pull/5/changes/abc")).toMatchObject({ kind: "pullFiles", rest: "/abc" });
  expect(route("/o/r/pull/5/filesx")).toMatchObject({ kind: "pull", rest: "/filesx" });
  expect(route("/o/r/pull/5/")).toMatchObject({ kind: "pull", rest: "" });
  expect(route("/o/r/pull/5/commits")).toMatchObject({ kind: "pull", rest: "/commits" });
});

test("actions rest and repository", () => {
  expect(route("/o/r/actions/")).toMatchObject({ kind: "actions", rest: "" });
  expect(route("/o/r/actions/workflows/ci.yml")).toMatchObject({ kind: "actions", rest: "/workflows/ci.yml" });
  expect(route("/o/r/actions/caches").kind).toBe("actions");
  expect(actionsRepository(route("/o/r/actions/runs/1"))).toBe("o/r");
  expect(actionsRepository(route("/o/r/actions/x"))).toBe("o/r");
  expect(actionsRepository(route("/o/r/pull/1"))).toBe("");
  expect(route("//r/actions").kind).toBe("other");
});

test("workflowRoute", () => {
  expect(workflowRoute(".github/workflows/a b.yml")).toBe("a%20b.yml");
  expect(workflowRoute("dynamic/x/y")).toBe("x/y");
  expect(workflowRoute("other/x")).toBe("");
  expect(workflowRoute(5)).toBe("");
});

test("sidebar rest", () => {
  expect(route("/o/r/actions/runs/abc").rest).toBe("/runs/abc");
});
