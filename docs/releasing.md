# Releasing

A version is published to four places by one workflow, `.github/workflows/release.yml` ("Publish release"):

| Target | Job | What is published |
| --- | --- | --- |
| GitHub release | `github-release` | The extension zip, with generated release notes |
| Chrome Web Store | `publish-chrome-store` | The extension zip, uploaded and submitted for review |
| Firefox Add-ons (AMO) | `publish-firefox-amo` | The extension, plus the source zip AMO asks for because the code is bundled |
| GitHub Packages | `publish-github-packages` | The built extension as the npm package `@nerdtronik/github-enhancer` |

The workflows only call the scripts in `scripts/release/` (version from the tag, source zip, and one script per target), so each step can also be run locally. `.github/workflows/ci.yml` runs typecheck, lint, tests, the build and the packaging on every pull request and push to `main`.

## Making a release

1. Make sure `main` is green.
2. Create and push a tag named `vMAJOR.MINOR.PATCH`, for example `v0.2.0`:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. The workflow takes the version from the tag and writes it into `manifest.json` and `package.json` for that build only (nothing is committed back), builds, runs all checks, and then runs the four publish jobs in parallel (`package-extension` builds first). A failing store job does not stop the others, so it can be re-run on its own from the Actions page.

A tag that does not look like `v1.2.3` is rejected. To release or re-run an existing tag, use **Run workflow** on the Release workflow and enter the tag.

## One-time setup

### Repository

- The package job uses the built-in `GITHUB_TOKEN`; nothing to configure. The package is published under the owner's scope, so `name` in `package.json` must stay `@<owner>/...`.

### Chrome Web Store (environment `chrome-web-store`)

1. Create the item once by hand in the Chrome Web Store developer dashboard and upload a first zip (`npm run bundle`). Fill in the listing and the privacy tab (see `PRIVACY.md`).
2. Create OAuth credentials and a refresh token for the Chrome Web Store API, following the [chrome-webstore-upload-cli guide](https://github.com/fregante/chrome-webstore-upload-cli#readme).
3. In the repository settings, create an environment named `chrome-web-store` with the secrets `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET` and `CHROME_REFRESH_TOKEN`. Adding required reviewers to the environment makes each submission wait for an approval.

### Firefox Add-ons (environment `firefox-addons`)

1. Create the add-on once by hand on addons.mozilla.org with the id in `manifest.json` (`browser_specific_settings.gecko.id`) and complete the listing metadata (name, summary, categories, license). Later versions only need the release notes the workflow sends.
2. Generate API credentials at https://addons.mozilla.org/developers/addon/api/key/.
3. Create an environment named `firefox-addons` with the secrets `AMO_JWT_ISSUER` (the API key) and `AMO_JWT_SECRET` (the API secret).

The extension needs Firefox 128 or newer (content scripts that run in the page's own world). AMO builds are reviewed by hand, and the source zip lets reviewers reproduce the minified bundles with `npm ci && npm run build`.

## Notes

- The Chrome Web Store may warn about the `browser_specific_settings` key of the manifest; it is ignored there and is required by Firefox.
- Every action in the workflows is pinned to a commit SHA with the version in a comment. Update them together when upgrading.
- The npm package contains only the built extension (`dist`, `manifest.json` and the license and notice files), not the source.
