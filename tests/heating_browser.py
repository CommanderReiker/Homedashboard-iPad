"""Offline tests for the read-only heating view; all entities are synthetic."""
import functools
import http.server
import os
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(has_touch=True, viewport={'width': 1024, 'height': 768})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/tests/heating-demo.html' + ('?bundle' if os.environ.get('HACS_BUNDLE') else ''))
        page.wait_for_function('window.dashboard?._heatingHistory && !window.dashboard._heatingBusy')
        root = page.locator('home-dashboard')
        assert root.locator('.automation-item').count() == 4
        assert [s.inner_text() for s in root.locator('.automation-item small').all()] == ['Aktiv','Aus','Nicht verfügbar','Nicht verfügbar']
        assert root.locator('.thermostat').count() == 4
        assert root.locator('.actual-line').count() == 4
        assert root.locator('.target-line').count() == 4
        assert root.locator('.heating-chart rect').count() > 0
        assert page.evaluate('window.calls.length') == 1
        path = page.evaluate('window.calls[0].path')
        assert 'significant_changes_only=0' in path and 'no_attributes' not in path and 'minimal_response' not in path
        assert 'climate.demo_heating_1' in path and 'climate.demo_heating_4' in path
        # Dense, unchanged heating reports produce one solid SVG band per room.
        # Every real one-minute pause and unknown state still splits that band.
        page.evaluate("""()=>{
            window.savedHeatingHistory=window.dashboard._heatingHistory;
            const {start,end}=window.savedHeatingHistory;
            const rows=window.heatingConfig.heating.thermostats.map(room=>Array.from({length:60},(_,i)=>({entity_id:room.entity,state:'heat',last_updated:new Date(start+i*60000).toISOString(),attributes:{current_temperature:20+i/100,temperature:22,hvac_action:'heating'}})));
            window.dashboard._heatingHistory={start,end,rows};window.dashboard._render();
        }""")
        for chart in root.locator('.heating-chart').all():
            assert chart.locator('rect').count() == 1
        page.evaluate('window.dashboard._heatingHistory.rows.forEach(rows=>rows[30].attributes.hvac_action="idle");window.dashboard._render()')
        for chart in root.locator('.heating-chart').all():
            assert chart.locator('rect').count() == 2
            bands=chart.locator('rect').evaluate_all('(els)=>els.map(e=>({x:+e.getAttribute("x"),width:+e.getAttribute("width")}))')
            assert abs(bands[1]['x']-(bands[0]['x']+bands[0]['width'])-394/1440)<1e-8
        page.evaluate('window.dashboard._heatingHistory.rows.forEach(rows=>rows[40].state="unavailable");window.dashboard._render()')
        for chart in root.locator('.heating-chart').all():
            assert chart.locator('rect').count() == 3
        page.evaluate('window.dashboard._heatingHistory=window.savedHeatingHistory;window.dashboard._render()')
        # Four flat cards fit on the iPad; mobile stacks without horizontal overflow.
        for width, height in [(1024,768),(960,700),(1280,800),(600,900),(390,844)]:
            page.set_viewport_size({'width':width,'height':height})
            for selector in ['.automation-item','.thermostat','.heating-chart','.heating-legend','.history-note']:
                for el in root.locator(selector).all():
                    b = el.bounding_box()
                    assert b['x'] >= 0 and b['x']+b['width'] <= width+1, (width,selector,b)
                    if width > 760:
                        assert b['y']+b['height'] <= height, (width,selector,b)
                    assert el.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1 && e.scrollHeight<=e.clientHeight+1'), (width,selector)
        page.set_viewport_size({'width':1024,'height':768})
        page.evaluate('window.mockHass.states["input_boolean.demo_heating_2"].state="on"; window.mockHass.states["climate.demo_heating_1"].attributes.current_temperature=23.4; window.dashboard.hass=window.mockHass')
        assert root.locator('.automation-item small').nth(1).inner_text() == 'Aktiv'
        assert '23,4 °C' in root.locator('.thermostat .actual').first.inner_text()
        assert page.evaluate('window.calls.length') == 1  # Live updates do not refetch history.
        # Failed refresh retains clearly labelled last successful data.
        page.evaluate('window.failHistory=true; window.dashboard._heatingAttempt=0; window.dashboard.hass=window.mockHass')
        page.wait_for_function('!window.dashboard._heatingBusy && window.dashboard._heatingError')
        assert root.locator('.actual-line').count() == 4
        assert 'letzter erfolgreicher Abruf' in root.locator('.history-note').first.inner_text()
        page.evaluate('window.failHistory=false; window.emptyHistory=true; window.dashboard._heatingAttempt=0; window.dashboard.hass=window.mockHass')
        page.wait_for_function('!window.dashboard._heatingBusy && !window.dashboard._heatingError')
        assert root.locator('.heating-chart').count() == 0
        assert root.locator('.heating-empty').first.inner_text() == 'Keine Temperaturhistorie verfügbar'
        # Names are escaped; missing entities and incomplete configuration stay explicit.
        page.evaluate('window.emptyHistory=false; window.dashboard.setConfig({view:"heating",heating:{switches:[{name:"<img src=x onerror=alert(1)>",entity:"switch.missing"}],thermostats:[{name:"<img src=x onerror=alert(1)>",entity:"climate.missing"}]}})')
        page.wait_for_function('!window.dashboard._heatingBusy')
        assert root.locator('img').count() == 0
        assert root.locator('.automation-item small').first.inner_text() == 'Nicht verfügbar'
        assert '—' in root.locator('.thermostat .actual').first.inner_text()
        assert root.locator('.thermostat.empty').count() == 3
        before = page.evaluate('window.calls.length')
        page.evaluate('window.dashboard.setConfig({view:"heating"})')
        assert page.evaluate('window.calls.length') == before
        assert root.locator('.thermostat.empty').count() == 4
        assert root.locator('button').count() == 0
        # Reject extra slots instead of silently dropping them.
        assert page.evaluate('(()=>{try{window.dashboard.setConfig({view:"heating",heating:{switches:Array(5).fill({})}});return false}catch(e){return true}})()')
        # Late history responses cannot overwrite a reconfigured card.
        page.evaluate('window.historyGate=new Promise(r=>window.releaseHistory=r); window.dashboard.setConfig(window.heatingConfig)')
        page.wait_for_function('window.dashboard._heatingBusy')
        page.evaluate('window.dashboard.setConfig({view:"heating"}); window.releaseHistory()')
        page.wait_for_timeout(100)
        assert page.evaluate('window.dashboard._heatingHistory === null')
        assert root.locator('.thermostat.empty').count() == 4
        # Snapshot uses only the four synthetic demo regulators.
        page.evaluate('window.historyGate=null; window.mockHass.states["input_boolean.demo_heating_2"].state="off"; window.mockHass.states["climate.demo_heating_1"].attributes.current_temperature=21.4; window.dashboard.setConfig(window.heatingConfig)')
        page.wait_for_function('window.dashboard._heatingHistory && !window.dashboard._heatingBusy')
        if not os.environ.get('HACS_BUNDLE'):
            page.screenshot(path=str(ROOT/'docs/heating-demo.png'), full_page=True)
        assert not errors, errors
        browser.close()
        print('PASS: heating layout, live states, full attribute history, fallback states, read-only view, escaped names, refresh failure and stale responses')
finally:
    server.shutdown()
