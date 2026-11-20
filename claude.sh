#!/usr/bin/env bash
# Abre o Claude Code nesta pasta, com Remote Control e a sessão nomeada pela pasta.
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
nome="$(basename "$dir")"
cd "$dir"
exec claude --dangerously-skip-permissions --name "$nome" --remote-control "$nome" "$@"
