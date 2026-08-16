#!/bin/bash
# Ensure Deno is installed and on PATH in Claude Code remote sessions.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && exit 0

if ! command -v deno >/dev/null 2>&1 && [ ! -x "$HOME/.deno/bin/deno" ]; then
  curl -fsSL https://deno.land/install.sh | sh -s -- -y
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export PATH="$HOME/.deno/bin:$PATH"'
    echo 'export DENO_CERT=/etc/ssl/certs/ca-certificates.crt'
  } >>"$CLAUDE_ENV_FILE"
fi
