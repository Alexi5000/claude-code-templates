import os
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
utils = (root / 'docs/js/utils.js').read_text()
escape = utils[utils.index('function escapeHTML('):utils.index('function copyToClipboard(')]
search = (root / 'docs/js/search-functionality.js').read_text()
start = search.index('function generateComponentCard(')
end = search.index('\n}', start) + 2
index = (root / 'docs/js/index-events.js').read_text()
index_start = index.index('    generateComponentCard(')
index_end = index.index('    copyToClipboard(', index_start)
scripts = [search[start:end], 'function ' + index[index_start:index_end].strip()]
payloads = ['normal-component', "quote'and\\backslash", "\\');window.compromised=true;//", '"><img src=x onerror="window.compromised=true">', '&quot;\n<script>window.compromised=true</script>']
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or which('chromium'), headless=True, args=['--no-sandbox'])
    for source in scripts:
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content('<main></main>')
        page.add_script_tag(content=escape + source + '''
window.copyToClipboard = (...args) => window.calls.push(['copy', ...args]);
window.showComponentDetails = (...args) => window.calls.push(['details', ...args]);
window.handleAddToCart = (name, path, type, category, button) => window.calls.push(['cart', name, path, type, category, button.matches('.add-to-cart-btn')]);
window.context = {formatComponentName: s => s, truncateDescription: s => s, getComponentDescription: c => c.description, createValidationBadge: () => ''};
''')
        for payload in payloads:
            component = dict(type='agent', name=payload, path='folder/' + payload + '.md', category=payload, description=payload)
            page.evaluate('''component => {
                window.compromised = false;
                window.calls = [];
                document.querySelector('main').innerHTML = generateComponentCard.call(window.context, component);
            }''', component)
            for selector in ['.copy-overlay-btn', '.view-files-btn', '.add-to-cart-btn']:
                page.locator(selector).click()
            path = component['path'][:-3]
            assert page.evaluate('window.calls') == [
                ['copy', f'npx claude-code-templates@latest --agent={path} --yes'],
                ['details', 'agent', payload, component['path'], payload],
                ['cart', payload, path, 'agents', payload, True],
            ]
            assert not page.evaluate('window.compromised')
            assert page.locator('main img, main script, main [onerror]').count() == 0
            assert not errors, errors
        page.close()
    browser.close()
print('PASS: both component-card renderers preserve exact copy/details/cart arguments through browser clicks and keep hostile HTML/JavaScript inert')
