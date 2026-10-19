import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCANNER = Path(__file__).resolve().parents[2] / "components/hooks/security/secret-scanner.py"
SPEC = importlib.util.spec_from_file_location("secret_scanner", SCANNER)
scanner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scanner)
SENTINEL = "AKIA" + "SENTINEL12345678"


class SecretScannerTests(unittest.TestCase):
    def run_hook(self, content):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", directory], check=True)
            (root / "credentials.py").write_text(content)
            subprocess.run(["git", "add", "credentials.py"], cwd=root, check=True)
            return subprocess.run(
                [sys.executable, str(SCANNER)], cwd=root,
                input=json.dumps({"tool_input": {"command": "git commit -m test"}}),
                capture_output=True, text=True, check=False,
            )

    def test_hook_blocks_without_disclosing_credentials(self):
        result = self.run_hook(f'key = "{SENTINEL}"\n')
        self.assertEqual(result.returncode, 2)
        self.assertIn("credentials.py:1", result.stderr)
        self.assertIn("AWS Access Key ID", result.stderr)
        self.assertIn("COMMIT BLOCKED", result.stderr)
        self.assertTrue(SENTINEL not in result.stdout + result.stderr, "Credential leaked in hook output")
        self.assertTrue(SENTINEL[:12] not in result.stderr, "Credential prefix leaked in hook output")

    def test_findings_retain_only_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "credentials.py"
            path.write_text(f'key = "{SENTINEL}"\n')
            findings = scanner.scan_file(str(path))
        self.assertTrue(findings)
        for finding in findings:
            self.assertEqual(set(finding), {"file", "line", "description", "severity"})
        self.assertTrue(SENTINEL not in json.dumps(findings), "Credential retained in scan results")

    def test_clean_file_remains_allowed(self):
        result = self.run_hook('message = "hello"\n')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
