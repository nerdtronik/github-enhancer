/**
 * Classifies a timeline row into a filter category, or null for rows the filters must not touch
 * (the PR description card and "Load more" rows). Class names win; the text regexes are
 * fallbacks for rows without a recognisable class and depend on GitHub's English wording.
 */
export function category(row: Element, description: Element | null): string | null {
  if (row.contains(description)) return null;
  if (row.matches(".discussion-item-deployed, .discussion-item-deployment"))
    return "deployments";
  if (row.matches(".discussion-item-reviewed, .discussion-item-review"))
    return "reviews";
  if (
    row.matches(
      ".discussion-item-committed, .discussion-item-force-pushed, .discussion-item-pushed",
    )
  )
    return "commits";
  if (row.matches(".discussion-item-status, .discussion-item-check"))
    return "checks";
  const comment =
    row.matches(".timeline-comment") ||
    !!row.querySelector(".timeline-comment, .comment-body, .js-comment-body");
  if (
    !comment &&
    [...row.querySelectorAll("button")].some((button) =>
      /^(?:load|show) more/i.test(button.textContent.trim()),
    )
  )
    return null;
  if (comment) {
    const author = row.querySelector(".timeline-comment a.author, a.author");
    const bot =
      author?.getAttribute("href")?.startsWith("/apps/") ||
      /\[bot\]/i.test(author?.textContent ?? "") ||
      !!row.querySelector('.timeline-comment-header img[alt*="[bot]"]');
    return bot ? "bots" : "people";
  }
  if (
    row.querySelector('[data-testid*="deploy"], .octicon-rocket') ||
    /deployed to|deployment (?:succeeded|failed)|was deployed/i.test(
      row.textContent,
    )
  )
    return "deployments";
  if (
    /approved these changes|requested changes|submitted a review/i.test(
      row.textContent,
    )
  )
    return "reviews";
  if (/force-pushed|pushed \d+ commits?/i.test(row.textContent))
    return "commits";
  if (/checks? (?:passed|failed|completed)/i.test(row.textContent))
    return "checks";
  return "activity";
}
