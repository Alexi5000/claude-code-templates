from pathlib import Path
from playwright.sync_api import sync_playwright

source = Path(__file__).resolve().parents[1] / 'docs/js/workflows-events.js'
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.set_content('''<input id="componentSearch"><div id="agents-count"></div><div id="agents-tree"></div>
        <div id="workflowSteps"><div class="drop-zone">Drop here</div></div>
        <span id="agentCount"></span><span id="commandCount"></span><span id="totalSteps"></span>''')
    page.add_script_tag(path=str(source))
    payload = '''\'\\\"><img src=x onerror="window.compromised=true"><svg onload="window.compromised=true">'''
    page.evaluate('''payload => {
        window.compromised = false;
        window.details = [];
        window.dataLoader = { findComponent: (name, type) => ({ name, type }) };
        window.showComponentModal = component => window.details.push(component);
        window.workflowManager = new WorkflowManager();
        workflowManager.setupEventListeners();
        workflowManager.initializeDragAndDrop();
        workflowManager.renderComponentsListByType('agents', [
            {name: payload, type:'agent', category:payload, path:payload},
            {name:'Reviewer', type:'agent', category:'__proto__', path:'reviewer.md'}
        ]);
    }''', payload)
    assert page.locator('.tree-file-name').first.text_content() == payload
    assert page.locator('.tree-label').first.text_content() == payload
    page.get_by_title('View Details').first.click()
    assert page.evaluate('details[0].name') == payload
    page.get_by_title('Add to Workflow').first.click()
    assert page.locator('.workflow-agent .step-name').text_content() == payload
    page.evaluate('''payload => {
        const agent = workflowManager.workflowState.agents[0].agent;
        agent.id = payload;
        agent.icon = payload;
        const drop = document.querySelector('.sub-item-drop-zone');
        workflowManager.renderWorkflowSteps();
        const transfer = new DataTransfer();
        transfer.setData('application/json', JSON.stringify({componentName:payload, componentType:'command', componentPath:payload, componentCategory:payload}));
        document.querySelector('.sub-item-drop-zone').dispatchEvent(new DragEvent('drop', {bubbles:true, dataTransfer:transfer}));
        const sub = workflowManager.workflowState.agents[0].subItems[0];
        sub.id = payload;
        sub.icon = payload;
        sub.type = payload;
        workflowManager.renderWorkflowSteps();
    }''', payload)
    assert page.locator('.sub-item .step-name').text_content() == payload
    assert page.locator('.sub-item .step-type').text_content() == payload
    page.locator('.sub-item').get_by_title('Details').click()
    assert page.evaluate('details[1].type') == payload
    assert page.locator('img, svg[onload], [onerror]').count() == 0
    assert not page.evaluate('window.compromised')
    page.locator('.sub-item').get_by_title('Remove').click()
    assert page.locator('.sub-item').count() == 0
    page.locator('.workflow-agent').get_by_title('Remove').click()
    assert page.locator('.workflow-agent').count() == 0
    assert page.locator('.drop-zone').is_visible()
    page.get_by_title('Add to Workflow').nth(1).click()
    page.locator('.workflow-agent').get_by_title('Details').click()
    assert page.evaluate('details.at(-1).name') == 'Reviewer'
    page.locator('#componentSearch').fill('Reviewer')
    assert page.locator('.tree-file').first.is_hidden()
    assert page.locator('.tree-file').nth(1).is_visible()
    page.evaluate('''() => workflowManager.addWorkflowStep({componentType:'command', componentName:'Build', componentPath:'build.md', componentCategory:'tools'})''')
    assert page.locator('.workflow-agent').count() == 2
    assert page.locator('#totalSteps').text_content() == '2'
    assert page.locator('.workflow-agent').nth(1).locator('.sub-item-drop-zone').count() == 0
    page.locator('.workflow-agent').nth(1).get_by_title('Remove').click()
    assert page.locator('.workflow-agent').count() == 1
    assert not errors, errors
    browser.close()
print('PASS: hostile metadata remains inert; details, add, nested drop, removal, search, standalone commands and stats work in Chromium')
