(() => {
  "use strict";

  const modules = globalThis.__ghaRunViewModules;
  const { state, groups, groupLabels, statusOptions } = modules;
  const { selectedStatuses, collapsedStageGroups } = state;
  const stageNumbersByCard = new Map();
  let numberedRunPath = "";
  function isRunFinished() {
    const statusField = Array.from(
      document.querySelectorAll(".actions-workflow-stats > .d-flex > div")
    ).find((field) => field.firstElementChild?.textContent.trim() === "Status");
    const status = statusField?.children[1]?.textContent.trim() ?? "";
    return /^(success|failure|failed|cancelled|canceled|skipped|neutral|timed out|action required|startup failure|stale|completed)$/i.test(
      status
    );
  }

  function jobStatus(row) {
    const label =
      row
        .querySelector("svg[aria-label]")
        ?.getAttribute("aria-label")
        .trim()
        .toLowerCase() ?? "";
    if (/^skipped\b/.test(label)) return "skipped";
    if (/^cancell?ed\b/.test(label)) return "cancelled";
    if (
      row.matches(".MatrixComponent-pending") ||
      row.querySelector("svg.octicon-circle") ||
      /^(pending|queued|waiting)\b/.test(label)
    )
      return "waiting";
    if (/^timed out\b/.test(label)) return "timed-out";
    if (
      /^(failed|failure|startup failure|completed (?:with )?(?:failure|errors?))\b/.test(
        label
      )
    )
      return "failed";
    if (/^action required\b/.test(label)) return "action-required";
    if (/^(in[ _]progress|running)\b/.test(label)) return "active";
    if (
      row.closest('streaming-graph-job[data-concluded="true"]') ||
      /^(completed|success|neutral|stale)\b/.test(label)
    )
      return "completed";
    return "active";
  }

  function groupJobs(graph) {
    const runFinished = isRunFinished();
    const query = state.appliedSearch.trim().toLowerCase();
    const counts = new Map(statusOptions.map(([status]) => [status, 0]));
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
      const remembered = Array.from(cards, (card) =>
        stageNumbersByCard.get(card.id)
      ).find(Boolean);
      const stageNumber =
        remembered ||
        (!newRun && stage.dataset.ghaStageNumber) ||
        String(stageIndex + 1);
      if (stage.dataset.ghaStageNumber !== stageNumber)
        stage.dataset.ghaStageNumber = stageNumber;
      for (const card of cards)
        if (card.id && !stageNumbersByCard.has(card.id))
          stageNumbersByCard.set(card.id, stageNumber);
      const present = new Set();
      for (const card of cards) {
        const statuses = [];
        const titleMatches = card
          .querySelector(":scope > .WorkflowCard-heading")
          ?.textContent.toLowerCase()
          .includes(query);
        const rows = card.querySelectorAll(
          ".WorkflowJob-title, .MatrixComponent-collapse--title, .MatrixComponent-pending"
        );
        for (const row of rows) {
          if (card.classList.contains("WorkflowCard-group")) {
            const name = row.querySelector(
              '[data-target="streaming-graph-job.name"]'
            );
            if (name) {
              const currentName = name.textContent.trim();
              if (currentName !== name.dataset.ghaShortName) {
                const separator = currentName.lastIndexOf(" / ");
                if (separator !== -1) {
                  const shortName = currentName.slice(separator + 3).trim();
                  name.dataset.ghaFullName = currentName;
                  name.dataset.ghaShortName = shortName;
                  name.textContent = shortName;
                  name.title = currentName;
                } else if (name.dataset.ghaFullName) {
                  delete name.dataset.ghaFullName;
                  delete name.dataset.ghaShortName;
                  name.removeAttribute("title");
                  row.removeAttribute("aria-label");
                }
              }
              if (name.dataset.ghaFullName) {
                const statusLabel = row
                  .querySelector("svg[aria-label]")
                  ?.getAttribute("aria-label");
                const label = `${statusLabel ?? ""} ${name.dataset.ghaFullName}`.trim();
                if (row.getAttribute("aria-label") !== label)
                  row.setAttribute("aria-label", label);
              }
            }
          }
          const status = jobStatus(row);
          const root =
            row.closest("streaming-graph-job, button.WorkflowJob") ?? row;
          const finishedWaiting = status === "waiting" && runFinished;
          const waitingForReview =
            status === "waiting" &&
            /\bwaiting for review\b/i.test(root.textContent);
          const amount = row.matches(".MatrixComponent-collapse--title")
            ? Number(row.textContent.match(/\b(\d+)\s+jobs?\b/i)?.[1] ?? 1)
            : 1;
          const collapsedFailure =
            status === "failed" && row.matches(".MatrixComponent-collapse--title");
          counts.set(status, counts.get(status) + (collapsedFailure ? 1 : amount));
          if (collapsedFailure && amount > 1) failedCountIsLowerBound = true;
          if (waitingForReview)
            counts.set("action-required", counts.get("action-required") + amount);
          if (finishedWaiting)
            counts.set("skipped", counts.get("skipped") + amount);
          const fullName =
            query &&
            (row.querySelector("[data-gha-full-name]")?.dataset.ghaFullName ||
              row.closest("streaming-graph-job")?.querySelector("tool-tip")
                ?.textContent);
          const matchesSearch =
            !query ||
            titleMatches ||
            (row.matches(".WorkflowJob-title") &&
              (row.textContent.toLowerCase().includes(query) ||
                fullName?.toLowerCase().includes(query)));
          const matchesStatus =
            selectedStatuses.size === 0 ||
            selectedStatuses.has(status) ||
            (waitingForReview && selectedStatuses.has("action-required")) ||
            (finishedWaiting && selectedStatuses.has("skipped"));
          const hidden = !matchesStatus || !matchesSearch;
          root.toggleAttribute("data-gha-status-hidden", hidden);
          if (!hidden) {
            let group = status;
            if (status === "waiting")
              group = finishedWaiting ? "skipped" : "active";
            else if (!groups.includes(status)) group = "completed";
            statuses.push(group);
          }
        }
        const hidden = rows.length
          ? statuses.length === 0
          : Boolean(query && !card.textContent.toLowerCase().includes(query));
        card.toggleAttribute("data-gha-status-hidden", hidden);
        const status =
          statuses.includes("active") || rows.length === 0
            ? "active"
            : groups.find((group) => statuses.includes(group));
        card.style.order = state.statusGroupingEnabled
          ? String(groups.indexOf(status) * 2 + 1)
          : "";
        card.toggleAttribute(
          "data-gha-group-collapsed",
          state.statusGroupingEnabled &&
            collapsedStageGroups.has(`${stageNumber}:${status}`)
        );
        if (!hidden && !card.hasAttribute("data-gha-scope-hidden"))
          present.add(status);
      }
      let badge = stage.querySelector(":scope > .gha-run-stage-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "gha-run-stage-badge";
        stage.prepend(badge);
      }
      let badgeLabel = badge.querySelector(
        ":scope > .gha-run-stage-badge-label"
      );
      if (!badgeLabel) {
        badgeLabel = document.createElement("span");
        badgeLabel.className = "gha-run-stage-badge-label";
        badge.replaceChildren(badgeLabel);
      }
      const badgeText = `Stage ${stageNumber}`;
      if (badgeLabel.textContent !== badgeText)
        badgeLabel.textContent = badgeText;
      groups.forEach((status, index) => {
        let heading = stage.querySelector(
          `:scope > .gha-run-status-heading[data-status="${status}"]`
        );
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
        if (heading.textContent !== groupLabels[index])
          heading.textContent = groupLabels[index];
        if (heading.dataset.stageNumber !== stageNumber)
          heading.dataset.stageNumber = stageNumber;
        const label = `Stage ${stageNumber}, ${groupLabels[index]} jobs`;
        if (heading.getAttribute("aria-label") !== label)
          heading.setAttribute("aria-label", label);
        const expanded = !collapsedStageGroups.has(`${stageNumber}:${status}`);
        if (heading.getAttribute("aria-expanded") !== String(expanded))
          heading.setAttribute("aria-expanded", String(expanded));
        heading.hidden = !state.statusGroupingEnabled || !present.has(status);
      });
      stage.toggleAttribute(
        "data-gha-status-hidden",
        present.size === 0 && Boolean(query || selectedStatuses.size)
      );
    }
    if (failedCountIsLowerBound)
      counts.set("failed", `${counts.get("failed")}+`);
    return counts;
  }


  modules.groupJobs = groupJobs;
})();
