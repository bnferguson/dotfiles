#!/usr/bin/env bash
# Compile every example in this skill and run its tests.
#
# The examples are the skill's claim that its idioms are current. A Zig release
# can invalidate them silently -- 0.16 removed `@Type`, `std.Thread.Mutex` and
# `std.posix.close` out from under three of these files at once. Run this after
# any toolchain bump.
#
#   ./check.sh                 # uses `zig` from PATH
#   ZIG="mise x zig@0.16.0 -- zig" ./check.sh
set -uo pipefail

ZIG=${ZIG:-zig}
cd "$(dirname "$0")/examples" || exit 1

failed=0
for file in *.zig; do
    if output=$($ZIG test "$file" 2>&1); then
        printf 'PASS  %-34s %s\n' "$file" "$(printf '%s' "$output" | tail -n1)"
    else
        printf 'FAIL  %s\n' "$file"
        printf '%s\n' "$output" | sed 's/^/      /'
        failed=$((failed + 1))
    fi
done

if [ "$failed" -ne 0 ]; then
    printf '\n%d example(s) failing on %s\n' "$failed" "$($ZIG version)"
    exit 1
fi
printf '\nAll examples pass on Zig %s\n' "$($ZIG version)"
