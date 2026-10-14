#!/usr/bin/env bash
# harakah fix <target> [options]
set -e
source "$(dirname "$0")/_bin.sh"
t="${1:-.}"; shift || true
if [[ "$t" =~ \.html?$ ]]; then "${HF[@]}" fix "$t" -o "$t" "$@"; else "${HF[@]}" fix "$t" --write --diff "$@"; fi
