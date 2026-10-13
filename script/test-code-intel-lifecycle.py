#!/usr/bin/env python3
"""Lifecycle regression tests. All backend commands are disposable stubs."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

CI = Path(__file__).resolve().parents[1] / "bin/code-intel"
STUB = r'''import json, os, pathlib, shutil, signal, sys, time
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['FIXTURE'])
def record(event):
    with (root / 'events').open('a') as f:
        f.write(json.dumps([name, event]) + '\n')
record(args)
if name == 'git':
    if args[:2] == ['worktree', 'list']:
        print('worktree ' + str(root / 'source'))
    else:
        print(os.getcwd())
    sys.exit(0)
if name == 'cp':
    sys.exit(9)
if name == 'graphify' and args[0] == 'update':
    assert os.environ.get('GRAPHIFY_FORCE') == '0'
if name == 'vera' and args[0] == 'watch':
    def stop(sig, frame):
        record('INT')
        time.sleep(1.5)
        record('stopped')
        sys.exit(0)
    signal.signal(signal.SIGINT, stop)
    while True:
        time.sleep(.1)
fail = os.environ.get('FAIL', '')
if fail == name + ':' + args[0]:
    print('deliberate failure', file=sys.stderr)
    sys.exit(7)
if fail == 'vera:restore' and name == 'vera' and args[0] == 'index':
    watchdir = pathlib.Path(os.environ['XDG_STATE_HOME']) / 'code-intel/watch'
    shutil.rmtree(watchdir)
    watchdir.touch()
if name == 'codegraph' and args[0] == 'status':
    status = {'initialized': True, 'lastIndexed': 'today', 'worktreeMismatch': None}
    if fail == 'codegraph:mismatch':
        status['worktreeMismatch'] = {'expected': 'another worktree'}
    elif fail == 'codegraph:uninitialized':
        status['initialized'] = False
    elif fail == 'codegraph:unindexed':
        status['lastIndexed'] = None
    print(json.dumps(status))
elif name == 'vera' and args[0] == 'search':
    print('[]')
elif name == 'graphify' and args[0] == 'god-nodes':
    print('not JSON' if fail == 'graphify:malformed' else '[]')
'''


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name in ('vera', 'codegraph', 'graphify', 'git', 'cp'):
            p = self.bin / name
            p.write_text('#!' + sys.executable + '\n' + STUB)
            p.chmod(0o700)
        self.env = dict(os.environ, PATH=str(self.bin) + ':' + os.environ['PATH'],
                        XDG_STATE_HOME=str(self.root / 'state'), FIXTURE=str(self.root),
                        CODE_INTEL_WATCH_CHECK_SEC='1', CODE_INTEL_WATCH_IDLE_MIN='999')

    def run_ci(self, *args, fail=''):
        return subprocess.run([str(CI), *args], cwd=self.repo,
                              env=dict(self.env, FAIL=fail), text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)

    def events(self):
        p = self.root / 'events'
        try:
            return [json.loads(line) for line in p.read_text().splitlines()]
        except (FileNotFoundError, json.JSONDecodeError):
            # A live stub can be in the middle of appending a record.
            return []

    def until(self, predicate):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(.05)
        self.fail('stub lifecycle did not settle')

    def tearDown(self):
        # Only fixture supervisors/watchers can be involved here.
        self.run_ci('watch', '--stop')
        self.until(lambda: not list((self.root / 'state/code-intel/watch').glob('*.pid')))
        self.tmp.cleanup()

    def test_aggregate_failure_and_private_retained_logs(self):
        result = self.run_ci('init', fail='vera:index')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('vera: exit 7', result.stdout)
        self.assertIn('codegraph: exit 0', result.stdout)
        self.assertIn('graphify: exit 0', result.stdout)
        state = self.root / 'state/code-intel'
        logdir = Path((state / 'latest-log').read_text().strip())
        self.assertEqual(logdir.stat().st_mode & 0o777, 0o700)
        for log in logdir.glob('*.log'):
            self.assertEqual(log.stat().st_mode & 0o077, 0)
        self.assertIn('deliberate failure', (logdir / 'vera.log').read_text())
        self.assertEqual(self.run_ci('refresh').returncode, 0)
        self.assertTrue(logdir.exists())

    def test_graphify_failure_is_not_swallowed(self):
        for cmd in ('init', 'refresh'):
            with self.subTest(cmd=cmd):
                result = self.run_ci(cmd, fail='graphify:update')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('graphify: exit 7', result.stdout)

    def test_codegraph_init_failure_prevents_index(self):
        self.assertNotEqual(self.run_ci('repair', 'codegraph', fail='codegraph:init').returncode, 0)
        self.assertEqual(self.events(), [['codegraph', ['init']]])

    def test_missing_explicit_backend_fails(self):
        old_path = self.env['PATH']
        self.env['PATH'] = str(self.root / 'missing-tools')
        try:
            for backend in ('vera', 'codegraph', 'graphify'):
                result = self.run_ci('repair', backend)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('not installed', result.stdout)
        finally:
            self.env['PATH'] = old_path

    def test_readiness_failure(self):
        for fail in ('vera:search', 'codegraph:status', 'graphify:god-nodes',
                     'codegraph:mismatch', 'codegraph:uninitialized',
                     'codegraph:unindexed', 'graphify:malformed'):
            backend = fail.split(':')[0]
            for command in (('init',), ('repair', backend)):
                with self.subTest(fail=fail, command=command):
                    result = self.run_ci(*command, fail=fail)
                    self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_warm_copy_failure_prevents_reconciliation(self):
        source = self.root / 'source'
        source.mkdir()
        for name in ('.vera', '.codegraph', 'graphify-out'):
            (source / name).mkdir()
        self.assertNotEqual(self.run_ci('warm').returncode, 0)
        self.assertFalse(any(name in ('vera', 'codegraph', 'graphify') for name, _ in self.events()))

    def test_repairs_are_explicit_and_non_destructive(self):
        self.assertNotEqual(self.run_ci('repair').returncode, 0)
        self.assertNotEqual(self.run_ci('repair', 'all').returncode, 0)
        for backend in ('vera', 'codegraph', 'graphify'):
            self.assertEqual(self.run_ci('repair', backend).returncode, 0)
        events = self.events()
        self.assertIn(['vera', ['index', str(self.repo), '--potion-code', '--no-progress']], events)
        self.assertIn(['codegraph', ['init']], events)
        self.assertIn(['codegraph', ['index', str(self.repo)]], events)
        self.assertIn(['graphify', ['update', str(self.repo)]], events)
        self.assertFalse(any('--force' in args for _, args in events))
        self.assertFalse(any(name == 'vera' and args[0] == 'watch' for name, args in events))

    def test_init_coordinates_existing_watcher(self):
        (self.repo / '.vera').mkdir()
        self.run_ci('watch', '--ensure')
        self.until(lambda: ['vera', ['watch', '.']] in self.events())
        result = self.run_ci('init')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.until(lambda: self.events().count(['vera', ['watch', '.']]) == 2)
        events = self.events()
        self.assertLess(events.index(['vera', 'stopped']),
                        events.index(['vera', ['index', str(self.repo), '--potion-code', '--no-progress']]))
        self.assertIn(['vera', ['search', 'code', '--limit', '1', '--json']], events)

    def test_watcher_restore_failure_makes_successful_rebuild_fail(self):
        (self.repo / '.vera').mkdir()
        self.run_ci('watch', '--ensure')
        self.until(lambda: ['vera', ['watch', '.']] in self.events())
        result = self.run_ci('repair', 'vera', fail='vera:restore')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('watcher restoration failed', result.stdout)
        self.assertIn(['vera', ['search', 'code', '--limit', '1', '--json']], self.events())

    def test_watcher_wait_and_restore_even_when_rebuild_fails(self):
        (self.repo / '.vera').mkdir()
        self.assertEqual(self.run_ci('watch', '--ensure').returncode, 0)
        self.until(lambda: ['vera', ['watch', '.']] in self.events())
        start = time.monotonic()
        result = self.run_ci('repair', 'vera', fail='vera:index')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertGreaterEqual(time.monotonic() - start, 1.5)
        self.until(lambda: self.events().count(['vera', ['watch', '.']]) == 2)
        events = self.events()
        self.assertLess(events.index(['vera', 'stopped']),
                        events.index(['vera', ['index', str(self.repo), '--potion-code', '--no-progress']]))
        self.assertIn(['vera', 'INT'], events)
        source = CI.read_text()
        self.assertNotIn('kill -KILL', source)
        self.assertNotIn('kill -TERM "$1"', source)


if __name__ == '__main__':
    unittest.main()
