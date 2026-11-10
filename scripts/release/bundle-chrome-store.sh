#!/usr/bin/env bash

set -euo pipefail

REQUIRED_FILES=("manifest.json" "LICENSE.md" "PRIVACY.md" "THIRD_PARTY_NOTICES.md" "dist")
OUTPUT_DIR="chrome-release"
PRIVATE_KEY="${PRIVATE_KEY:?PRIVATE_KEY is required}"

mkdir -p "${OUTPUT_DIR}"

echo "${PRIVATE_KEY}" > private.pem

for filename in "${REQUIRED_FILES[@]}"; do
    cp -rf "${filename}" "${OUTPUT_DIR}/${filename}"
done

google-chrome --version
google-chrome --pack-extension=${OUTPUT_DIR} --pack-extension-key=private.pem --no-message-box

find . -name "*.crx"