#!/bin/sh
set -eu

DESTINATION="${1:-}"
if [ -z "$DESTINATION" ]; then
  echo "usage: export-staged-snapshot.sh <absolute-directory>" >&2
  exit 2
fi
# Git hooks use POSIX /tmp paths, while the Node-based self-test supplies a
# native Windows temporary path. Both forms are absolute destinations.
case "$DESTINATION" in
  /*|[A-Za-z]:/*|[A-Za-z]:\\*) ;;
  *) echo "snapshot directory must be absolute" >&2; exit 2 ;;
esac

mkdir -p "$DESTINATION"
git checkout-index --all --prefix="${DESTINATION%/}/"
