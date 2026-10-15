#!/usr/bin/env bash
# harakah check <target> [options]
set -e
source "$(dirname "$0")/_bin.sh"
"${HF[@]}" check "${1:-.}" "${@:2}"
