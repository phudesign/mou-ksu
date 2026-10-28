#!/usr/bin/env bash
# เรนเดอร์ manifests ตาม config.env โดยยังไม่ apply (สำหรับตรวจก่อนขึ้น)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
render_all
ls -la "${GENERATED}"
