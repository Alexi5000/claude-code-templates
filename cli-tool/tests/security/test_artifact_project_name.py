import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


class ArtifactProjectNames(unittest.TestCase):
    def test_unsafe_names_fail_before_install_or_node_invocation(self):
        for skill in ("artifacts-builder", "web-artifacts-builder"):
            script = ROOT / f"cli-tool/components/skills/development/{skill}/scripts/init-artifact.sh"
            for name in ("../outside", "--template", "app/../../outside", "app\ne touch /tmp/unwanted", "app&replacement", ""):
                with self.subTest(skill=skill, name=name), tempfile.TemporaryDirectory() as tmp:
                    marker = Path(tmp) / "node-was-called"
                    node = Path(tmp) / "node"
                    node.write_text('#!/bin/sh\ntouch "$MARKER"\necho v20.0.0\n')
                    node.chmod(0o755)
                    result = subprocess.run(["/bin/bash", str(script), name], env={**os.environ, "PATH": tmp, "MARKER": str(marker)}, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 1)
                    self.assertIn("single directory name", result.stderr)
                    self.assertFalse(marker.exists())

    def test_normal_project_name_reaches_runtime_check(self):
        for skill in ("artifacts-builder", "web-artifacts-builder"):
            script = ROOT / f"cli-tool/components/skills/development/{skill}/scripts/init-artifact.sh"
            result = subprocess.run(["/bin/bash", str(script), "my-app.v2_1"], env={**os.environ, "PATH": "/nonexistent"}, capture_output=True, text=True)
            self.assertNotIn("single directory name", result.stderr)
            self.assertIn("node: command not found", result.stderr)


if __name__ == "__main__":
    unittest.main()
