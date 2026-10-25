"""Offline-Browserprüfung. Benötigt Python Playwright und Chromium, kein HA/Token."""
import functools
import os
import http.server
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1024, 'height': 768}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/tests/demo.html' + ('?bundle' if os.environ.get('HACS_BUNDLE') else ''))
        page.wait_for_function('window.dashboard?._data.prices?.length === 192')
        root = page.locator('home-dashboard')
        page.wait_for_function('window.dashboard._radar?.config?.forecast_minutes === 60')
        radar_config = page.evaluate('window.dashboard._radar.config')
        assert radar_config == {'type':'custom:weather-radar-card', 'height':'100%', 'data_source':'DWD', 'past_minutes':60, 'forecast_minutes':60, 'forecast_refresh_minutes':15, 'zoom_level':8}
        assert root.locator('#price').inner_text().find('heute + morgen') >= 0
        assert root.locator('#climate .room').count() == 8
        assert 'BKW & Batteriespeicher' in root.locator('#pv h2').inner_text()
        assert '73%' in root.locator('#pv .battery').inner_text()
        # Check the actual content, not only outer tiles, with HA chrome and decimals.
        page.evaluate('window.dashboard._data.daily.forEach(f=>{f.temperature=14.7;f.templow=6.7}); window.dashboard._data.hourly.forEach(f=>f.temperature=9.8); window.dashboard._render()')
        for width, height in [(1024, 768), (960, 700), (1280, 800)]:
            page.set_viewport_size({'width': width, 'height': height})
            for selector, parent in [('#climate .room', '#climate'), ('#weather .days>div', '#weather'), ('#weather .hours>div', '#weather'), ('#pv .energy-values', '#pv')]:
                boundary = root.locator(parent).bounding_box()
                for element in root.locator(selector).all():
                    box = element.bounding_box()
                    assert box['y'] >= boundary['y'] and box['y'] + box['height'] <= boundary['y'] + boundary['height'] - 8, (width, height, selector, box, boundary)
            # Last room's min/max and each forecast's text must fit inside their rows.
            for selector in ['#climate .room>div', '#weather .days>div', '#weather .hours>div']:
                for element in root.locator(selector).all():
                    assert element.evaluate('(e)=>e.scrollHeight<=e.clientHeight+1 && e.scrollWidth<=e.clientWidth+1'), (width, height, selector)
        page.set_viewport_size({'width':1024,'height':768})
        rain = root.locator('#climate .room').nth(7).locator('.co2')
        assert rain.inner_text().replace('\n', '') == '2,4mm'
        assert rain.get_attribute('title') == 'Niederschlag heute'
        assert 'ppm' not in rain.inner_text()
        for value, expected in [('999', 'green'), ('1000', 'yellow'), ('1999', 'yellow'), ('2000', 'red')]:
            page.evaluate('(v)=>{window.mockHass.states["sensor.demo_room_1_co2"].state=v; window.dashboard._render()}', value)
            assert expected in root.locator('#climate .room').first.locator('.co2').get_attribute('class')
        page.evaluate('window.mockHass.states["sensor.demo_room_8_rain"].state="0"; window.dashboard._render()')
        assert rain.inner_text().replace('\n', '') == '0,0mm'
        page.evaluate('window.mockHass.states["sensor.demo_room_8_rain"].state="unavailable"; window.dashboard._render()')
        assert '—' in rain.inner_text()
        page.evaluate('window.mockHass.states["sensor.demo_room_8_rain"].state="2.4"; window.mockHass.states["sensor.demo_room_1_co2"].state="840"; window.dashboard._render()')
        assert root.locator('#calendar .event').count() == 4
        assert root.locator('#night button').count() == 0
        assert root.locator('#radar .radar-cover').evaluate('(e)=>getComputedStyle(e).pointerEvents') == 'none'
        assert root.locator('#climate').inner_text().find('22.5') >= 0
        # Columns fit at iPad's logical resolution; all tiles stay inside viewport.
        for tile in root.locator('.tile').all():
            box = tile.bounding_box()
            assert box['x'] >= 0 and box['x']+box['width'] <= 1024
            assert box['y']+box['height'] <= 768, box
        assert page.evaluate('window.calls.filter(c=>c.type === "call_service" && c.return_response).length') == 8
        # Calendar content remains plain text, even with hostile titles.
        page.evaluate('window.dashboard._data.events[0].summary = "<img src=x onerror=alert(1)>"; window.dashboard._render()')
        assert root.locator('#calendar img').count() == 0
        # Today-only fallback and unavailable-state rendering.
        page.evaluate('window.dashboard._data.prices=window.dashboard._data.prices.slice(0,96); window.mockHass.states["sensor.demo_vehicle_soc"].state="unavailable"; window.dashboard._render()')
        assert 'morgen' not in root.locator('#price h2').inner_text()
        assert '—' in root.locator('#car .big').inner_text()
        # The sole optional command targets exactly the approved HA script.
        page.evaluate('window.dashboard.setConfig({...window.demoConfig,allow_night_action:true}); window.dashboard.hass=window.mockHass')
        root.locator('#night button').click()
        page.wait_for_function('window.calls.some(c=>c.service === "turn_on")')
        call = page.evaluate('window.calls.find(c=>c.service === "turn_on")')
        assert call == {'domain':'script','service':'turn_on','data':{'entity_id':'script.demo_good_night'}}
        page.evaluate('window.dashboard._config.battery_soc="sensor.custom_soc"; window.mockHass.states["sensor.custom_soc"]={state:"0"}; window.dashboard._render()')
        assert '0%' in root.locator('#pv .battery').inner_text()
        page.evaluate('window.mockHass.states["sensor.custom_soc"].state="unavailable"; window.dashboard._render()')
        assert '—' in root.locator('#pv .battery').inner_text()
        # Explicit YAML overrides win; omitted radar options retain defaults.
        page.evaluate('window.dashboard.setConfig({...window.demoConfig,radar:{forecast_minutes:0,zoom_level:9}}); window.dashboard.hass=window.mockHass')
        page.wait_for_function('window.dashboard._radar?.config?.forecast_minutes === 0')
        assert page.evaluate('window.dashboard._radar.config.data_source') == 'DWD'
        assert page.evaluate('window.dashboard._radar.config.zoom_level') == 9
        # Return to locked display for the documented test screenshot.
        page.evaluate('window.mockHass.states["sensor.demo_vehicle_soc"].state="59"; window.dashboard.setConfig({...window.demoConfig,allow_night_action:false}); window.dashboard.hass=window.mockHass')
        page.wait_for_function('window.dashboard._data.prices?.length === 192')
        if not os.environ.get('HACS_BUNDLE'):
            page.screenshot(path=str(ROOT/'docs/demo.png'), full_page=True)
        # A fresh card without configuration must not query an installation.
        before = page.evaluate('window.calls.length')
        page.evaluate('window.dashboard.setConfig({}); window.dashboard.hass=window.mockHass')
        page.wait_for_function('window.dashboard._busy === false')
        assert page.evaluate('window.calls.length') == before
        assert 'Räume im Dashboard-YAML konfigurieren' in root.locator('#climate').inner_text()
        assert root.locator('#night button').count() == 0
        assert not errors, errors
        browser.close()
        print('PASS: iPad layout, service responses, calendar escaping, today-only fallback, locked display, optional night action')
finally:
    server.shutdown()
