#!/usr/bin/env bash
# Uploads the extension and its source to addons.mozilla.org as a new listed version.
# Reads the credentials from AMO_* variables and passes them under the names web-ext expects.
# Usage: EXT_ZIP=... SOURCE_ZIP=... RELEASE_URL=... AMO_JWT_ISSUER=... scripts/release/publish-firefox-amo.sh
set -euo pipefail

zip="${EXT_ZIP:?EXT_ZIP is required}"
source_zip="${SOURCE_ZIP:?SOURCE_ZIP is required}"
release_url="${RELEASE_URL:?RELEASE_URL is required}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
unzip -q "$zip" -d "$work/extension"
printf '{"version":{"release_notes":{"en-US":"%s"}}}\n' "$release_url" > "$work/metadata.json"

WEB_EXT_API_KEY="${AMO_JWT_ISSUER:?AMO_JWT_ISSUER is required}" \
WEB_EXT_API_SECRET="${AMO_JWT_SECRET:?AMO_JWT_SECRET is required}" \
  npx --yes web-ext@9 sign \
    --source-dir "$work/extension" \
    --artifacts-dir "$work/artifacts" \
    --channel listed \
    --amo-metadata "$work/metadata.json" \
    --upload-source-code "$source_zip"
