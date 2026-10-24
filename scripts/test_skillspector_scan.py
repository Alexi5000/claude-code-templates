import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import skillspector_scan as scanner


class ScannerTests(unittest.TestCase):
    def test_timeout_is_an_error(self):
        with patch.object(scanner.subprocess, "run", side_effect=subprocess.TimeoutExpired("skillspector", 180)) as run:
            self.assertEqual(scanner.scan_skill(Path("fixture"))["status"], "error")
            self.assertEqual(run.call_args.kwargs["timeout"], 180)

    def test_unexpected_exit_cannot_report_success(self):
        result = subprocess.CompletedProcess([], 3, stdout=json.dumps({"score": 0}), stderr="crash")
        with patch.object(scanner.subprocess, "run", return_value=result):
            self.assertEqual(scanner.scan_skill(Path("fixture"))["status"], "error")

    def test_reviewed_exception_invalidates_when_referenced_source_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill = root / "skills/fixture"
            baselines = root / "baselines"
            skill.mkdir(parents=True)
            baselines.mkdir()
            (skill / "SKILL.md").write_text("Read reference.md")
            reference = skill / "reference.md"
            reference.write_text("Reviewed source")
            (baselines / "fixture.json").write_text(json.dumps({"version": 2, "scanner_version": "2.12.0", "rules": [], "fingerprints": []}))
            (baselines / "manifest.json").write_text(json.dumps({"fixture": {"source_tree_sha256": scanner.skill_tree_hash(skill), "baseline": "fixture.json"}}))
            with patch.object(scanner, "BASELINES_ROOT", baselines), patch.object(scanner, "SKILLS_ROOT", root / "skills"):
                self.assertIn("--baseline", scanner.reviewed_baseline_args(skill))
                reference.write_text("Changed unreviewed source")
                self.assertEqual(scanner.reviewed_baseline_args(skill), [])

    def test_native_report_locations_and_rule_ids_are_preserved(self):
        report = {"risk_assessment": {"score": 60}, "issues": [{"id": "TEST", "severity": "HIGH", "location": {"file": "script.py", "start_line": 12}, "explanation": "Fixture finding"}]}
        with patch.object(scanner.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, stdout=json.dumps(report))), patch.object(scanner, "reviewed_baseline_args", return_value=[]):
            result = scanner.scan_skill(Path("fixture"))
        finding = scanner._aggregate_sarif([result])["runs"][0]["results"][0]
        self.assertEqual(finding["ruleId"], "TEST")
        self.assertEqual(finding["message"]["text"], "Fixture finding")
        self.assertEqual(finding["locations"][0]["physicalLocation"]["artifactLocation"]["uri"], "fixture/script.py")
        self.assertEqual(finding["locations"][0]["physicalLocation"]["region"]["startLine"], 12)

    def test_unsuccessful_or_malformed_report_is_not_a_clean_scan(self):
        for report in ({"execution_successful": False, "risk_assessment": {"score": 0}}, {}, [], {"risk_assessment": {"score": -1}}):
            with self.subTest(report=report), patch.object(scanner.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(report))), patch.object(scanner, "reviewed_baseline_args", return_value=[]):
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
