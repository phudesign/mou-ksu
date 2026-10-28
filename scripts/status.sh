#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

kubectl -n "${NAMESPACE}" get pods,svc,route,pvc
echo
kubectl -n "${NAMESPACE}" get deploy
