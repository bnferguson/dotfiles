#!/usr/bin/env bash
# Compile every template and example in this skill and run its tests.
#
# `verify_recipes.py` covers recipes/. This covers the other thing the skill
# ships: assets/templates/ and examples/, which people copy verbatim. Nothing
# else checks them, and a Zig release can invalidate them silently.
#
#   ./scripts/check_files.sh
#   ZIG="mise x zig@0.16.0 -- zig" ./scripts/check_files.sh
set -uo pipefail

ZIG=${ZIG:-zig}
cd "$(dirname "$0")/.." || exit 1

failed=0

check() {
    local label=$1; shift
    local output
    if output=$("$@" 2>&1); then
        printf 'PASS  %-42s %s\n' "$label" "$(printf '%s' "$output" | tail -n1)"
    else
        printf 'FAIL  %s\n' "$label"
        printf '%s\n' "$output" | sed 's/^/      /'
        failed=$((failed + 1))
    fi
}

# Standalone files: `zig test` compiles the file and runs any test blocks.
# `build.zig` files are not standalone -- they are covered by the project below.
for file in assets/templates/*.zig assets/templates/cross-version/*.zig examples/*.zig; do
    case $(basename "$file") in
        build.zig | build-adaptive.zig) continue ;;
    esac
    # A file with @cImport needs libc headers on the command line, and the
    # self-hosted x86 backend miscompiles the resulting relocations -- so those
    # files also need -fllvm.
    if grep -q '@cImport' "$file"; then
        check "$file" $ZIG test "$file" -lc -fllvm
    else
        check "$file" $ZIG test "$file"
    fi
done

# The multi-file project exercises build.zig for real.
if [ -d examples/build_example ]; then
    check "examples/build_example (build test)" $ZIG build --build-file examples/build_example/build.zig test
    check "examples/build_example (build run)" $ZIG build --build-file examples/build_example/build.zig run
fi

if [ "$failed" -ne 0 ]; then
    printf '\n%d file(s) failing on %s\n' "$failed" "$($ZIG version)"
    exit 1
fi
printf '\nAll templates and examples pass on Zig %s\n' "$($ZIG version)"
