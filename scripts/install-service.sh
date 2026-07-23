#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bun_bin="$(command -v bun)"
codex_bin="$(command -v codex)"
runtime_path="$PATH"
curator_base_url="${CURATOR_BASE_URL:-http://localhost:3000}"
curator_trusted_origins="${CURATOR_TRUSTED_ORIGINS:-$curator_base_url}"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_dir"
sed -e "s|__PROJECT_DIR__|$project_dir|g" -e "s|__BUN_BIN__|$bun_bin|g" \
  -e "s|__CODEX_BIN__|$codex_bin|g" -e "s|__RUNTIME_PATH__|$runtime_path|g" \
  -e "s|__CURATOR_BASE_URL__|$curator_base_url|g" \
  -e "s|__CURATOR_TRUSTED_ORIGINS__|$curator_trusted_origins|g" \
  "$project_dir/deploy/instagram-curator.service" > "$unit_dir/instagram-curator.service"
systemctl --user daemon-reload
systemctl --user enable instagram-curator.service
systemctl --user restart instagram-curator.service
systemctl --user --no-pager status instagram-curator.service
