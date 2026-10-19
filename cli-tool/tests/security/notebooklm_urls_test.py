import importlib
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


SCRIPTS = Path(__file__).resolve().parents[2] / "components/skills/productivity/notebooklm/scripts"
sys.path.insert(0, str(SCRIPTS))
from url_validation import is_notebooklm_url


class NotebookURLTests(unittest.TestCase):
    def test_real_notebooks_and_login_query_parameters(self):
        for url in (
            "https://notebooklm.google.com",
            "https://notebooklm.google.com/notebook/abc",
            "https://NOTEBOOKLM.GOOGLE.COM:443/notebook/abc?return=accounts.google.com",
            "https://notebooklm.google.com/?name=Résumé#section",
        ):
            with self.subTest(url=url):
                self.assertTrue(is_notebooklm_url(url))

    def test_lookalikes_credentials_and_unsafe_schemes(self):
        for url in (
            "https://notebooklm.google.com.evil.test/",
            "https://evil.test/?next=https://notebooklm.google.com/",
            "https://notebooklm.google.com@evil.test/",
            "https://evil.test@notebooklm.google.com/",
            "https://notebooklm.google.com:444/",
            "http://notebooklm.google.com/",
            "https://notebooklm.google.com\\@evil.test/",
            "https://notebooklm.google.com/\n",
            "https://notebooklm.google.com./",
            "https://accounts.google.com/",
            "javascript:alert(1)", None,
        ):
            with self.subTest(url=url):
                self.assertFalse(is_notebooklm_url(url))

    def setUp(self):
        self.modules = patch.dict(sys.modules, {
            "patchright": MagicMock(), "patchright.sync_api": MagicMock(),
            "browser_utils": MagicMock(),
        })
        self.modules.start()
        sys.modules.pop("browser_session", None)
        sys.modules.pop("auth_manager", None)
        self.sessions = importlib.import_module("browser_session")
        self.auth = importlib.import_module("auth_manager")

    def tearDown(self):
        self.modules.stop()

    def test_rejects_bad_input_before_opening_browser(self):
        context = MagicMock()
        with self.assertRaises(ValueError):
            self.sessions.BrowserSession("test", context, "https://evil.test/")
        context.new_page.assert_not_called()

    def test_rejects_redirect_before_interacting_and_closes_page(self):
        context = MagicMock()
        context.new_page.return_value.url = "https://notebooklm.google.com.evil.test/"
        with self.assertRaises(RuntimeError):
            self.sessions.BrowserSession("test", context, "https://notebooklm.google.com/notebook/abc")
        context.new_page.return_value.wait_for_selector.assert_not_called()
        context.new_page.return_value.close.assert_called_once()

    def test_normal_notebook_initializes(self):
        context = MagicMock()
        context.new_page.return_value.url = "https://notebooklm.google.com/notebook/abc"
        session = self.sessions.BrowserSession("test", context, context.new_page.return_value.url)
        self.assertIs(session.page, context.new_page.return_value)
        session.page.wait_for_selector.assert_called_once()

    def test_later_navigation_cannot_receive_question(self):
        context = MagicMock()
        context.new_page.return_value.url = "https://notebooklm.google.com/notebook/abc"
        session = self.sessions.BrowserSession("test", context, context.new_page.return_value.url)
        session.page.url = "https://evil.test/"
        result = session.ask("private question")
        self.assertEqual(result["status"], "error")
        session.stealth.human_type.assert_not_called()

    def test_auth_validation_uses_actual_destination(self):
        manager = self.auth.AuthManager.__new__(self.auth.AuthManager)
        manager.is_authenticated = lambda: True
        context = MagicMock()
        self.auth.BrowserFactory.launch_persistent_context.return_value = context
        for url, expected in (
            ("https://notebooklm.google.com/?next=accounts.google.com", True),
            ("https://evil.test/?next=notebooklm.google.com", False),
            ("https://notebooklm.google.com.evil.test/", False),
        ):
            context.new_page.return_value.url = url
            self.assertEqual(manager.validate_auth(), expected)

    def test_auth_setup_never_saves_an_unexpected_destination(self):
        manager = self.auth.AuthManager.__new__(self.auth.AuthManager)
        manager._save_browser_state = MagicMock()
        manager._save_auth_info = MagicMock()
        context = MagicMock()
        self.auth.BrowserFactory.launch_persistent_context.return_value = context
        context.new_page.return_value.url = "https://evil.test/?next=notebooklm.google.com"
        self.assertFalse(manager.setup_auth())
        manager._save_browser_state.assert_not_called()
        manager._save_auth_info.assert_not_called()

    def test_auth_setup_accepts_completed_google_login(self):
        manager = self.auth.AuthManager.__new__(self.auth.AuthManager)
        manager._save_browser_state = MagicMock()
        manager._save_auth_info = MagicMock()
        context = MagicMock()
        page = context.new_page.return_value
        page.url = "https://accounts.google.com/"
        def finish_login(predicate, **kwargs):
            page.url = "https://notebooklm.google.com/notebook/abc"
            self.assertTrue(predicate(page.url))
        page.wait_for_url.side_effect = finish_login
        self.auth.BrowserFactory.launch_persistent_context.return_value = context
        self.assertTrue(manager.setup_auth())
        manager._save_browser_state.assert_called_once_with(context)
        manager._save_auth_info.assert_called_once()


if __name__ == "__main__":
    unittest.main()
