import os
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
assert (root / 'cli-tool/analytics-ui/public/components/App.js').read_bytes() == (root / 'cli-tool/src/analytics-web/components/App.js').read_bytes(), 'Analytics routing source must match the shipped security implementation'
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or which('chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body='<div id="app"></div>'))
    page.goto('https://example.test/#dashboard')
    page.add_script_tag(content='''
window.Sidebar = class { setActivePage(page) { window.sidebarPage = page; } };
window.DashboardPage = class {
  constructor(container) { this.container = container; }
  async initialize() { this.container.textContent = 'Dashboard content'; }
  onDeactivate() { window.deactivated++; }
  destroy() { window.destroyed++; }
};
window.AgentsPage = class {
  constructor(container) { this.container = container; }
  async initialize() { this.container.textContent = 'Agents content'; }
};
window.deactivated = 0;
window.destroyed = 0;
''')
    page.add_script_tag(path=str(root / 'cli-tool/src/analytics-web/components/App.js'))
    page.evaluate("window.app = new App(document.querySelector('#app'), {})")
    page.wait_for_function("window.app.currentPage === 'dashboard'")
    assert page.locator('#app-content').text_content() == 'Dashboard content'
    for invalid in ['__proto__', 'constructor', 'toString', 'unknown', '<img src=x onerror=alert(1)>']:
        page.evaluate('value => window.app.navigateToPage(value)', invalid)
        assert page.locator('#app-content').text_content() == 'Dashboard content'
        assert page.evaluate('window.app.currentPage') == 'dashboard'
        assert page.evaluate('window.deactivated + window.destroyed') == 0
    page.evaluate("window.app.components.pages.__proto__ = {destroy: () => {window.destroyed++}}")
    for method in ['loadPage', 'createPageComponent', 'showPage']:
        for invalid in ['__proto__', 'constructor', None, {}, []]:
            rejected = page.evaluate('''async ({method, invalid}) => {
                try { await window.app[method](invalid, document.querySelector('#app-content')); return false; }
                catch { return true; }
            }''', dict(method=method, invalid=invalid))
            assert rejected
    assert page.evaluate('window.destroyed') == 0
    assert page.locator('#app-content').text_content() == 'Dashboard content'
    page.evaluate("window.app.hideError(); window.location.hash = 'agents'")
    page.wait_for_function("window.app.currentPage === 'agents'")
    assert page.locator('#app-content').text_content() == 'Agents content'
    assert page.evaluate('window.sidebarPage') == 'agents'
    assert page.evaluate('window.deactivated') == 1
    page.evaluate("window.location.hash = '__proto__'")
    page.wait_for_function("document.querySelector('#error-modal-message').textContent === 'Unknown page'")
    assert page.locator('#app-content').text_content() == 'Agents content'
    assert not errors, errors
    browser.close()
print('PASS: real analytics routing retains supported pages and rejects hostile hash/property keys before page cleanup')
