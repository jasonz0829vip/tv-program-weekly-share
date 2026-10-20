#!/usr/bin/env bash
# Netlify Free: changes to GitHub Pages reports or snapshots must NOT trigger
# needless Netlify production deployments (which consume monthly free credits).
set -euo pipefail
if [[ -z "${CACHED_COMMIT_REF:-}" || -z "${COMMIT_REF:-}" ]]; then
  echo "First Netlify deployment: build the gateway."
  exit 1
fi
if git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" --   netlify.toml netlify/functions gateway-public scripts/netlify-ignore-build.sh; then
  echo "Netlify gateway unchanged; skip this production deployment."
  exit 0
fi
echo "Netlify gateway changed; deploy the updated function."
exit 1
