import os
from pathlib import Path
from shutil import which
from urllib.parse import quote
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
utils = (root / 'docs/js/utils.js').read_text()
escape = utils[utils.index('function escapeHTML('):utils.index('function copyToClipboard(')]
source = (root / 'docs/js/index-events.js').read_text()
start = source.index('    createPluginCard(')
end = source.index('    displayComponents(', start)
renderer = 'function ' + source[start:end].strip()
payloads = [
    'normal-plugin', "quote'and\\backslash", "\\');window.compromised=true;//",
    '"><img src=x onerror="window.compromised=true">',
    '&quot;\n<script>window.compromised=true</script>', '../escape?#fragment',
]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or which('chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body='<main></main>'))
    for payload in payloads:
        page.goto('https://example.test/')
        page.add_script_tag(content=escape + renderer + '''
window.copyToClipboard = value => { window.copied = value; };
window.context = {formatComponentName: value => value};
''')
        plugin = dict(name=payload, description=payload, version=payload, installCommand=payload, commands=2, agents=1, mcpServers=3)
        page.evaluate('''plugin => {
            window.compromised = false;
            window.bubbled = 0;
            const main = document.querySelector('main');
            main.onclick = () => window.bubbled++;
            main.replaceChildren(createPluginCard.call(window.context, plugin));
        }''', plugin)
        assert page.locator('.command-code').text_content() == payload
        assert page.locator('.plugin-version').text_content() == 'v' + payload
        assert page.locator('.plugin-components-list h4').text_content() == 'Included Components (6)'
        page.locator('.copy-overlay-btn').click()
        assert page.evaluate('window.copied') == payload
        assert page.evaluate('window.bubbled') == 0
        assert not page.evaluate('window.compromised')
        assert page.locator('main img, main script, main [onerror]').count() == 0
        with page.expect_navigation():
            page.locator('.plugin-view-details-btn').click()
        assert page.url == 'https://example.test/plugin/' + quote(payload, safe="~()*!.'-_"), page.url
        assert not errors, errors
    page.goto('https://example.test/')
    page.add_script_tag(content=escape + renderer)
    page.evaluate('''() => {
        document.querySelector('main').append(createPluginCard.call({formatComponentName: s => s}, {
            name: 'invalid-counts', description: 'safe', version: '1.0', installCommand: '/plugin install safe',
            commands: '<img src=x onerror=alert(1)>', agents: -1, mcpServers: 1.5
        }));
    }''')
    assert page.locator('.plugin-components-list h4').text_content() == 'Included Components (0)'
    assert page.locator('main img, main [onerror]').count() == 0
    for name in ['', '.', '..', '\ud800']:
        page.evaluate('''name => {
            document.querySelector('main').replaceChildren(createPluginCard.call({formatComponentName: s => s}, {
                name, description: 'invalid name', installCommand: '/plugin install safe'
            }));
        }''', name)
        assert page.locator('.plugin-view-details-btn').is_disabled()
    assert not errors, errors
    browser.close()
print('PASS: plugin card browser clicks preserve literal copy values, encoded local navigation, component counts and inert hostile fields')
