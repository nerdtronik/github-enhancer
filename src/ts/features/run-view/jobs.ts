import { settings } from "../../core/settings";
import { groupLabels, groups, state, statusOptions } from "./shared";

const { selectedStatuses, collapsedStageGroups } = state;
// Remembered per card id so a stage keeps its number even if its position among the rendered
// stages changes; reset when the path changes.
const stageNumbersByCard = new Map<string, string>();
let numberedRunPath = "";

/** Coarse status groups a job row can be classified into. */
type JobStatus =
  | "skipped"
  | "cancelled"
  | "waiting"
  | "timed-out"
  | "failed"
  | "action-required"
  | "active"
  | "completed";

/** Returns true when the run has reached a terminal status. */
function isRunFinished(): boolean {
  const statusField = Array.from(
    document.querySelectorAll(".actions-workflow-stats > .d-flex > div"),
  ).find((field) => field.firstElementChild?.textContent.trim() === "Status");
  const status = statusField?.children[1]?.textContent.trim() ?? "";
  return /^(success|failure|failed|cancelled|canceled|skipped|neutral|timed out|action required|startup failure|stale|completed)$/i.test(
    status,
  );
}

/** Maps a job row's aria-label to a coarse status group. */
function jobStatus(row: HTMLElement): JobStatus {
  const svg = row.querySelector("svg[aria-label]") as SVGElement | null;
  const label =
    (svg?.getAttribute("aria-label") ?? "").trim().toLowerCase() ?? "";
  if (/^skipped\b/.test(label)) return "skipped";
  if (/^cancell?ed\b/.test(label)) return "cancelled";
  if (
    row.matches(".MatrixComponent-pending") ||
    row.querySelector("svg.octicon-circle") ||
    /^(pending|queued|waiting)\b/.test(label)
  ) {
    return "waiting";
  }
  if (/^timed out\b/.test(label)) return "timed-out";
  if (
    /^(failed|failure|startup failure|completed (?:with )?(?:failure|errors?))\b/.test(
      label,
    )
  )
    return "failed";
  if (/^action required\b/.test(label)) return "action-required";
  if (/^(in[ _]progress|running)\b/.test(label)) return "active";
  if (
    row.closest("streaming-graph-job[data-concluded='true']") ||
    /^(completed|success|neutral|stale)\b/.test(label)
  )
    return "completed";
  return "active";
}

