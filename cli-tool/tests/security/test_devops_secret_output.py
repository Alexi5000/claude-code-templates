import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "components/skills/development/devops-iac-engineer/scripts/devops_utils.py"
SPEC = importlib.util.spec_from_file_location("devops_utils", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DevopsSecretOutputTests(unittest.TestCase):
    def test_findings_retain_location_and_type_without_secret_values(self):
        values = ["AKIA" + "A" * 16, "B" * 40, "private-password-123", "C" * 30]
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "config.env"
            file.write_text(
                f"# example configuration\n{values[0]}\napi_key={values[1]}\npassword={values[2]}\ntoken={values[3]}\n"
            )
            findings = MODULE.SecurityHelper.scan_secrets(directory)
            self.assertEqual(len(findings), 4)
            for line, kind in [(2, "AWS Access Key"), (3, "API Key"), (4, "Password"), (5, "Token")]:
                self.assertIn(f"{file}:{line}: {kind} - [REDACTED]", findings)
            for value in values:
                self.assertNotIn(value, "\n".join(findings))
                self.assertNotIn(value[:8], "\n".join(findings))

    def test_cli_reports_and_rejects_secrets_without_printing_them(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture_value = "AKIA" + "Z" * 16
            (Path(directory) / "config.env").write_text(fixture_value + "\n")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "security", "scan-secrets", "--directory", directory],
                capture_output=True, text=True, timeout=15,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("AWS Access Key", result.stdout)
            self.assertIn("[REDACTED]", result.stdout)
            self.assertNotIn(fixture_value, result.stdout + result.stderr)

    def test_clean_files_and_excluded_directories_remain_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "clean.py").write_text("value = 1\n")
            (root / "node_modules").mkdir()
            (root / "node_modules" / "fixture.env").write_text("AKIA" + "D" * 16)
            self.assertEqual(MODULE.SecurityHelper.scan_secrets(directory), [])
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "security", "scan-secrets", "--directory", directory],
                capture_output=True, text=True, timeout=15,
            )
            self.assertEqual(result.returncode, 0)
            self.assertIn("No secrets found", result.stdout)


if __name__ == "__main__":
    unittest.main()
