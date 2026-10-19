import os
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
payloads = ['ordinary-component', "quote'and\\backslash", "\\');window.compromised=true;//", '"><img src=x onerror="window.compromised=true">', '&quot;\n<script>window.compromised=true</script>']
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or which('chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content('<main></main>')
    page.add_script_tag(content=(root / 'docs/js/utils.js').read_text())
    page.add_script_tag(content=(root / 'docs/js/modal-helpers.js').read_text())
    page.add_script_tag(content='''
window.copyToClipboard = (...args) => window.calls.push(['copy', ...args]);
window.handleAddToCart = (name, path, type, category, button) => window.calls.push(['cart', name, path, type, category, button.matches('.add-to-cart-btn')]);
''')
    for kind in ['agent', 'mcp', 'template', '"><img src=x onerror=window.compromised=true>']:
        for payload in payloads:
            component = dict(type=kind, name=payload, path='folder/' + payload + '.md', folderPath=payload, category=payload, description=payload, content=payload)
            page.evaluate('''component => {
                window.compromised = false;
                window.calls = [];
                showComponentModal(component);
            }''', component)
            assert page.locator('.component-description').text_content() == payload
            path = component['path'][:-3]
            expected = [f'npx claude-code-templates@latest --{kind}={path} --yes']
            if kind == 'agent':
                expected.extend([f'npx claude-code-templates@latest --create-agent {path}', path.split('/')[-1] + ' "your prompt here"', f'npx claude-code-templates@latest --sandbox e2b --agent={path} --prompt "your development task"'])
            for button in page.locator('.copy-btn').all():
                button.click()
            assert page.evaluate('window.calls') == [['copy', command] for command in expected]
            assert page.locator('.modal-overlay').count() == 1
            assert page.locator('.modal-overlay img, .modal-overlay script, .modal-overlay [onerror]').count() == 0
            assert page.locator('.github-folder-link').get_attribute('href').startswith('https://github.com/davila7/claude-code-templates/')
            page.locator('.add-to-cart-btn').click()
            assert page.evaluate('window.calls.at(-1)') == ['cart', payload, path, kind + 's', payload, True]
            assert page.locator('.modal-overlay').count() == 0
            assert not page.evaluate('window.compromised')
            assert not errors, errors
    normal = dict(type='agent', name='normal', path='normal.md', content='# Heading\nplain text')
    page.evaluate('component => showComponentModal(component)', normal)
    assert page.locator('#code-viewer code').text_content() == normal['content']
    assert page.locator('#code-viewer code span').count() > 0
    page.keyboard.press('Escape')
    assert page.locator('.modal-overlay').count() == 0
    page.evaluate('component => showComponentModal(component)', normal)
    page.locator('.modal-close').click()
    assert page.locator('.modal-overlay').count() == 0
    page.evaluate('component => showComponentModal(component)', normal)
    page.locator('.add-to-cart-btn').click()
    assert page.evaluate('window.calls.at(-1)') == ['cart', 'normal', 'normal', 'agents', 'Other', True]
    browser.close()
print('PASS: modal copy/cart arguments remain exact and hostile metadata inert; agent/MCP/template rendering, code formatting, cart-close, close button and Escape work in Chromium')
