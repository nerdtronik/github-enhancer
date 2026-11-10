#!/usr/bin/env bash
# Uploads the extension zip to the Chrome Web Store and submits it for review.
# Usage: EXT_ZIP=release/github-enhancer-1.2.3.zip EXTENSION_ID=... scripts/release/publish-chrome-store.sh
set -euo pipefail

zip="${EXT_ZIP:?EXT_ZIP is required}"

EXTENSION_ID="${EXTENSION_ID:?EXTENSION_ID is required}"
CLIENT_ID="${CLIENT_ID:?CLIENT_ID is required}"
CLIENT_SECRET="${CLIENT_SECRET:?CLIENT_SECRET is required}"
REFRESH_TOKEN="${REFRESH_TOKEN:?REFRESH_TOKEN is required}"

npm i -g chrome-webstore-upload-cli@3

chrome-webstore-upload-cli upload --source "$zip" --extension-id "${EXTENSION_ID}"
chrome-webstore-upload publish --extension-id "${EXTENSION_ID}"
