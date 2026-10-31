#!/usr/bin/env bash
# Archives the tagged source for the Firefox reviewers, who rebuild bundled code from it.
# Usage: RELEASE_TAG=v1.2.3 EXT_SLUG=github-enhancer EXT_VERSION=1.2.3 scripts/release/make-source-zip.sh
set -euo pipefail

tag="${RELEASE_TAG:?RELEASE_TAG is required}"
slug="${EXT_SLUG:?EXT_SLUG is required}"
version="${EXT_VERSION:?EXT_VERSION is required}"

mkdir -p release
git archive --format=zip --prefix="$slug-$version/" -o "release/$slug-$version-source.zip" "$tag"
