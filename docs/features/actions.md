# Actions features

These features apply to the Actions page of a repository (`https://github.com/<owner>/<repo>/actions`), including the page of a single workflow.

## Workflows categories

Adds a **Categories** section to the workflows sidebar so you can group the workflows of a repository.

- **Create:** use the **+** (New category) button in the **Categories** heading, type a name and click **Save**. Names must be unique (ignoring case), at most 40 characters, with no leading or trailing spaces.
- **Add a workflow:** every workflow row has a **+** button (Add to category). It lists your categories, plus **Create new category**, which creates one and adds that workflow to it.
- **Edit workflows:** the **...** menu of a category has **Edit workflows**, which shows a checkbox per workflow in that category; confirm with **Save**.
- **Rename and delete:** also in the **...** menu of a category (**Rename**, **Delete**; delete asks for confirmation).
- **Collapse:** click a category name to collapse or expand it. A button in the heading collapses or expands all categories at once. The collapsed state is saved.
- **Pinned workflows:** workflows you pin with GitHub's own pin button are shown in a **Pinned workflows** section above the categories. The pin button next to them is GitHub's own pin, so there is no separate pin for categories.
- **Backup:** the **...** menu in the **Categories** heading has **Export categories** and **Import categories**. Export downloads `gha-categories-<owner>-<repo>.json`. When you import a file, you choose **Merge** (adds to your categories; a category with the same name keeps its own name and collapsed state and gains the workflows of the file) or **Replace** (removes the current categories). A backup only imports into the repository it was exported from. Invalid files show an error and change nothing.

There is no setting to turn it off.

Data is stored in the browser extension storage, on your machine, one record per repository. Category data saved by earlier versions is read and converted automatically. A workflow is identified by its file name, so renaming the file in the repository removes it from its categories.

## Workflows filter

Adds a **Filter workflows** box at the top of the workflows sidebar. Typing shows only the workflows whose name contains the text (ignoring case), also inside categories and the pinned section; categories with no match are hidden. The **x** button clears the filter. The text is kept while GitHub re-renders the sidebar.

Because the filter looks at all the workflows of the repository (see the next section), it also finds workflows that GitHub would only show after clicking "Show more". Workflows that GitHub has not loaded yet are listed from the fetched list, with their own pin button; pinning one loads GitHub's rows in the background until its real pin button exists and then clicks it (it gives up after 15 seconds).

There is no setting to turn it off.

## Remove *"Show more"* button

GitHub paginates the workflows sidebar and shows a "Show more" button. The extension hides that button and loads the whole list from the start: it clicks "Show more" repeatedly until it disappears and, in parallel, fetches the full workflow list of the repository from GitHub (the same page-by-page data GitHub's own sidebar uses). While loading, a **Loading workflows...** line is shown. The page scrolls back to the top when the list is complete.

The fetched list is cached in the extension storage per repository and reused for 3 page loads, then fetched again, so new or removed workflows eventually appear. A partial list is never cached or shown; if the fetch fails, the filter and categories work with what GitHub has loaded.

There is no setting to turn it off.

## Resizable sidebar

On the Actions page, the workflows sidebar has a drag handle on its right edge. Drag it, or focus it and use the left and right arrow keys (20 px per step), to change the sidebar width. The width is limited to 240 px at minimum and 800 px at maximum, and never leaves less than 360 px for the page content. The handle is not available on windows narrower than 800 px.

The width is saved in the extension storage (one value for the Actions list, shared by all repositories) and restored on the next visit. See [Quality of Life](./quality-of-life.md#resizable-sidebars) for the same feature on other pages.

## Needs attention section

An optional panel above the list of runs on **All workflows** that lists the runs of the current list (what is loaded on the page) that need a person to look at them:

- Runs with status **Failed**, **Timed out** or **Action required**.
- Running runs marked **Slower than usual**: a run is listed when it has been running for more than twice, and more than 5 minutes over, the usual duration. The usual duration is the median of the last 5 successful runs with the same workflow file and title; if fewer than 5 are found (it looks at the run list and up to 2 more pages), the run is not checked. These durations are cached for 10 minutes per repository in the extension storage.

Each item shows the status, the run title (a link), the branch and, for slow runs, the elapsed and usual time. With nothing to report, the panel says "No runs need attention in the current list."

Setting: the gear button (**Run list settings**) in the run list filters has a **Show Needs attention** switch. It is on by default and only shown on **All workflows**.

## Enhanced workflows view

Shows the list of runs as cards. Each card gets a status label (a pill) next to the title, computed from the run's status text and, as a fallback, from the data embedded in the page:

| Label | Tone |
| --- | --- |
| Completed | success (green) |
| Failed, Timed out | danger (red) |
| Action required | severe (orange) |
| Running | accent (blue) |
| Waiting for approval | attention (yellow) |
| Queued, Cancelled, Skipped | neutral (gray) |

Runs whose status is waiting are labeled **Waiting for approval**. Clicking a card (outside its own links and buttons) opens the run, Enter on a focused card does the same, and the full title is shown as a tooltip. Run duration and history are only used by the Needs attention section (see above), not shown on the cards.

Setting: the same gear button (**Run list settings**) has an **Enhanced view** switch, on by default.

## Where settings are stored

The switches above are saved in the browser extension storage as `runList_enabled` (Show Needs attention) and `runList_enhancedViewEnabled` (Enhanced view), and apply to every repository. Categories, widths, the workflow list cache and the run duration cache live in the same storage (local to your browser). Nothing is sent anywhere.

## Limits

This is best-effort: GitHub's Actions page is rendered by React and its markup can change. If something stops working, report it in a [new issue](https://github.com/nerdtronik/github-enhancer/issues). Status labels depend on GitHub's English status text, with the embedded page data as a fallback.
