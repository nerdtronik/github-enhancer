#!/usr/bin/env bash
# Uploads the extension zip to the Chrome Web Store and submits it for review.
# Reads the credentials from CHROME_* variables and passes them under the names the tool expects.
# Usage: EXT_ZIP=release/github-enhancer-1.2.3.zip CHROME_EXTENSION_ID=... scripts/release/publish-chrome-store.sh
set -euo pipefail

zip="${EXT_ZIP:?EXT_ZIP is required}"

EXTENSION_ID="${CHROME_EXTENSION_ID:?CHROME_EXTENSION_ID is required}" \
CLIENT_ID="${CHROME_CLIENT_ID:?CHROME_CLIENT_ID is required}" \
CLIENT_SECRET="${CHROME_CLIENT_SECRET:?CHROME_CLIENT_SECRET is required}" \
REFRESH_TOKEN="${CHROME_REFRESH_TOKEN:?CHROME_REFRESH_TOKEN is required}" \
  npx --yes chrome-webstore-upload-cli@3 upload --source "$zip" --auto-publish
