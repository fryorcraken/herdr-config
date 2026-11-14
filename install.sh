#!/usr/bin/env bash
# Links this repo's files into herdr's config folder.
#   ./install.sh         link everything
#   ./install.sh --dry   say what it would do, change nothing
# Anything already there that isn't the right link is moved aside to
# <name>.before-herdr-config, never deleted. Safe to run again.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEST=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
DRY=false
[ "${1:-}" = "--dry" ] || [ "${1:-}" = "-d" ] && DRY=true

# Mod folders are linked whole, so a new file in a mod needs no change here.
ITEMS="
mods/my-agents
mods/my-tabs
layouts/my-main.json
keys.json
settings.json
"

run() { if $DRY; then echo "  would: $*"; else "$@"; fi; }

for item in $ITEMS; do
  src="$REPO/$item" dst="$DEST/$item"
  if [ ! -e "$src" ]; then echo "missing in repo: $item" >&2; exit 1; fi
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    echo "ok       $item"
    continue
  fi
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    aside="$dst.before-herdr-config"
    if [ -e "$aside" ] || [ -L "$aside" ]; then
      echo "skipped  $item: $aside already exists, move it first" >&2
      continue
    fi
    echo "aside    $item -> $(basename "$aside")"
    run mv "$dst" "$aside"
  fi
  echo "link     $item"
  run mkdir -p "$(dirname "$dst")"
  run ln -s "$src" "$dst"
done
