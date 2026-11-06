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
        page = browser.new_page(has_touch=True, viewport={'width': 1024, 'height': 768}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/tests/demo.html' + ('?bundle' if os.environ.get('HACS_BUNDLE') else ''))
        page.wait_for_function('window.dashboard?._data.prices?.length === 192')
        root = page.locator('home-dashboard')
        page.wait_for_function('window.dashboard._radar?.config?.forecast_minutes === 60')
        radar_config = page.evaluate('window.dashboard._radar.config')
        assert radar_config == {'type':'custom:weather-radar-card', 'height':'100%', 'data_source':'DWD', 'past_minutes':60, 'forecast_minutes':60, 'forecast_refresh_minutes':15, 'zoom_level':8}
        assert root.locator('#price').inner_text().find('heute + morgen') >= 0
        assert root.locator('#climate .room').count() == 9
        assert 'Strom, BKW & Batterie' in root.locator('#pv h2').inner_text()
        assert '73%' in root.locator('#pv .battery').inner_text()
        assert '8,42' in root.locator('#pv .consumption').inner_text()
        assert '2,34' in root.locator('#pv .cost').inner_text()
        assert '€' in root.locator('#pv .cost').inner_text()
        assert root.locator('#climate .room').nth(7).get_attribute('class') == 'room pm25'
        assert root.locator('#climate .room').last.locator('strong').inner_text() == 'Außen'
        assert root.locator('.pm25-current').inner_text() == '6,4'
        assert root.locator('.pm25-range b').all_inner_texts() == ['2,1','14,8']
        assert 'µg/m³' in root.locator('.pm25').inner_text()
        assert page.evaluate('window.historyCalls[0].path.includes("sensor.demo_pm25")')
        # Check the actual content, not only outer tiles, with HA chrome and decimals.
        page.evaluate('window.dashboard._data.daily.forEach(f=>{f.temperature=14.7;f.templow=6.7}); window.dashboard._data.hourly.forEach(f=>f.temperature=9.8); window.dashboard._render()')
        for width, height in [(1024, 768), (960, 700), (1280, 800)]:
            page.set_viewport_size({'width': width, 'height': height})
            for selector, parent in [('#climate .room', '#climate'), ('#weather .days>div', '#weather'), ('#weather .hours>div', '#weather'), ('#pv .energy-values', '#pv'), ('#calendar>*', '#calendar'), ('#car>*', '#car')]:
                boundary = root.locator(parent).bounding_box()
                for element in root.locator(selector).all():
                    box = element.bounding_box()
                    assert box['y'] >= boundary['y'] and box['y'] + box['height'] <= boundary['y'] + boundary['height'] - 8, (width, height, selector, box, boundary)
            assert abs(root.locator('#night').bounding_box()['height']-64) <= 1
            assert root.locator('#climate').bounding_box()['height'] > root.locator('#climate').bounding_box()['width']
            for el in root.locator('#night>*').all():
                assert el.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1 && e.scrollHeight<=e.clientHeight+1')
            energy_box = root.locator('#pv').bounding_box()
            calendar_box = root.locator('#calendar').bounding_box()
            price_box = root.locator('#price').bounding_box()
            assert energy_box['y'] > price_box['y'] and calendar_box['y'] > energy_box['y'] + energy_box['height']
            assert abs(energy_box['x'] - calendar_box['x']) < 1
            # Last room's min/max and each forecast's text must fit inside their rows.
            for selector in ['#climate .room>div', '#weather .days>div', '#weather .hours>div', '#pv .energy-values>div']:
                for element in root.locator(selector).all():
                    assert element.evaluate('(e)=>e.scrollHeight<=e.clientHeight+1 && e.scrollWidth<=e.clientWidth+1'), (width, height, selector)
        # The left-column wrapper returns to the existing narrow layout.
        for width in [760,600]:
            page.set_viewport_size({'width':width,'height':1024})
            assert root.locator('#climate .room').count() == 9
            assert root.locator('.left-column').evaluate('(e)=>getComputedStyle(e).display') == 'contents'
            for el in root.locator('#climate .room').all():
                b=el.bounding_box()
                assert b['x']>=0 and b['x']+b['width']<=width
            assert abs(root.locator('#night').bounding_box()['height']-64)<=1
        page.set_viewport_size({'width':1280,'height':800})
        for value, expected in [('0', 'red'), ('19.9', 'red'), ('20', 'yellow'), ('69.9', 'yellow'), ('70', 'green'), ('100', 'green'), ('unavailable', None)]:
            page.evaluate('(v)=>{window.mockHass.states["sensor.demo_vehicle_soc"].state=v; window.dashboard._render()}', value)
            classes = root.locator('#car .big').get_attribute('class').split()
            assert [c for c in classes if c in ('red', 'yellow', 'green')] == ([expected] if expected else []), (value, classes)
        page.evaluate('window.mockHass.states["sensor.demo_vehicle_soc"].state="59"; window.dashboard._render()')
        page.set_viewport_size({'width':1024,'height':768})
        rain = root.locator('#climate .room').last.locator('.co2')
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
        # Open the large price chart with touch, select an exact interval, drag,
        # and navigate with the keyboard. Preserve the selection across HA renders.
        opener = root.locator('.price-open').bounding_box()
        page.touchscreen.tap(opener['x'] + opener['width']/2, opener['y'] + opener['height']/2)
        dialog = root.locator('.price-dialog')
        assert dialog.evaluate('(e)=>e.open')
        chart = dialog.locator('svg')
        def chart_point(fraction):
            return chart.evaluate('(e,f)=>{const p=e.createSVGPoint();p.x=38+304*f;p.y=80;const q=p.matrixTransform(e.getScreenCTM());return {x:q.x,y:q.y}}', fraction)
        def assert_selected(index):
            result = page.evaluate('(i)=>{const p=window.dashboard._data.prices[i]; return {time:p.time,price:p.price.toLocaleString("de-DE",{maximumFractionDigits:6})}}', index)
            assert page.evaluate('window.dashboard._selectedPriceTime') == result['time']
            assert result['price'] + ' ct/kWh' in dialog.locator('output').inner_text()
            assert dialog.locator('.price-cursor').get_attribute('d').startswith('M')
        point = chart_point(0.252)
        page.touchscreen.tap(point['x'], point['y'])
        assert_selected(48)
        page.evaluate('window.dashboard._render()')
        assert_selected(48)
        point = chart_point(0.002)
        page.mouse.move(point['x'], point['y'])
        page.mouse.down()
        point = chart_point(0.999)
        page.mouse.move(point['x'], point['y'])
        page.mouse.up()
        assert_selected(191)
        slider = dialog.locator('input')
        slider.focus()
        page.keyboard.press('Home')
        assert_selected(0)
        page.keyboard.press('ArrowRight')
        assert_selected(1)
        page.keyboard.press('Escape')
        assert not dialog.evaluate('(e)=>e.open')
        page.wait_for_function('window.dashboard.shadowRoot.activeElement === window.dashboard.shadowRoot.querySelector(".price-open")')
        # Negative prices remain signed, tomorrow is unambiguous, empty data is safe.
        page.evaluate('window.originalPrice=window.dashboard._data.prices[96].price;window.dashboard._data.prices[96].price=-1.23456')
        root.locator('.price-open').click()
        point = chart_point(0.502)
        page.mouse.click(point['x'], point['y'])
        assert_selected(96)
        assert '-1,23456 ct/kWh' in dialog.locator('output').inner_text()
        assert page.evaluate('window.dashboard._time(new Date(window.dashboard._selectedPriceTime))') == '00:00'
        page.evaluate('window.savedPrices=window.dashboard._data.prices;window.dashboard._data.prices=[];window.dashboard._render()')
        assert 'Keine Preisdaten' in dialog.locator('output').inner_text()
        assert slider.is_disabled()
        dialog.locator('.price-close').click()
        page.evaluate('window.dashboard._data.prices=window.savedPrices;window.dashboard._data.prices[96].price=window.originalPrice;window.dashboard._render()')
        assert root.locator('#calendar .event').count() == 1
        assert root.locator('#night button').count() == 0
        assert root.locator('#radar .radar-cover').evaluate('(e)=>getComputedStyle(e).pointerEvents') == 'none'
        assert root.locator('#climate').inner_text().find('22.5') >= 0
        # Columns fit at iPad's logical resolution; all tiles stay inside viewport.
        for tile in root.locator('.tile').all():
            box = tile.bounding_box()
            assert box['x'] >= 0 and box['x']+box['width'] <= 1024
            assert box['y']+box['height'] <= 768, box
        assert page.evaluate('window.calls.filter(c=>c.type === "call_service" && c.return_response).length') == 8
        # All calendar entries remain reachable in the new compact tile.
        for index in range(5):
            page.evaluate('(index)=>{window.dashboard._page=index;window.dashboard._render()}', index)
            assert root.locator('#calendar .event').count() == 1
            assert f'Seite {index+1}/5' in root.locator('#calendar').inner_text()
            assert root.locator('#calendar .event>div').inner_text() == page.evaluate('(index)=>window.dashboard._data.events[index].summary', index)
        page.evaluate('window.dashboard._page=0;window.dashboard._render()')
        # Energy values come from the configured daily sensors, including zero,
        # credits, unavailable states and alternate local mappings/currencies.
        for value, expected in [('0','0,00'), ('-1.25','-1,25'), ('unavailable','—'), ('unknown','—')]:
            page.evaluate('(value)=>{window.mockHass.states["sensor.demo_electricity_cost_today"].state=value;window.mockHass.states["sensor.demo_electricity_consumption_today"].state=value;window.dashboard.hass=window.mockHass}', value)
            assert expected in root.locator('#pv .cost').inner_text()
            assert expected in root.locator('#pv .consumption').inner_text()
        page.evaluate('window.dashboard._config.entities.electricity_cost_today="sensor.custom_cost";window.mockHass.states["sensor.custom_cost"]={state:"9.87",attributes:{unit_of_measurement:"CHF"}};window.dashboard.hass=window.mockHass')
        assert '9,87' in root.locator('#pv .cost').inner_text() and 'CHF' in root.locator('#pv .cost').inner_text()
        page.evaluate('window.mockHass.states["sensor.custom_cost"].attributes.unit_of_measurement="<img src=x onerror=alert(1)>";window.dashboard.hass=window.mockHass')
        assert root.locator('#pv img').count() == 0
        page.evaluate('window.mockHass.states["sensor.demo_electricity_cost_today"].state="2.34";window.mockHass.states["sensor.demo_electricity_consumption_today"].state="8.42"')
        # Vehicle name entity takes precedence, updates through hass, and stays plain text.
        assert root.locator('#car h2').inner_text() == '🚘 Demoauto'
        page.evaluate('window.dashboard.setConfig({...window.demoConfig,vehicle_name:"Fallback",vehicle_name_entity:"input_text.demo_vehicle_name"}); window.dashboard.hass=window.mockHass')
        assert root.locator('#car h2').inner_text() == '🚘 Fallback'
        for value, expected in [('  Testauto  ', 'Testauto'), ('Neuer Name', 'Neuer Name'), ('', 'Fallback'), ('   ', 'Fallback'), ('unknown', 'Fallback'), ('unavailable', 'Fallback'), ('<img src=x onerror=alert(1)>', '<img src=x onerror=alert(1)>')]:
            page.evaluate('(value)=>{window.mockHass.states["input_text.demo_vehicle_name"]={state:value}; window.dashboard.hass=window.mockHass}', value)
            assert root.locator('#car h2').inner_text() == '🚘 ' + expected
            assert root.locator('#car h2 img').count() == 0
        page.evaluate('window.dashboard.setConfig({...window.demoConfig,vehicle_name_entity:"input_text.demo_vehicle_name"}); window.dashboard.hass=window.mockHass')
        assert root.locator('#car h2').inner_text() == '🚘 <img src=x onerror=alert(1)>'
        page.evaluate('window.dashboard.setConfig(window.demoConfig); window.dashboard.hass=window.mockHass')
        assert root.locator('#car h2').inner_text() == '🚘 Demoauto'
        page.wait_for_function('window.dashboard._busy === false')
        # Calendar content remains plain text, even with hostile titles.
        page.evaluate('window.dashboard._data.events[0].summary = "<img src=x onerror=alert(1)>"; window.dashboard._render()')
        assert root.locator('#calendar img').count() == 0
        # Today-only fallback and unavailable-state rendering.
        page.evaluate('window.dashboard._data.prices=window.dashboard._data.prices.slice(0,96); window.mockHass.states["sensor.demo_vehicle_soc"].state="unavailable"; window.dashboard._render()')
        assert 'morgen' not in root.locator('#price h2').inner_text()
        root.locator('.price-open').click()
        point = chart_point(0.999)
        page.mouse.click(point['x'], point['y'])
        assert_selected(95)
        assert dialog.locator('input').get_attribute('max') == '95'
        dialog.locator('.price-close').click()
        assert '—' in root.locator('#car .big').inner_text()
        # PM2.5 updates through hass, including zero and unavailable values.
        for value, expected in [('0','0,0'), ('unavailable','—'), ('unknown','—')]:
            page.evaluate('(value)=>{window.mockHass.states["sensor.demo_pm25"].state=value;window.dashboard.hass=window.mockHass}', value)
            assert root.locator('.pm25-current').inner_text() == expected
        page.evaluate('window.emptyPmHistory=true;window.dashboard._last.extrema=0;window.dashboard.hass=window.mockHass')
        page.wait_for_function('!window.dashboard._busy')
        assert root.locator('.pm25-range b').all_inner_texts() == ['—','—']
        page.evaluate('window.emptyPmHistory=false;window.failExtrema=true;window.dashboard._last.extrema=0;window.dashboard.hass=window.mockHass')
        page.wait_for_function('!window.dashboard._busy')
        assert root.locator('.pm25-range b').all_inner_texts() == ['—','—']
        assert 'Historie nicht abrufbar' in root.locator('#climate').inner_text()
        page.evaluate('window.failExtrema=false;window.mockHass.states["sensor.demo_pm25"].state="6.4"')
        # The sole optional command targets exactly the approved HA script.
        page.evaluate('window.dashboard.setConfig({...window.demoConfig,allow_night_action:true}); window.dashboard.hass=window.mockHass')
        root.locator('#night button').click()
        page.wait_for_function('window.calls.some(c=>c.service === "turn_on")')
        call = page.evaluate('window.calls.find(c=>c.service === "turn_on")')
        assert call == {'domain':'script','service':'turn_on','data':{'entity_id':'script.demo_good_night'}}
        for width,height in [(1024,768),(960,700),(1280,800)]:
            page.set_viewport_size({'width':width,'height':height})
            night_box=root.locator('#night').bounding_box()
            assert abs(night_box['height']-64)<=1
            assert root.locator('#night button').bounding_box()['height']>=44
            for el in root.locator('#night>*').all():
                b=el.bounding_box()
                assert b['x']>=night_box['x'] and b['x']+b['width']<=night_box['x']+night_box['width']
                assert b['y']>=night_box['y'] and b['y']+b['height']<=night_box['y']+night_box['height']
        page.set_viewport_size({'width':1024,'height':768})
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
            page.screenshot(path=os.environ.get('DEMO_SCREENSHOT', str(ROOT/'docs/demo.png')), full_page=True)
        page.evaluate('window.dashboard.setConfig({...window.demoConfig,pm25:null});window.dashboard.hass=window.mockHass')
        page.wait_for_function('!window.dashboard._busy')
        assert root.locator('.pm25').count() == 0
        assert root.locator('#climate .room').count() == 8
        assert page.evaluate('!window.historyCalls.at(-1).path.includes("sensor.demo_pm25")')
        page.evaluate('window.dashboard.setConfig({pm25:"sensor.demo_pm25"});window.dashboard.hass=window.mockHass')
        page.wait_for_function('!window.dashboard._busy')
        assert root.locator('#climate .room').count() == 1
        assert root.locator('.pm25-current').inner_text() == '6,4'
        # A fresh card without configuration must not query an installation.
        before = page.evaluate('window.calls.length')
        page.evaluate('window.dashboard.setConfig({}); window.dashboard.hass=window.mockHass')
        page.wait_for_function('window.dashboard._busy === false')
        assert page.evaluate('window.calls.length') == before
        assert 'Räume im Dashboard-YAML konfigurieren' in root.locator('#climate').inner_text()
        assert root.locator('#night button').count() == 0
        assert '—' in root.locator('#pv .consumption').inner_text()
        assert '—' in root.locator('#pv .cost').inner_text()
        assert not errors, errors
        browser.close()
        print('PASS: interactive price detail (touch, drag, keyboard, negative prices, empty data, today-only), iPad layout, service responses, calendar escaping, today-only fallback, locked display, optional night action')
finally:
    server.shutdown()
