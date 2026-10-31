# Quality of Life features

## Go to Top

A **Go to top** button fixed at the bottom right of the window. It appears once the page is scrolled past one window height and hides again when you come back. Clicking it scrolls the page to the top (smoothly, or instantly when your system prefers reduced motion). It works on any github.com page where the whole page scrolls, but not on panels that scroll on their own (for example a scrollable pane inside a page).

There is no setting to turn it off, and nothing is stored.

## No more trackers

GitHub sends telemetry from its pages with background requests. On the **Actions** pages of a repository (`/<owner>/<repo>/actions...`, including runs), the extension blocks exactly two of these endpoints: `https://collector.github.com/github/collect` and `https://api.github.com/_private/browser/stats`. The page gets an empty successful response, so it keeps working and shows no error. The same addresses on other pages of github.com are not touched. Other requests of the page are not touched either.

This script runs before GitHub's own scripts. On any github.com page, GitHub's own requests to `https://api.github.com/_private/browser/` get the "keepalive" option when the page did not set it, so they can finish while a page is being closed.

There is no setting to turn it off, and nothing is stored. It blocks only requests made by GitHub's page scripts; it is not a general tracker or ad blocker.

## Resizable sidebars

The sidebar of three pages has a drag handle on its right edge:

- The workflows list of the Actions page (see [Actions](./actions.md#resizable-sidebar)).
- The jobs list of a run page (see [Action Run](./action-run.md#resizable-sidebar)).
- The files sidebar of the pull request Files changed tab.

Drag the handle, or focus it and use the left and right arrow keys (20 px per step). The width is limited to 240 px at minimum and 800 px at maximum, and never leaves less than 360 px for the page content. The handle is not available on windows narrower than 800 px.

Each of the three pages saves its own width in the browser extension storage (shared by all repositories) and restores it on your next visit. There is no setting to turn it off.

## Limits

This is best-effort: GitHub's markup can change. If something stops working, report it in a [new issue](https://github.com/nerdtronik/github-enhancer/issues).

## Refresh now button

On Actions pages that have GitHub's **Auto-refresh** dropdown, a small refresh button is added next to it, so you can refresh without opening the menu. It clicks GitHub's own **Refresh now** item (the menu is kept out of sight while it does), so the refresh behaves exactly as if you had used the menu. After a click the icon spins and the button ignores clicks ("Refreshing…") until the refreshed content appears on the page, or 5 seconds at most, which prevents repeated refreshes. The tooltip shows above the button.

This is best-effort: the dropdown is found by its label and role. If GitHub renames it or changes its structure, the button simply does not appear; please report it in the Issues page.

