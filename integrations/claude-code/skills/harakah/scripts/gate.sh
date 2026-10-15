#!/usr/bin/env bash
# harakah gate <target> [options]
set -e
source "$(dirname "$0")/_bin.sh"
"${HF[@]}" gate "${1:-.}" "${@:2}"
