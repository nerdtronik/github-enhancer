#!/usr/bin/env bash
# Validates the release tag and writes its version into package.json and manifest.json (only in the
# working copy of the build; nothing is committed). Prints "version=<x.y.z>" for $GITHUB_OUTPUT.
# Usage: RELEASE_TAG=v1.2.3 scripts/release/prepare-version.sh
set -euo pipefail

tag="${RELEASE_TAG:?RELEASE_TAG is required}"
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::The tag '$tag' must look like v1.2.3" >&2
  exit 1
fi

version="${tag#v}"
# Both stores need a plain numeric manifest version; package.json names the zip and the npm package.
npm pkg set version="$version"
jq --arg version "$version" '.version = $version' manifest.json > manifest.json.tmp
mv manifest.json.tmp manifest.json

echo "version=$version"
