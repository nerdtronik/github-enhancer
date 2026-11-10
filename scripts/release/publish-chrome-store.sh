#!/usr/bin/env bash

set -euo pipefail

crx="${EXT_CRX:?EXT_CRX is required}"

EXTENSION_ID="${EXTENSION_ID:?EXTENSION_ID is required}"
CLIENT_ID="${CLIENT_ID:?CLIENT_ID is required}"
CLIENT_SECRET="${CLIENT_SECRET:?CLIENT_SECRET is required}"
REFRESH_TOKEN="${REFRESH_TOKEN:?REFRESH_TOKEN is required}"
PUBLISHER_ID="${PUBLISHER_ID:?PUBLISHER_ID is required}"

find . -name '*.crx'
echo "${crx}"

npm i -g chrome-webstore-upload-cli@4

npx chrome-webstore-upload-cli@4 upload --source "${crx}" --extension-id "${EXTENSION_ID}"
npx chrome-webstore-upload-cli@4 publish --extension-id "${EXTENSION_ID}"
