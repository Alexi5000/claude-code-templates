import os
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

source = Path(__file__).resolve().parents[1] / 'docs/js/plugin-page.js'
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or which('chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content('''<section id="commandsSection"><span id="commandsCount"></span><ul id="commandsList"></ul></section>
        <section id="agentsSection"><span id="agentsCount"></span><ul id="agentsList"></ul></section>
        <section id="mcpsSection"><span id="mcpsCount"></span><ul id="mcpsList"></ul></section>
        <div id="installModal" style="display:none"><code id="modalCommand"></code></div>''')
    page.add_script_tag(path=str(source))
    payloads = ['tools/reviewer', "name\\');window.compromised=true;//", '\"><img src=x onerror="window.compromised=true">', 'name&#39;);window.compromised=true;//']
    page.evaluate('''names => {
        window.compromised = false;
        window.pluginPageManager = new PluginPageManager();
        pluginPageManager.setupKeyboardListeners();
        pluginPageManager.renderComponents({commands: names.length, commandsList: names,
            agents: names.length, agentsList: names, mcpServers: names.length, mcpServersList: names});
    }''', payloads)
    for list_id, kind in [('commandsList', 'command'), ('agentsList', 'agent'), ('mcpsList', 'mcp')]:
        rows = page.locator(f'#{list_id} .component-item')
        assert rows.count() == len(payloads)
        for index, name in enumerate(payloads):
            expected = page.evaluate('name => pluginPageManager.formatComponentName(name)', name)
            assert rows.nth(index).locator('.component-name').text_content() == expected
            rows.nth(index).get_by_role('button', name='Install').click()
            command = f'npx claude-code-templates@latest --{kind} {name}'
            assert page.locator('#installModal').is_visible()
            assert page.locator('#modalCommand').text_content() == command
            assert page.evaluate('pluginPageManager.currentCommand') == command
            assert page.evaluate('document.body.style.overflow') == 'hidden'
            page.keyboard.press('Escape')
            assert page.locator('#installModal').is_hidden()
            assert page.evaluate('document.body.style.overflow') == 'auto'
    assert page.locator('img, [onclick], [onerror], svg[onload]').count() == 0
    assert not page.evaluate('window.compromised')
    page.evaluate("document.getElementById('commandsList').replaceChildren(pluginPageManager.generateComponentItems([], 'command', 'commands'))")
    assert page.locator('#commandsList').text_content() == 'No components available'
    assert not errors, errors
    browser.close()
print('PASS: command, agent and MCP names remain inert; install modal, exact command text, Escape, scroll reset and empty state work in Chromium')
