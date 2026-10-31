# Privacy Policy

_Last updated: 2026-10-30_

GitHub Enhancer is a browser extension that adds features to github.com. This policy explains what it does with data. In short: it does not collect, transmit, sell or share any personal data.

## What the extension does not do

- It does not collect personal information, browsing history, analytics or usage statistics.
- It does not send data to the developer or to any third-party server.
- It does not use advertising, tracking or remote-hosted code. All code is bundled in the extension.
- It does not read or store your GitHub credentials or tokens.

## Data stored on your device

The extension saves the following in your browser's extension storage (`storage.local`). This data stays on your device and is never uploaded by the extension:

- Your settings, such as which features and views are enabled.
- Workflow categories you create, and their collapsed state, per repository.
- Sidebar widths you choose.
- Custom themes you create or import, and which theme is active for light and dark mode.
- Cached data to speed up pages, such as the list of a repository's workflows and recent run durations.
- Collapsed pull request comments and conversation filter choices.

You can remove this data at any time by uninstalling the extension or by clearing its storage from your browser's extension settings. Exported category and theme files are saved only where you choose to download them.

## Network requests

The extension runs only on `https://github.com/*`. To provide some features it requests pages and data from github.com itself, using your existing session, for example to load a repository's full workflow list or run details. It makes no requests to other servers. Extension icons and the bundled theme files are loaded from the extension package.

## Telemetry blocking

On GitHub Actions pages the extension blocks GitHub's own basic telemetry requests (to `collector.github.com` and `api.github.com/_private/browser/stats`). It also marks other GitHub browser requests to `api.github.com/_private/browser/` as keep-alive so they are not dropped. It does not read or change their contents.

## Permissions

- **`storage`**: to save the settings and data listed above locally.
- **Access to `https://github.com/*`**: to modify github.com pages and add the features.

## Children

The extension is not directed at children and collects no data from anyone.

## Changes to this policy

If this policy changes, the updated version will be published in this repository with a new date.

## Contact

Questions or concerns: open an issue at https://github.com/nerdtronik/github-enhancer/issues.

GitHub Enhancer is an independent project and is not affiliated with or endorsed by GitHub, Inc.
