import { expect, test } from "@rstest/core";
import { formatAge, sortAttention, workflowName } from "../src/ts/features/run-list/attention";

test("orders failures, then decisions, then slow runs, newest first within a rank", () => {
  const runs = [
    { status: "Slower than usual", createdAt: 5 },
    { status: "Waiting for approval", createdAt: 4 },
    { status: "Failed", createdAt: 1 },
    { status: "Action required", createdAt: 3 },
    { status: "Timed out", createdAt: 2 },
  ];
  expect(sortAttention(runs).map((run) => run.status)).toEqual([
    "Timed out",
    "Failed",
    "Action required",
    "Waiting for approval",
    "Slower than usual",
  ]);
});

test("workflowName strips the folder and extension", () => {
  expect(workflowName(".github/workflows/deploy-prod.yaml")).toBe("deploy-prod");
  expect(workflowName("ci.yml")).toBe("ci");
  expect(workflowName("")).toBe("");
});

test("formatAge", () => {
  const now = 10_000_000_000;
  expect(formatAge(now - 30_000, now)).toBe("just now");
  expect(formatAge(now - 5 * 60_000, now)).toBe("5m ago");
  expect(formatAge(now - 3 * 3_600_000, now)).toBe("3h ago");
  expect(formatAge(now - 2 * 86_400_000, now)).toBe("2d ago");
  expect(formatAge(0, now)).toBe("");
  expect(formatAge(now + 1000, now)).toBe("");
});

import { dismissedToStore, latestPerWorkflow, parseDismissed } from "../src/ts/features/run-list/attention";

test("latestPerWorkflow drops failures that a later run of the same workflow replaced", () => {
  const run = (id: string, workflowPath: string, createdAt: number) => ({ id, workflowPath, createdAt });
  const all = [run("3", "ci.yml", 30), run("2", "ci.yml", 20), run("1", "deploy.yml", 10), run("0", "", 5)];
  const attention = [all[1], all[2], all[3]];
  expect(latestPerWorkflow(all, attention).map((item) => item.id)).toEqual(["1", "0"]);
  expect(latestPerWorkflow(all, [all[0]]).map((item) => item.id)).toEqual(["3"]);
});

test("latestPerWorkflow keeps the first run in list order when times are unknown", () => {
  const run = (id: string) => ({ id, workflowPath: "ci.yml", createdAt: 0 });
  expect(latestPerWorkflow([run("2"), run("1")], [run("2"), run("1")]).map((item) => item.id)).toEqual(["2"]);
});

test("parseDismissed ignores malformed data and dismissedToStore caps the list", () => {
  expect([...parseDismissed(["1", "", 2, null, "3"])]).toEqual(["1", "3"]);
  expect(parseDismissed({ a: 1 }).size).toBe(0);
  expect(parseDismissed(undefined).size).toBe(0);
  const many = new Set(Array.from({ length: 250 }, (_, index) => String(index)));
  const stored = dismissedToStore(many);
  expect(stored).toHaveLength(200);
  expect(stored[0]).toBe("50");
  expect(stored.at(-1)).toBe("249");
});
