import contextlib
import importlib.util
import io
import os
from pathlib import Path
import secrets
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2] / "components/skills/scientific"


def load_script(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SetupSecretOutputTests(unittest.TestCase):
    def setUp(self):
        self.secret = secrets.token_hex(24)
        self.perplexity = load_script("perplexity_setup", "perplexity-search/scripts/setup_env.py")
        self.biomni = load_script("biomni_setup", "biomni/scripts/setup_environment.py")

    def test_perplexity_setup_saves_key_without_printing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            target = str(Path(directory) / ".env")
            output = io.StringIO()
            with patch.object(sys, "argv", ["setup_env.py", "--api-key", self.secret, "--env-file", target]):
                with contextlib.redirect_stdout(output):
                    self.assertEqual(self.perplexity.main(), 0)
            self.assertIn(self.secret, Path(target).read_text())
            self.assertNotIn(self.secret, output.getvalue())
            self.assertIn("<your-key>", output.getvalue())

    def test_perplexity_validation_does_not_print_key_fragments(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": self.secret}):
            with patch.dict(sys.modules, {"litellm": types.SimpleNamespace(__version__="test")}):
                with contextlib.redirect_stdout(output):
                    self.assertTrue(self.perplexity.validate_setup())
        self.assertNotIn(self.secret[:8], output.getvalue())
        self.assertNotIn(self.secret[-4:], output.getvalue())

    def test_biomni_export_instructions_do_not_print_secrets(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.biomni.save_api_keys({"OPENAI_API_KEY": self.secret}, "shell_export")
        self.assertNotIn(self.secret, output.getvalue())
        self.assertIn("export OPENAI_API_KEY='<your-key>'", output.getvalue())

    def test_biomni_uses_hidden_input_for_all_providers(self):
        with patch.object(self.biomni, "getpass", return_value=self.secret, create=True) as hidden:
            with patch("builtins.input", side_effect=AssertionError("key entry must not echo")):
                with contextlib.redirect_stdout(io.StringIO()):
                    keys = self.biomni.setup_api_keys()
        self.assertEqual(hidden.call_count, 4)
        self.assertEqual(len(keys), 4)
        self.assertTrue(all(value == self.secret for value in keys.values()))


if __name__ == "__main__":
    unittest.main()
