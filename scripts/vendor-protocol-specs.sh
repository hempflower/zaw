#!/usr/bin/env bash
set -euo pipefail

# Refreshes the deliberately small, normative protocol subset used by Zaw. The
# output is committed; --check is suitable for CI and rejects any local drift.
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$root/docs/protocols/sources.lock"
mode=${1:-write}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git clone --quiet "$AHP_REPOSITORY" "$tmp/ahp"
git -C "$tmp/ahp" checkout --quiet --detach "$AHP_COMMIT"

copy_subset() {
  local source=$1 destination=$2
  if [[ "$mode" == "--check" ]]; then
    diff -ru --exclude=.git "$source" "$destination"
  else
    rm -rf "$destination"
    mkdir -p "$(dirname "$destination")"
    cp -R "$source" "$destination"
  fi
}

mkdir -p "$tmp/ahp-spec"
cp "$tmp/ahp/LICENSE" "$tmp/ahp-spec/LICENSE"
cp "$tmp/ahp/README.md" "$tmp/ahp-spec/README.md"
cp -R "$tmp/ahp/docs/specification" "$tmp/ahp-spec/specification"
cp -R "$tmp/ahp/schema" "$tmp/ahp-spec/schema"
copy_subset "$tmp/ahp-spec" "$root/docs/protocols/ahp"
