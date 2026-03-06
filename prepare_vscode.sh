#!/usr/bin/env bash
# shellcheck disable=SC1091

set -e

cd vscode || { echo "'vscode' dir not found"; exit 1; }

# --- Merge product.json ---
# VS Code's product.json is the base; ours overrides specific keys.
jsonTmp=$( jq -s '.[0] * .[1]' product.json ../product.json )
echo "${jsonTmp}" > product.json
unset jsonTmp

echo "=== Merged product.json ==="

# --- Source utils for apply_patch ---
. ../utils.sh

echo "APP_NAME=\"${APP_NAME}\""
echo "BINARY_NAME=\"${BINARY_NAME}\""

# --- Apply patches ---
# Core patches
for file in ../patches/*.patch; do
  if [[ -f "${file}" ]]; then
    apply_patch "${file}"
  fi
done

# OS-specific patches
if [[ -d "../patches/${OS_NAME}/" ]]; then
  for file in "../patches/${OS_NAME}/"*.patch; do
    if [[ -f "${file}" ]]; then
      apply_patch "${file}"
    fi
  done
fi

# User-local patches (gitignored)
for file in ../patches/user/*.patch; do
  if [[ -f "${file}" ]]; then
    apply_patch "${file}"
  fi
done

# --- Install dependencies ---
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

if [[ -f ../npmrc ]]; then
  mv .npmrc .npmrc.bak
  cp ../npmrc .npmrc
fi

for i in {1..5}; do
  npm ci && break

  if [[ $i == 5 ]]; then
    echo "npm ci failed after 5 attempts" >&2
    exit 1
  fi
  echo "npm ci failed (attempt $i), retrying..."
  sleep $(( 15 * (i + 1) ))
done

if [[ -f .npmrc.bak ]]; then
  mv .npmrc.bak .npmrc
fi

cd ..
