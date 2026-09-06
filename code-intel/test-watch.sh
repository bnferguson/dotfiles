#!/bin/bash
# Lifecycle test for `code-intel watch`, using a stub vera that records how it
# was stopped. Verifies: idempotent ensure, graceful SIGINT stop, no orphans,
# pidfile hygiene, and the idle self-reap.
T=$(mktemp -d "${TMPDIR:-/tmp}/ci-test.XXXXXX")
mkdir -p "$T/repo/.vera" "$T/bin" "$T/state"
touch "$T/repo/.vera/metadata.db"; cd "$T/repo" || exit 1

cat > "$T/bin/vera" <<'EOF'
#!/bin/bash
[ "$1" = watch ] || exit 0
trap 'echo "clean-exit-on-INT" >> "$STUB_MARK"; rm -f "$STUB_PID"; exit 0' INT
echo $$ > "$STUB_PID"
while true; do sleep 0.2; done
EOF
chmod +x "$T/bin/vera"
export STUB_MARK="$T/mark" STUB_PID="$T/stub.pid"
export PATH="$T/bin:$PATH" XDG_STATE_HOME="$T/state"
export CODE_INTEL_WATCH_CHECK_SEC=2 CODE_INTEL_WATCH_IDLE_MIN=999
CI=/Users/bnferguson/.dotfiles/bin/code-intel
PIDDIR="$T/state/code-intel/watch"
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; rc=1; }
rc=0

"$CI" watch --status | grep -q 'no watchers' && pass "status: clean slate" || fail "status: clean slate"

"$CI" watch --ensure; sleep 2
STUB=$(cat "$T/stub.pid" 2>/dev/null)
REC=$(sed -n 2p "$PIDDIR"/*.pid 2>/dev/null)
[ -n "$STUB" ] && [ "$STUB" = "$REC" ] \
  && pass "ensure: tracked pid IS vera ($STUB)" \
  || fail "ensure: tracked pid $REC != actual vera $STUB"
"$CI" watch --status | grep -q "$T/repo" && pass "status: reports the repo" || fail "status: reports the repo"

BEFORE=$(sed -n 1p "$PIDDIR"/*.pid)
"$CI" watch --ensure; sleep 1
[ "$BEFORE" = "$(sed -n 1p "$PIDDIR"/*.pid)" ] && pass "ensure: idempotent" || fail "ensure: respawned"

"$CI" watch --stop >/dev/null
for i in $(seq 1 15); do kill -0 "$BEFORE" 2>/dev/null || break; sleep 1; done
kill -0 "$BEFORE" 2>/dev/null && fail "stop: supervisor survived ${i}s" || pass "stop: supervisor exited in ${i}s"
kill -0 "$STUB" 2>/dev/null && { fail "stop: vera orphaned (pid $STUB)"; kill -9 "$STUB"; } || pass "stop: no orphaned vera"
grep -q clean-exit-on-INT "$T/mark" 2>/dev/null && pass "stop: vera got SIGINT, not a hard kill" || fail "stop: vera was hard-killed"
ls "$PIDDIR"/*.pid >/dev/null 2>&1 && fail "stop: pidfile left behind" || pass "stop: pidfile removed"

# Idle self-reap: timeout below the check interval forces a reap on first check.
: > "$T/mark"
CODE_INTEL_WATCH_IDLE_MIN=0 CODE_INTEL_WATCH_CHECK_SEC=2 "$CI" watch --ensure
sleep 2
SUP=$(sed -n 1p "$PIDDIR"/*.pid 2>/dev/null)
for i in $(seq 1 20); do kill -0 "$SUP" 2>/dev/null || break; sleep 1; done
kill -0 "$SUP" 2>/dev/null && fail "idle: watcher never self-reaped" || pass "idle: self-reaped in ${i}s"
grep -q clean-exit-on-INT "$T/mark" 2>/dev/null && pass "idle: reaped via SIGINT" || fail "idle: reaped by hard kill"
ls "$PIDDIR"/*.pid >/dev/null 2>&1 && fail "idle: pidfile left behind" || pass "idle: pidfile removed"

# Vanishing worktree: a removed git worktree or deleted clone must stop the
# watcher promptly, not leave it watching a path that no longer exists until
# the idle timeout expires.
: > "$T/mark"
mkdir -p "$T/repo/.vera"; touch "$T/repo/.vera/metadata.db"; cd "$T/repo" || exit 1
CODE_INTEL_WATCH_CHECK_SEC=2 CODE_INTEL_WATCH_IDLE_MIN=999 "$CI" watch --ensure
sleep 2
SUP=$(sed -n 1p "$PIDDIR"/*.pid 2>/dev/null)
STUB=$(cat "$T/stub.pid" 2>/dev/null)
cd "$T" && rm -rf "$T/repo"
for i in $(seq 1 20); do kill -0 "$SUP" 2>/dev/null || break; sleep 1; done
kill -0 "$SUP" 2>/dev/null && fail "gone: watcher survived the dir being deleted" || pass "gone: watcher stopped in ${i}s"
kill -0 "$STUB" 2>/dev/null && { fail "gone: vera orphaned"; kill -9 "$STUB"; } || pass "gone: no orphaned vera"
grep -q clean-exit-on-INT "$T/mark" 2>/dev/null && pass "gone: reaped via SIGINT" || fail "gone: reaped by hard kill"

echo; [ "$rc" = 0 ] && echo "ALL PASS" || echo "FAILURES"; exit $rc
