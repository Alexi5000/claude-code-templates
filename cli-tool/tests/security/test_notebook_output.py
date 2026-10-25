import argparse
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[3] / "cli-tool/components/skills/development/jupyter-notebook/scripts/new_notebook.py"
spec = importlib.util.spec_from_file_location("new_notebook", SOURCE)
notebook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notebook)


class NotebookOutput(unittest.TestCase):
    def test_creation_race_cannot_overwrite_another_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "example.ipynb"
            original = Path.open

            def raced_open(path, mode="r", *args, **kwargs):
                if path == output and mode in ("x", "w"):
                    with original(path, "w") as existing:
                        existing.write("preserve this")
                return original(path, mode, *args, **kwargs)

            args = argparse.Namespace(kind="experiment", title="Example", out=output, force=False)
            with patch.object(notebook, "parse_args", return_value=args), patch.object(Path, "open", raced_open):
                with self.assertRaises(FileExistsError):
                    notebook.main()
            self.assertEqual(output.read_text(), "preserve this")

    def test_normal_creation_and_explicit_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "example.ipynb"
            args = argparse.Namespace(kind="experiment", title="Example", out=output, force=False)
            with patch.object(notebook, "parse_args", return_value=args):
                notebook.main()
                with self.assertRaises(SystemExit):
                    notebook.main()
                args.force = True
                args.title = "Replacement"
                notebook.main()
            self.assertIn("Replacement", output.read_text())


if __name__ == "__main__":
    unittest.main()