/** Groups each stage's cards by status, numbers the stages, and returns per-status counts. */
export function groupJobs(graph: HTMLElement): Map<string, number | string> {
  const statusGroupingEnabled = settings.get("actionRun_statusGroupingEnabled");
  const runFinished = isRunFinished();
  const query = state.appliedSearch.trim().toLowerCase();
  const counts = new Map<string, number|string>(
    statusOptions.map(([status]) => [status, 0]),
  );
  // A collapsed matrix that contains failures counts as one failed job, not its real number of
  // failures, so the failed total is only a lower bound and is shown as "N+".
  let failedCountIsLowerBound = false;
  const newRun = numberedRunPath !== location.pathname;
  if (newRun) {
    numberedRunPath = location.pathname;
    stageNumbersByCard.clear();
  }
  for (const [stageIndex, stage] of graph
    .querySelectorAll(".WorkflowStage")
    .entries()) {
    const cards = stage.querySelectorAll(":scope > .WorkflowCard");
    // Prefer the remembered number, then the number already on the stage (unless the run changed),
    // then the position in this render.
    const remembered = Array.from(cards, (card) =>
      stageNumbersByCard.get(card.id),
    ).find(Boolean);
    const stageNumber =
      remembered ||
      (!newRun && (stage as HTMLElement).dataset.ghaStageNumber) ||
      String(stageIndex + 1);
    if ((stage as HTMLElement).dataset.ghaStageNumber !== stageNumber)
      (stage as HTMLElement).dataset.ghaStageNumber = stageNumber;
    for (const card of cards)
      if (card.id && !stageNumbersByCard.has(card.id))
        stageNumbersByCard.set(card.id, stageNumber);
    const present = new Set();
    for (const card of cards) {
      const statuses: string[] = [];
      const titleMatches = card
        .querySelector(":scope > .WorkflowCard-heading")
        ?.textContent.toLowerCase()
        .includes(query);
      const rows = card.querySelectorAll(
        ".WorkflowJob-title, .MatrixComponent-collapse--title, .MatrixComponent-pending",
      );
      for (const row of rows) {
        // Matrix job names look like "group / variant"; show only the variant and keep the full
        // name in a data attribute, title and aria-label so search and screen readers still see it.
        if (card.classList.contains("WorkflowCard-group")) {
          const name = row.querySelector(
            '[data-target="streaming-graph-job.name"]',
          );
          if (name) {
            const currentName = name.textContent.trim();
            if (currentName !== (name as HTMLElement).dataset.ghaShortName) {
              const separator = currentName.lastIndexOf(" / ");
              if (separator !== -1) {
                const shortName = currentName.slice(separator + 3).trim();
                (name as HTMLElement).dataset.ghaFullName = currentName;
                (name as HTMLElement).dataset.ghaShortName = shortName;
                name.textContent = shortName;
                (name as HTMLElement).title = currentName;
              } else if ((name as HTMLElement).dataset.ghaFullName) {
                delete (name as HTMLElement).dataset.ghaFullName;
                delete (name as HTMLElement).dataset.ghaShortName;
                name.removeAttribute("title");
                row.removeAttribute("aria-label");
              }
            }
            if ((name as HTMLElement).dataset.ghaFullName) {
              const statusLabel = row
                .querySelector("svg[aria-label]")
                ?.getAttribute("aria-label");
              const label =
                `${statusLabel ?? ""} ${(name as HTMLElement).dataset.ghaFullName}`.trim();
              if ((row as HTMLElement).getAttribute("aria-label") !== label)
                (row as HTMLElement).setAttribute("aria-label", label);
            }
          }
        }
        const status = jobStatus(row as HTMLElement);
        const root: Element =
          row.closest("streaming-graph-job, button.WorkflowJob") ?? row;
        // Treated as skipped when still "waiting" after the run finished (it never ran), for
        // counts and filtering. A job "waiting for review" is counted as action required as
        // well as waiting.
        const finishedWaiting = status === "waiting" && runFinished;
        const waitingForReview =
          status === "waiting" &&
          /\bwaiting for review\b/i.test(root.textContent ?? "");
        // A collapsed matrix row stands for N jobs ("N jobs"); other rows are one job.
        const amount = row.matches(".MatrixComponent-collapse--title")
          ? Number(
              (row as HTMLElement).textContent.match(
                /\b(\d+)\s+jobs?\b/i,
              )?.[1] ?? 1,
            )
          : 1;
        const collapsedFailure = Number(
          status === "failed" &&
            row.matches(".MatrixComponent-collapse--title"),
        );
        const currentCount = counts.get(status);
        const curValStatus = Number(currentCount ?? 0);
        counts.set(status, curValStatus + (collapsedFailure ? 1 : amount));
        if (collapsedFailure && amount > 1) failedCountIsLowerBound = true;
        if (waitingForReview) {
          const currentCount = counts.get("action-required");
          const curValAction = Number(currentCount ?? 0);
          counts.set("action-required", curValAction + amount);
        }
        if (finishedWaiting) {
          const currentCount = counts.get("skipped");
          const curValSkipped = Number(currentCount ?? 0);
          counts.set("skipped", curValSkipped + amount);
        }
        const fullNameElement = row.querySelector(
          "[data-gha-full-name]",
        ) as HTMLElement | null;
        const fullNameText = row
          .closest("streaming-graph-job")
          ?.querySelector("tool-tip")?.textContent;
        const fullName =
          query && (fullNameElement?.dataset.ghaFullName || fullNameText);
        const matchesSearch =
          !query ||
          titleMatches ||
          (row.matches(".WorkflowJob-title") &&
            ((row as HTMLElement).textContent.toLowerCase().includes(query) ||
              fullName?.toLowerCase().includes(query)));
        const matchesStatus =
          selectedStatuses.size === 0 ||
          selectedStatuses.has(status) ||
          (waitingForReview && selectedStatuses.has("action-required")) ||
          (finishedWaiting && selectedStatuses.has("skipped"));
        const hidden = !matchesStatus || !matchesSearch;
        root.toggleAttribute("data-gha-status-hidden", hidden);
        if (!hidden) {
          // Display group of a visible job: pending work is "active", finished-waiting is
          // "skipped", and statuses without their own group (failed, timed out, ...) are shown
          // with "completed".
          let group = status;
          if (status === "waiting")
            group = finishedWaiting ? "skipped" : "active";
          else if (!groups.includes(status)) group = "completed";
          statuses.push(group);
        }
      }
      // A card with no job rows has nothing to match a status filter; only search can hide it.
      const hidden = rows.length
        ? statuses.length === 0
        : Boolean(
            query &&
            !((card as HTMLElement).textContent ?? "")
              .toLowerCase()
              .includes(query),
          );
      card.toggleAttribute("data-gha-status-hidden", hidden);
      // The card's group: any active job makes the card active, else the first group in display
      // order that it contains.
      const statusType =
        statuses.includes("active") || rows.length === 0
          ? "active"
          : (groups.find((group) => statuses.includes(group)) as JobStatus);
      (card as HTMLElement).style.order = statusGroupingEnabled
        ? String(groups.indexOf(statusType) * 2 + 1)
        : "";
      card.toggleAttribute(
        "data-gha-group-collapsed",
        statusGroupingEnabled &&
          collapsedStageGroups.has(`${stageNumber}:${statusType}`),
      );
      if (!hidden && !card.hasAttribute("data-gha-scope-hidden"))
        present.add(statusType);
    }
    let badge: HTMLElement | null = stage.querySelector(
      ":scope > .gha-run-stage-badge",
    );
    if (!badge) {
      badge = document.createElement("span") as HTMLElement;
      badge.className = "gha-run-stage-badge";
      stage.prepend(badge);
    }
    let badgeLabel: HTMLElement | null = (badge as HTMLElement).querySelector(
      ":scope > .gha-run-stage-badge-label",
    );
    if (!badgeLabel) {
      badgeLabel = document.createElement("span") as HTMLElement;
      badgeLabel.className = "gha-run-stage-badge-label";
      (badge as HTMLElement).replaceChildren(badgeLabel);
    }
    const badgeText = `Stage ${stageNumber}`;
    if ((badgeLabel as HTMLElement).textContent !== badgeText)
      (badgeLabel as HTMLElement).textContent = badgeText;
    groups.forEach((status, index) => {
      let heading: HTMLButtonElement | null = stage.querySelector(
        `:scope > .gha-run-status-heading[data-status="${status}"]`,
      ) as HTMLButtonElement | null;
      if (!heading?.matches("button")) {
        const oldHeading = heading;
        heading = document.createElement("button");
        heading.type = "button";
        heading.className = "gha-run-status-heading";
        heading.dataset.status = status;
        heading.style.order = String(index * 2);
        if (oldHeading) oldHeading.replaceWith(heading);
        else stage.append(heading);
      }
      if ((heading as HTMLElement).textContent !== groupLabels[index])
        (heading as HTMLElement).textContent = groupLabels[index];
      if ((heading as HTMLElement).dataset.stageNumber !== stageNumber) {
        (heading as HTMLElement).dataset.stageNumber = stageNumber;
      }
      const label = `Stage ${stageNumber}, ${groupLabels[index]} jobs`;
      if ((heading as HTMLElement).getAttribute("aria-label") !== label)
        (heading as HTMLElement).setAttribute("aria-label", label);
      const expanded = !collapsedStageGroups.has(`${stageNumber}:${status}`);
      if (
        (heading as HTMLElement).getAttribute("aria-expanded") !==
        String(expanded)
      )
        (heading as HTMLElement).setAttribute(
          "aria-expanded",
          String(expanded),
        );
      heading.hidden = !statusGroupingEnabled || !present.has(status);
    });
    (stage as HTMLElement).toggleAttribute(
      "data-gha-status-hidden",
      present.size === 0 && Boolean(query || state.selectedStatuses.size),
    );
  }
  if (failedCountIsLowerBound)
    counts.set("failed", `${counts.get("failed")}+`);
  return counts;
}
