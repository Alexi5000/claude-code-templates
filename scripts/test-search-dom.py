import os
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
jobs = (root / 'docs/jobs.html').read_text()
start = jobs.index('        function jobElement(')
end = jobs.index('        // Enhanced keyboard shortcuts', start)
mobile = (root / 'cli-tool/src/analytics-web/chats_mobile.html').read_text()
start_mobile = mobile.index('            highlightSearchResults(query) {')
end_mobile = mobile.index('            highlightCurrentMatch(', start_mobile)
clear_start = mobile.index('            clearSearchHighlights() {')
clear_end = mobile.index('            updateSearchCounter(', clear_start)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or which('chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    page.set_content('<div id="jobs-grid"></div><div class="message-content"><strong></strong></div>')
    page.add_script_tag(content="let filteredJobs = [], currentSearchTerm = '', currentCompanyFilter = 'all';" + jobs[start:end])
    page.add_script_tag(content='window.search = new (class {' + mobile[start_mobile:end_mobile] + mobile[clear_start:clear_end] + 'escapeRegex(s) { return s.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"); }' + '})();')
    payload = '<img src=x onerror="window.compromised=true">'
    page.evaluate("payload => { window.compromised = false; currentSearchTerm = payload; renderJobs(); }", payload)
    assert page.locator('.no-jobs').inner_text().find(payload) >= 0
    assert page.locator('#jobs-grid img').count() == 0
    page.evaluate("""payload => {
        currentSearchTerm = 'img';
        filteredJobs = [{company:payload, company_icon:'javascript:alert(1)', job_title:payload, location:payload, description:payload, job_link:'javascript:alert(1)'}];
        renderJobs();
    }""", payload)
    assert page.locator('.job-description').text_content() == payload
    assert page.locator('#jobs-grid [onerror], #jobs-grid a').count() == 0
    assert page.locator('.job-title mark').text_content() == 'img'
    page.evaluate("filteredJobs[0].job_link = 'https://example.com/jobs'; renderJobs()")
    assert page.locator('.apply-btn').get_attribute('href') == 'https://example.com/jobs'
    page.evaluate("""payload => {
        document.querySelector('.message-content strong').textContent = payload;
        search.highlightSearchResults('img');
    }""", payload)
    assert page.locator('.message-content strong').text_content() == payload
    assert page.locator('.message-content img').count() == 0
    assert page.locator('.message-highlight').text_content() == 'img'
    page.evaluate("search.highlightSearchResults('onerror'); search.clearSearchHighlights()")
    assert page.locator('.message-content strong').text_content() == payload
    assert page.locator('.message-highlight').count() == 0
    assert not page.evaluate('window.compromised')
    browser.close()
print('PASS: jobs and mobile search keep hostile text inert, preserve markup, highlight and clear, and reject executable links')
