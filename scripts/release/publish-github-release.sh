#!/usr/bin/env bash
# Creates the GitHub release for the tag and attaches the zips found in release/.
# Usage: GH_TOKEN=... GH_REPO=owner/repo RELEASE_TAG=v1.2.3 scripts/release/publish-github-release.sh
set -euo pipefail

tag="${RELEASE_TAG:?RELEASE_TAG is required}"

gh release create "$tag" release/*.zip --verify-tag --title "$tag" --generate-notes
