import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


VALIDATOR = Path(__file__).resolve().parents[2] / "components/skills/enterprise-communication/session-handoff/scripts/validate_handoff.py"
SPEC = importlib.util.spec_from_file_location("validate_handoff", VALIDATOR)
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)
SENTINEL = "handoff" + "PrivateCredential987654"
COMPLETE = "\n".join(
    f"## {section}\nThe implementation is complete and verified using isolated fixtures and repeatable checks.\n"
    for section in validator.REQUIRED_SECTIONS + validator.RECOMMENDED_SECTIONS
)


class HandoffPrivacyTests(unittest.TestCase):
    def run_validator(self, content):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "handoff.md"
            path.write_text(content)
            result = validator.validate_handoff(str(path))
            process = subprocess.run(
                [sys.executable, str(VALIDATOR), str(path)],
                capture_output=True, text=True, check=False,
            )
        return result, process

    def test_todo_with_credential_is_blocked_without_echoing_content(self):
        result, process = self.run_validator(f'[TODO: password="{SENTINEL}"]\n' + COMPLETE)
        self.assertEqual(process.returncode, 1)
        self.assertIn("BLOCKED", process.stdout)
        self.assertIn("Line 1", process.stdout)
        self.assertTrue(SENTINEL not in process.stdout + process.stderr)
        self.assertTrue(SENTINEL not in json.dumps(result))
        self.assertEqual(result["todo_count"], 1)
        self.assertTrue(result["secrets_found"])

    def test_unrecognized_sensitive_todo_also_stays_private(self):
        result, process = self.run_validator(f"[TODO: {SENTINEL}]\n" + COMPLETE)
        self.assertEqual(result["score"], 70)
        self.assertEqual(result["secrets_found"], [])
        self.assertTrue(SENTINEL not in process.stdout + process.stderr)
        self.assertTrue(SENTINEL not in json.dumps(result))

    def test_multiline_and_repeated_todos_keep_count_and_locations(self):
        content = "header\n[TODO: first\nsecond]\n[TODO: third] [TODO: fourth]\n"
        clear, locations = validator.check_todos(content)
        self.assertFalse(clear)
        self.assertEqual(locations, ["Line 2", "Line 4", "Line 4"])
        result, process = self.run_validator(content * 3 + COMPLETE)
        self.assertEqual(result["todo_count"], 9)
        self.assertEqual(len(result["remaining_todos"]), 5)
        self.assertIn("9 TODO placeholders found", process.stdout)

    def test_complete_handoff_still_succeeds(self):
        result, process = self.run_validator(COMPLETE)
        self.assertEqual(process.returncode, 0)
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["remaining_todos"], [])
        self.assertIn("READY for handoff", process.stdout)

    def test_path_shaped_private_todo_is_not_echoed_as_missing_file(self):
        result, process = self.run_validator(f"[TODO: `private/{SENTINEL}.md`]\n" + COMPLETE)
        self.assertTrue(SENTINEL not in process.stdout + process.stderr)
        self.assertTrue(SENTINEL not in json.dumps(result))
        self.assertEqual(result["files_missing"], [])

    def test_ordinary_file_references_are_still_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "docs/ready.md").write_text("Ready")
            existing, missing = validator.check_file_references(
                "`docs/ready.md` and `docs/missing.md`", directory
            )
        self.assertEqual(existing, ["docs/ready.md"])
        self.assertEqual(missing, ["docs/missing.md"])


if __name__ == "__main__":
    unittest.main()
