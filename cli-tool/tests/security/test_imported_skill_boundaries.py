import importlib.util
import os
import subprocess
import socket
import shlex
import json
from html.parser import HTMLParser
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch, MagicMock
import types
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "components" / "skills"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ImportedSkillBoundaries(unittest.TestCase):
    def test_atlas_api_does_not_forward_credentials_on_redirect(self):
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                self.send_response(302)
                self.send_header("Location", "/capture")
                self.end_headers()

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            atlas = load("atlas_boundary", ROOT / "media/speech/scripts/atlas_text_to_speech.py")
            with self.assertRaises(RuntimeError):
                atlas._request_json(f"http://127.0.0.1:{server.server_port}/request", api_key="fixture", method="GET")
            self.assertEqual(requests, ["/request"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_atlas_download_pins_public_ip_and_keeps_tls_hostname(self):
        atlas = load("atlas_pin_boundary", ROOT / "media/speech/scripts/atlas_text_to_speech.py")
        public = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        with patch.object(atlas.socket, "getaddrinfo", return_value=public) as dns:
            addresses = atlas._validate_download_url("https://audio.example/file.mp3")
        self.assertEqual(dns.call_count, 1)
        context = MagicMock()
        context.verify_mode = 2
        context.check_hostname = True
        connection = atlas._PinnedHTTPSConnection("audio.example", addresses=addresses, context=context)
        with patch.object(atlas.socket, "create_connection", return_value=MagicMock()) as connect, patch.object(atlas.socket, "getaddrinfo", side_effect=AssertionError("Hostname must not resolve again")):
            connection.connect()
        self.assertEqual(connect.call_args.args[0], ("93.184.216.34", 443))
        self.assertEqual(context.wrap_socket.call_args.kwargs["server_hostname"], "audio.example")

    def test_atlas_rejects_private_redirects_and_benchmark_dns(self):
        atlas = load("atlas_redirect_boundary", ROOT / "media/speech/scripts/atlas_text_to_speech.py")
        with patch.object(atlas.socket, "getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.1", 443))]):
            with self.assertRaises(SystemExit):
                atlas._validate_download_url("https://audio.example/file.mp3")
        handler = atlas._SafeRedirectHandler()
        with self.assertRaises(SystemExit):
            handler.redirect_request(None, None, 302, "redirect", {}, "https://127.0.0.1/private")

    def test_soffice_shim_has_a_private_allocated_directory(self):
        module = load("office_boundary", ROOT / "document-processing/docx-official/scripts/office/soffice.py")
        try:
            self.assertEqual(module._SHIM_SO.parent.stat().st_mode & 0o777, 0o700)
            self.assertNotEqual(module._SHIM_SO.parent, Path(tempfile.gettempdir()))
        finally:
            module._SHIM_DIR.cleanup()

    def test_credential_save_rejects_symlinks_and_preserves_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "workorai").mkdir()
            outside = root / "outside"
            outside.write_text("untouched")
            target = root / "workorai/mcp-token"
            target.symlink_to(outside)
            env = {**os.environ, "XDG_CONFIG_HOME": tmp, "WORKORAI_DISABLE_OS_KEYSTORE": "1"}
            result = subprocess.run(["node", str(ROOT / "career/workorai/scripts/credential-store.mjs"), "save", "--shared-file"], input="wai_fixture_1234567890123456", text=True, capture_output=True, env=env)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(outside.read_text(), "untouched")
            target.unlink()
            result = subprocess.run(["node", str(ROOT / "career/workorai/scripts/credential-store.mjs"), "save", "--shared-file"], input="wai_fixture_1234567890123456", text=True, capture_output=True, env=env)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_recalculation_macro_isolated_from_user_profile(self):
        for skill in ("xlsx", "xlsx-official"):
            with self.subTest(skill=skill):
                sys.path.insert(0, str(ROOT / "document-processing" / skill / "scripts"))
                try:
                    with patch.dict(sys.modules, {"openpyxl": types.SimpleNamespace(load_workbook=lambda *args, **kwargs: None)}):
                        module = load("recalc_boundary", ROOT / "document-processing" / skill / "scripts/recalc.py")
                    try:
                        with patch.object(module.subprocess, "run") as run:
                            self.assertTrue(module.setup_libreoffice_macro())
                        macro = Path(module._PROFILE.name) / "user/basic/Standard/Module1.xba"
                        self.assertTrue(macro.is_file())
                        self.assertIn(f"-env:UserInstallation={module._PROFILE_URL}", run.call_args.args[0])
                        self.assertEqual(Path(module._PROFILE.name).stat().st_mode & 0o777, 0o700)
                    finally:
                        module._PROFILE.cleanup()
                finally:
                    sys.path.pop(0)

    @unittest.skipIf(os.name == "nt", "POSIX process-group regression")
    def test_server_wrappers_stop_their_spawned_server(self):
        for skill in ("security/webapp-testing", "development/webapp-testing"):
            with self.subTest(skill=skill):
                with socket.socket() as reservation:
                    reservation.bind(("127.0.0.1", 0))
                    port = reservation.getsockname()[1]
                command = f"{shlex.quote(sys.executable)} -m http.server {port} --bind 127.0.0.1"
                result = subprocess.run([sys.executable, str(ROOT / skill / "scripts/with_server.py"), "--server", command, "--port", str(port), "--", sys.executable, "-c", "pass"], capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                with socket.socket() as probe:
                    self.assertNotEqual(probe.connect_ex(("127.0.0.1", port)), 0)

    def test_eval_renderer_preserves_hostile_text_without_html_execution(self):
        class Tags(HTMLParser):
            def __init__(self):
                super().__init__()
                self.tags = []
            def handle_starttag(self, tag, attrs):
                self.tags.append(tag)

        attack = '</script><img src=x onerror=alert(1)><script>__SKILL_NAME_PLACEHOLDER____SKILL_DESCRIPTION_PLACEHOLDER__'
        for skill in ("development/skill-creator", "development/skill-development", "productivity/skill-creator"):
            with self.subTest(skill=skill):
                module = load("render_boundary", ROOT / skill / "scripts/render_eval_review.py")
                output = module.render_eval_review([{"query": attack, "should_trigger": True}], attack + '";alert(2)//', attack)
                parser = Tags()
                parser.feed(output)
                self.assertNotIn("img", parser.tags)
                self.assertEqual(parser.tags.count("script"), 1)
                embedded = output.split("const EVAL_DATA = ", 1)[1].split(";", 1)[0]
                self.assertEqual(json.loads(embedded)[0]["query"], attack)

    def test_eval_names_cannot_write_outside_commands(self):
        for skill in ("development/skill-creator", "development/skill-development", "productivity/skill-creator"):
            with self.subTest(skill=skill), tempfile.TemporaryDirectory() as tmp:
                sys.path.insert(0, str(ROOT / skill))
                try:
                    module = load("eval_boundary", ROOT / skill / "scripts/run_eval.py")
                    with self.assertRaises(ValueError):
                        module.run_single_query("fixture", "../../escape", "fixture", 1, tmp)
                    self.assertEqual(list(Path(tmp).iterdir()), [])
                finally:
                    sys.path.pop(0)


if __name__ == "__main__":
    unittest.main()
