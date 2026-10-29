#!/usr/bin/env bash
set -eu
root="$(cd "$(dirname "$0")/.." && pwd -P)"
exec "$root/bin/pstack-sync" install
