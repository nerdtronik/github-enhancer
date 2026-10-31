import { test, expect } from "@rstest/core";
import { durationSeconds, formatDuration, median, runState, statusTone } from "../src/ts/features/run-list/runState";

test("maps native status prefixes", () => {
  const table: [string, string][] = [
    ["Currently running", "Running"],
    ["Completed successfully", "Completed"],
    ["Failed", "Failed"],
    ["Timed out", "Timed out"],
    ["Requires action", "Action required"],
    ["Cancelled", "Cancelled"],
    ["Skipped", "Skipped"],
    ["Waiting", "Waiting for approval"],
    ["Queued", "Queued"],
  ];
  for (const [native, label] of table) expect(runState(native, null).label).toBe(label);
});

test("falls back to data status", () => {
  expect(runState("", { state: { status: "WORKFLOW_RUN_STATUS_WAITING" } }).label).toBe("Waiting for approval");
  expect(runState("", { state: { status: "WORKFLOW_RUN_STATUS_QUEUED" } }).label).toBe("Queued");
  expect(runState("", { state: { conclusion: "WORKFLOW_RUN_CONCLUSION_SUCCESS" } }).label).toBe("Completed");
  expect(runState("", null).label).toBe("");
});

test("sets active and attention", () => {
  expect(runState("Currently running", null)).toEqual({ label: "Running", active: true, attention: "" });
  expect(runState("Failed", null).attention).toBe("Failed");
  expect(runState("Timed out", null).attention).toBe("Timed out");
  expect(runState("Requires action", null).attention).toBe("Action required");
  expect(runState("Queued", null)).toMatchObject({ active: false, attention: "" });
  expect(runState("Cancelled", null).attention).toBe("");
  expect(runState("Waiting", null).attention).toBe("Waiting for approval");
});

test("statusTone", () => {
  expect(statusTone("Completed")).toBe("success");
  expect(statusTone("Failed")).toBe("danger");
  expect(statusTone("Timed out")).toBe("danger");
  expect(statusTone("Action required")).toBe("severe");
  expect(statusTone("Running")).toBe("accent");
  expect(statusTone("Waiting for approval")).toBe("attention");
  expect(statusTone("Queued")).toBe("neutral");
});

test("durationSeconds", () => {
  expect(durationSeconds("1h 2m 3s")).toBe(3723);
  expect(durationSeconds("2d")).toBe(172800);
  expect(durationSeconds("abc")).toBeNull();
  expect(durationSeconds("5m x")).toBeNull();
  expect(durationSeconds(null)).toBeNull();
});

test("formatDuration", () => {
  expect(formatDuration(45)).toBe("45s");
  expect(formatDuration(125)).toBe("2m");
  expect(formatDuration(3723)).toBe("1h 2m");
});

test("median", () => {
  expect(median([5, 1, 3, 2, 4])).toBe(3);
});
