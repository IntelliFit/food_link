#!/bin/sh
set -eu

DESTINATION="${1:-}"
if [ -z "$DESTINATION" ]; then
  echo "usage: export-staged-snapshot.sh <absolute-directory>" >&2
  exit 2
fi
case "$DESTINATION" in
  /*) ;;
  *) echo "snapshot directory must be absolute" >&2; exit 2 ;;
esac

mkdir -p "$DESTINATION"
git checkout-index --all --prefix="${DESTINATION%/}/"
