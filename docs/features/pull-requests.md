# Pull Requests features

These features apply to the Conversation tab of a pull request (`https://github.com/<owner>/<repo>/pull/<number>`). There is no setting to turn them off.

## Conversation filters

Adds a **Conversation filters** panel to the right sidebar of the pull request, just above **Reviewers**. It stays visible under the sticky header while you scroll. It filters the timeline rows that are loaded in the page (the PR description and GitHub's "Load more" rows are never hidden). A counter shows "N of M loaded shown".

- **Quick views:** **All**, **Unresolved**, **People**, **Bots** and **Comments only** (people and bots).
- **Filter activity:** a menu with a checkbox per kind, each with its count: **Unresolved review threads**, **Human comments**, **Bot comments**, **Review decisions**, **Commits and pushes**, **Checks**, **Deployment statuses**, **Other activity**. **Show all** selects everything again. Unchecking **Unresolved review threads** hides unresolved threads even when their kind is selected.
- **Remember filters:** when checked, your selection is kept for the next pull requests you open. When unchecked (the default), filters reset every time you open a pull request.

Rows are classified by GitHub's CSS classes and, when those are missing, by its English wording (for example "approved these changes" or "force-pushed"), so a row can occasionally land in "Other activity". Bot comments are those whose author is a GitHub App or has a `[bot]` name.

Data: only the **Remember filters** choice and the selection are stored, as one record in the browser extension storage, shared by all repositories and pull requests.

## Collapsible comments

Each comment card in the conversation gets a chevron button in its header to collapse or expand it. The **Collapse all** / **Expand all** button of the filters panel does it for all the loaded comments at once.

Collapsed comments are remembered per pull request in the browser extension storage and collapsed again the next time you open it. Comments without an identifier in the page still collapse but are not saved.

## Merge & Code buttons in navbar

When you scroll down, GitHub shows a compact sticky header with the pull request title and hides the action buttons of the page header (the **Code** and **Merge** buttons). While that sticky header is stuck, the extension moves these buttons into it, next to the title, so they stay available while you scroll. When the header is not stuck, the buttons go back to their place. On very narrow layouts the buttons stay at least 16 px from the window edge.

## Limits

This is best-effort: GitHub's pull request page is rendered by React and its markup changes often (the sticky header is found by a generated class name). If a feature stops working, report it in a [new issue](https://github.com/nerdtronik/github-enhancer/issues).
