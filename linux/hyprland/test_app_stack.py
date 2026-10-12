import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("app-stack")


def window(name, x=0):
    return dict(address=f"0x{name}", **{"class": name}, title=name,
                workspace={"id": 1 if name == "editor" else 3},
                grouped=[], at=[x, 0], size=[100, 100])


def fake_hyprctl():
    path = Path(os.environ["STACK_STATE"])
    with path.with_suffix(".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = json.loads(path.read_text())
        args = sys.argv[2:]
        clients = state["clients"]
        active = next((w for w in clients if w["address"] == state["active"]), {})
        result = "ok"
        if args[0] == "activewindow":
            result = json.dumps(active)
        elif args[0] == "clients":
            for pending in state["pending"][:]:
                pending["reads"] -= 1
                if pending["reads"] == 0:
                    clients.append(pending["window"])
                    state["pending"].remove(pending)
            result = json.dumps(clients)
        elif args[0] == "launch":
            state["launched"].append(args[1])
            state["pending"].append({"reads": 2, "window": window(args[1], 100)})
        elif args[0] == "getoption":
            result = json.dumps({"int": state["follow_mouse"]})
        elif args[0] == "eval":
            state["follow_mouse"] = int(re.search(r"follow_mouse\s*=\s*(\d+)", args[1])[1])
        elif args[0] == "keyword":
            path.write_text(json.dumps(state))
            print("error: keyword is unavailable in Lua configs")
            sys.exit(1)
        elif args[0] == "dispatch":
            code = " ".join(args[1:])
            state["dispatches"].append(code)
            if not code.startswith("hl.dsp."):
                path.write_text(json.dumps(state))
                print("error: dispatch in lua requires hl.dsp syntax")
                sys.exit(1)
            address = re.search(r'window\s*=\s*"address:([^\"]+)"', code)
            target = next((w for w in clients if address and w["address"] == address[1]), active)
            if code.startswith("hl.dsp.focus"):
                state["active"] = target["address"]
            elif code.startswith("hl.dsp.group.next"):
                group = active["grouped"]
                if group:
                    state["active"] = group[(group.index(active["address"]) + 1) % len(group)]
            elif code.startswith("hl.dsp.group.toggle"):
                group = target["grouped"]
                if group:
                    for w in clients:
                        if w["address"] in group:
                            w["grouped"] = []
                else:
                    target["grouped"] = [target["address"]]
            elif "into_group" in code:
                anchor = next(w for w in clients if w["grouped"] and w is not target)
                group = anchor["grouped"] + [target["address"]]
                for w in clients:
                    if w["address"] in group:
                        w["grouped"] = group
            elif "workspace" in code:
                target["workspace"]["id"] = int(re.search(r'workspace\s*=\s*"(\d+)"', code)[1])
        else:
            raise AssertionError(args)
        path.write_text(json.dumps(state))
        print(result)


class AppStackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state_path = self.root / "state.json"
        stub = self.root / "hyprctl"
        stub.write_text(f"#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(Path(__file__).resolve()))} --hyprctl \"$@\"\n")
        stub.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{self.root}:{os.environ['PATH']}",
                        STACK_STATE=str(self.state_path), XDG_RUNTIME_DIR=str(self.root))

    def run_stack(self, clients, active="0xeditor", members=("slack", "discord")):
        self.state_path.write_text(json.dumps(dict(clients=clients, active=active,
            pending=[], launched=[], dispatches=[], follow_mouse=1)))
        result = subprocess.run([str(SCRIPT)] + [f"{name}|hyprctl launch {name}" for name in members],
                                env=self.env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(self.state_path.read_text())

    def assert_stack(self, state):
        self.assertEqual({w["class"] for w in state["clients"] if w["class"] in ("slack", "discord")},
                         {"slack", "discord"})
        for w in state["clients"]:
            if w["class"] in ("slack", "discord"):
                self.assertEqual(set(w["grouped"]), {"0xslack", "0xdiscord"})
                self.assertEqual(w["workspace"]["id"], 3)
        self.assertEqual(state["follow_mouse"], 1)

    def grouped(self):
        clients = [window("slack"), window("discord", 100), window("editor")]
        for w in clients[:2]:
            w["grouped"] = ["0xslack", "0xdiscord"]
        return clients

    def test_summon_builds_group_and_focuses_other_workspace(self):
        state = self.run_stack([window("slack"), window("discord", 100), window("editor")])
        self.assert_stack(state)
        self.assertEqual(state["active"], "0xslack")

    def test_summon_existing_group(self):
        state = self.run_stack(self.grouped())
        self.assert_stack(state)
        self.assertEqual(state["active"], "0xslack")
        self.assertEqual(len(state["dispatches"]), 1)

    def test_repeat_cycles_complete_group(self):
        state = self.run_stack(self.grouped(), "0xslack")
        self.assertEqual(state["active"], "0xdiscord")
        self.assertEqual(len(state["dispatches"]), 1)

    def test_focused_ungrouped_member_repairs_stack(self):
        state = self.run_stack([window("slack"), window("discord", 100)], "0xslack")
        self.assert_stack(state)

    def test_missing_member_relaunches_while_stack_focused(self):
        slack = window("slack")
        slack["grouped"] = ["0xslack"]
        state = self.run_stack([slack], "0xslack")
        self.assertEqual(state["launched"], ["discord"])
        self.assert_stack(state)

    def test_missing_member_joins_on_same_press_from_other_workspace(self):
        state = self.run_stack([window("slack"), window("editor")])
        self.assertEqual(state["launched"], ["discord"])
        self.assert_stack(state)

    def test_cold_launch_waits_and_groups(self):
        state = self.run_stack([window("editor")])
        self.assertEqual(set(state["launched"]), {"slack", "discord"})
        self.assert_stack(state)
        self.assertEqual(state["active"], "0xslack")

    def test_partial_group_rebuilds_with_three_members(self):
        clients = self.grouped()[:2] + [window("signal", 200)]
        state = self.run_stack(clients, "0xslack", ("slack", "discord", "signal"))
        for w in state["clients"]:
            self.assertEqual(set(w["grouped"]), {"0xslack", "0xdiscord", "0xsignal"})
        self.assertEqual(state["follow_mouse"], 1)


if __name__ == "__main__":
    if sys.argv[1:] == [] or sys.argv[1] != "--hyprctl":
        unittest.main()
    else:
        fake_hyprctl()
