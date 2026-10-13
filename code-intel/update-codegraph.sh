#!/bin/sh
# Use the upstream standalone installer for both initial installs and upgrades.
# Resolve the release first so a no-op does not redownload the ~60 MB bundle.
set -eu

release_url="https://github.com/colbymchenry/codegraph/releases/latest"
version="$(curl --fail --silent --show-error --location --head \
  --output /dev/null --write-out '%{url_effective}' "$release_url")"
version="${version##*/}"
# Never execute an installer with an unresolved redirect or an arbitrary tag.
printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
  echo "  Could not resolve the latest Codegraph release: $version" >&2
  exit 1
}
if command -v codegraph >/dev/null 2>&1; then
  current="$(codegraph --version)"
  if [ "${current#v}" = "${version#v}" ]; then
    echo "  Codegraph is up to date ($version)"
    exit 0
  fi
  echo "  Updating Codegraph: $current -> $version"
else
  echo "  Installing Codegraph $version"
fi

installer="$(mktemp "${TMPDIR:-/tmp}/codegraph-install.XXXXXX")"
trap 'rm -f "$installer"' EXIT HUP INT TERM
curl --fail --silent --show-error --location \
  https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh \
  --output "$installer"
CODEGRAPH_VERSION="$version" sh "$installer"
# Detect a failed install or an older executable shadowing the new launcher.
actual="$(codegraph --version)"
[ "${actual#v}" = "${version#v}" ] || {
  echo "  Codegraph install mismatch: expected $version, got $actual. Check PATH." >&2
  exit 1
}
