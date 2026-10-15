#!/usr/bin/env bash
# Resolve the harakah-fix CLI: $HARAKAH_FIX, a project-local install, a global install, or $HARAKAH_HOME.
if [ -n "$HARAKAH_FIX" ]; then HF=($HARAKAH_FIX)
elif [ -x "./node_modules/.bin/harakah-fix" ]; then HF=(./node_modules/.bin/harakah-fix)
elif command -v harakah-fix >/dev/null 2>&1; then HF=(harakah-fix)
elif [ -n "$HARAKAH_HOME" ] && [ -f "$HARAKAH_HOME/dist/cli.js" ]; then HF=(node "$HARAKAH_HOME/dist/cli.js")
else echo "harakah-fix not found: npm i -D harakah-fixer (or set HARAKAH_HOME)" >&2; exit 2; fi
