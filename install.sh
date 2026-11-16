#!/usr/bin/env bash
# Links this repo's files into herdr's config folder.
#   ./install.sh         link everything
#   ./install.sh --dry   say what it would do, change nothing (also -d, --dry-run, -n)
# Anything already there that isn't the right link is kept in
# <config>/.before-herdr-config/, never deleted. Safe to run again.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEST=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
# Outside mods/ and layouts/: herdr would load a kept mod folder as a mod.
KEEP="$DEST/.before-herdr-config"
DRY=false
# Anything it doesn't know stops it: a mistyped dry run mustn't install.
usage() { echo "usage: $0 [--dry]   (--dry, -d, --dry-run, -n: say what it would do, change nothing)"; }
[ $# -le 1 ] || { usage >&2; exit 2; }
case "${1:-}" in
  "") ;;
  --dry | -d | --dry-run | -n) DRY=true ;;
  -h | --help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

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
  src="$REPO/$item" dst="$DEST/$item" kept="$KEEP/$item"
  if [ ! -e "$src" ]; then echo "missing in repo: $item" >&2; exit 1; fi
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    echo "ok       $item"
    continue
  fi
  run mkdir -p "$(dirname "$dst")"
  if [ ! -e "$dst" ] && [ ! -L "$dst" ]; then
    echo "link     $item"
    run ln -s "$src" "$dst"
    continue
  fi
  if [ -e "$kept" ] || [ -L "$kept" ]; then
    echo "skipped  $item: $kept already exists, move it first" >&2
    continue
  fi
  echo "keep     $item -> .before-herdr-config/$item"
  run mkdir -p "$(dirname "$kept")"
  # The new link is made in KEEP (where herdr doesn't look) and renamed into
  # place, so the path is never missing: herdr writes its defaults over a
  # keys.json it can't find.
  link="$KEEP/.link.$$"
  echo "link     $item"
  run ln -s "$src" "$link"
  if [ -d "$dst" ] && [ ! -L "$dst" ]; then
    # A folder can't be renamed over: two renames, back to back.
    run mv "$dst" "$kept"
  else
    run cp -a "$dst" "$kept"
  fi
  run mv -Tf "$link" "$dst"
done
