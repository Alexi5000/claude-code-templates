import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import skillspector_scan as scanner


class ScannerTests(unittest.TestCase):
    def test_timeout_is_an_error(self):
        with patch.object(scanner.subprocess, "run", side_effect=subprocess.TimeoutExpired("skillspector", 180)):
            self.assertEqual(scanner.scan_skill(Path("fixture"))["status"], "error")

    def test_unexpected_exit_cannot_report_success(self):
        result = subprocess.CompletedProcess([], 3, stdout=json.dumps({"score": 0}), stderr="crash")
        with patch.object(scanner.subprocess, "run", return_value=result):
            self.assertEqual(scanner.scan_skill(Path("fixture"))["status"], "error")

    def test_scan_errors_fail_closed_and_write_reports(self):
        with tempfile.TemporaryDirectory() as tmp:
            md, sarif = Path(tmp) / "report.md", Path(tmp) / "report.sarif"
            with patch("sys.argv", ["scan", "--all", "--output-md", str(md), "--output-sarif", str(sarif)]), patch.object(scanner, "discover_all_skills", return_value=[Path("fixture")]), patch.object(scanner, "scan_skill", return_value={"path": "fixture", "status": "error", "error": "fixture failure"}):
                self.assertEqual(scanner.main(), 1)
            self.assertTrue(md.exists())
            self.assertTrue(sarif.exists())


if __name__ == "__main__":
    unittest.main()
