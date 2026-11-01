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

    def test_sarif_rules_carry_metadata(self):
        result = {"path": "skill", "status": "ok", "score": 80, "issues": [
            {"rule_id": "PE3", "severity": "MEDIUM", "category": "Privilege Escalation", "pattern": "credential path access", "message": "Reads ~/.ssh", "file": "a.py"}]}
        rules = scanner._aggregate_sarif([result], 50)["runs"][0]["tool"]["driver"]["rules"]
        self.assertEqual([r["id"] for r in rules], ["PE3"])
        self.assertEqual(rules[0]["name"], "Privilege Escalation")
        self.assertTrue(rules[0]["shortDescription"]["text"])
        self.assertTrue(rules[0]["help"]["text"])

    def test_sarif_threshold_drops_low_findings_on_low_score_skills(self):
        low = {"path": "low", "status": "ok", "score": 10, "issues": [
            {"rule_id": "E1", "severity": "LOW", "message": "minor"},
            {"rule_id": "PE2", "severity": "HIGH", "message": "serious"}]}
        high = {"path": "high", "status": "ok", "score": 90, "issues": [{"rule_id": "E1", "severity": "LOW", "message": "minor"}]}
        run = scanner._aggregate_sarif([low, high], 50)["runs"][0]
        self.assertEqual(sorted((r["ruleId"], r["locations"][0]["physicalLocation"]["artifactLocation"]["uri"]) for r in run["results"]), [("E1", "high"), ("PE2", "low")])
        self.assertEqual(len(scanner._aggregate_sarif([low, high])["runs"][0]["results"]), 3)

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

    def test_scan_timeout_is_configurable(self):
        with patch.object(scanner.subprocess, "run", side_effect=subprocess.TimeoutExpired("skillspector", 600)) as run:
            result = scanner.scan_skill(Path("fixture"), timeout=600, use_baselines=False)
            self.assertEqual(result["status"], "error")
            self.assertIn("600", result["error"])
            self.assertEqual(run.call_args.kwargs["timeout"], 600)
            self.assertNotIn("--baseline", run.call_args.args[0])

    def test_regression_rules(self):
        def res(score, *issues):
            return {"status": "ok", "score": score, "issues": [{"rule_id": r, "file": f, "severity": sev} for r, f, sev in issues]}
        head = res(100, ("E1", "SKILL.md", "HIGH"), ("P6", "SKILL.md", "MEDIUM"))
        self.assertTrue(scanner.is_regression(head, None), "new skills block")
        self.assertTrue(scanner.is_regression(head, {"status": "error"}), "base scan errors block")
        self.assertTrue(scanner.is_regression(head, res(80, ("E1", "SKILL.md", "HIGH"))), "higher score blocks")
        self.assertFalse(scanner.is_regression(head, res(100, ("E1", "SKILL.md", "HIGH"))))
        capped = res(100, ("E1", "SKILL.md", "HIGH"), ("E1", "SKILL.md", "HIGH"))
        self.assertTrue(scanner.is_regression(capped, res(100, ("E1", "SKILL.md", "HIGH"))), "extra HIGH finding blocks at capped score")
        moved = res(100, ("E1", "other.md", "HIGH"))
        self.assertTrue(scanner.is_regression(moved, res(100, ("E1", "SKILL.md", "HIGH"))), "HIGH finding in a new file blocks")

    def test_materialize_base_skill_reads_merge_base_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            skill = repo / "cli-tool/components/skills/cat/fixture"
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text("---\nname: old\n---\nbody\n")
            git = lambda *a: subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True)
            git("init", "-q")
            git("-c", "user.email=t@t", "-c", "user.name=t", "add", ".")
            git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base")
            base = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            (skill / "SKILL.md").write_text("---\nname: new\n---\nbody\n")
            out = Path(tmp) / "out"
            out.mkdir()
            cwd = Path.cwd()
            try:
                import os
                os.chdir(repo)
                copy = scanner.materialize_base_skill(Path("cli-tool/components/skills/cat/fixture"), base, out)
                self.assertEqual((copy / "SKILL.md").read_text(), "---\nname: old\n---\nbody\n")
                self.assertIsNone(scanner.materialize_base_skill(Path("cli-tool/components/skills/cat/missing"), base, out))
            finally:
                os.chdir(cwd)

    def test_compare_base_passes_preexisting_and_blocks_new(self):
        old = {"path": "cli-tool/components/skills/a/old", "name": "old", "status": "ok", "score": 90, "severity": "CRITICAL", "issues": [{"rule_id": "E1", "file": "SKILL.md", "severity": "HIGH"}]}
        new = {"path": "cli-tool/components/skills/a/new", "name": "new", "status": "ok", "score": 70, "severity": "HIGH", "issues": [{"rule_id": "AS1", "file": "SKILL.md", "severity": "HIGH"}]}

        def fake_materialize(directory, _commit, dest):
            return None if directory.name == "new" else dest / "old"

        def fake_scan(directory, timeout=180, use_baselines=True):
            self.assertFalse(use_baselines)
            return dict(old)

        for skills, expected in (([old], 0), ([old, new], 1)):
            with self.subTest(skills=[s["name"] for s in skills]), tempfile.TemporaryDirectory() as tmp:
                md, sarif = Path(tmp) / "report.md", Path(tmp) / "report.sarif"
                results = iter([dict(s) for s in skills])
                argv = ["scan", "--changed", "--compare-base", "--fail-on-risk", "--output-md", str(md), "--output-sarif", str(sarif)]
                with patch("sys.argv", argv), \
                        patch.object(scanner, "discover_changed_skills", return_value=[Path(s["path"]) for s in skills]), \
                        patch.object(scanner, "scan_skill", side_effect=lambda d, timeout=180, use_baselines=True: next(results) if use_baselines else fake_scan(d, timeout, use_baselines)), \
                        patch.object(scanner, "materialize_base_skill", side_effect=fake_materialize), \
                        patch.object(scanner, "merge_base", return_value="base"):
                    self.assertEqual(scanner.main(), expected)
                text = md.read_text()
                self.assertIn("Pre-existing findings", text)
                self.assertEqual("Flagged skills" in text, bool(expected))

    def test_compare_base_requires_changed(self):
        with patch("sys.argv", ["scan", "--all", "--compare-base"]), self.assertRaises(SystemExit):
            scanner.main()


if __name__ == "__main__":
    unittest.main()
