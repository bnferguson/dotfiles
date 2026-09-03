import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SKILL_ROOT = Path(__file__).parents[1]


def load_script(name: str):
    path = SKILL_ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


detect_version = load_script("detect_version")
get_references = load_script("get_references")


class VersionSupportTest(unittest.TestCase):
    def test_0_16_uses_its_own_reference_set(self):
        result = get_references.get_reference_path_for_version("0.16.0")

        self.assertEqual("0.16.0", result["reference_version"])
        self.assertEqual("references/v0.16.0", result["path"])
        self.assertTrue(result["exists"])
        self.assertFalse(result["fallback"])
        self.assertTrue((SKILL_ROOT / result["path"] / "io.md").is_file())

    def test_unversioned_project_defaults_to_0_16(self):
        with tempfile.TemporaryDirectory() as directory:
            detector = detect_version.ZigVersionDetector(Path(directory))

            with mock.patch.object(detector, "_detect_from_command", return_value=None):
                result = detector.detect()

        self.assertEqual("0.16.0", result["version"])
        self.assertEqual("default", result["source"])

    def test_modern_lower_bound_marker_uses_current_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "main.zig").write_text(
                "pub fn main() void { for (items, 0..) |item, index| {} }"
            )
            detector = detect_version.ZigVersionDetector(project)

            with mock.patch.object(detector, "_detect_from_command", return_value=None):
                result = detector.detect()

        self.assertEqual("0.16.0", result["version"])
        self.assertEqual("source_syntax_for_loop", result["source"])

    def test_io_async_method_is_not_legacy_async_syntax(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "main.zig").write_text(
                "fn run(io: anytype) void { "
                "var task = io.async(work, .{}); "
                "for (items, 0..) |item, index| {} "
                "}"
            )
            detector = detect_version.ZigVersionDetector(project)

            with mock.patch.object(detector, "_detect_from_command", return_value=None):
                result = detector.detect()

        self.assertEqual("0.16.0", result["version"])


if __name__ == "__main__":
    unittest.main()
