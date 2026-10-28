import {escapeHTML as esc, dayKey, dayWindow, midnight, numberState, selectPrices, calendarEvents, historyExtrema} from './data.js?v=2.1.0';

const VERSION='2.1.0';
const DEFAULT_ENTITIES={"current_price": null, "pv_power": null, "pv_energy_today": null, "vehicle_range": null, "vehicle_soc": null, "vehicle_plug": null, "vehicle_charging": null, "vehicle_target_soc": null, "vehicle_charged_today": null};
const WEATHER={sunny:['☀','Sonnig'],clear:['☀','Klar'],'clear-night':['☾','Klare Nacht'],cloudy:['☁','Bewölkt'],partlycloudy:['⛅','Teils bewölkt'],rainy:['🌧','Regen'],pouring:['🌧','Starkregen'],snowy:['❄','Schnee'],'snowy-rainy':['🌨','Schneeregen'],fog:['≋','Nebel'],windy:['≋','Windig'],'windy-variant':['≋','Windig'],lightning:['ϟ','Gewitter'],'lightning-rainy':['⛈','Gewitter'],hail:['🌨','Hagel'],exceptional:['⚠','Unwetter']};
export class HomeDashboard extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this._data={};this._errors={};this._last={};this._page=0;this._busy=false;}
  setConfig(config){
    this._config={weather:null,calendars:[],rooms:[],battery_soc:null,vehicle_name:'Auto',night_script:null,allow_night_action:false,...config,entities:{...DEFAULT_ENTITIES,...config.entities},radar:{type:'custom:weather-radar-card',height:'100%',data_source:'DWD',past_minutes:60,forecast_minutes:60,forecast_refresh_minutes:15,zoom_level:8,...config.radar}};
    this.shadowRoot.querySelector('dialog')?.close();this._selectedPriceTime=null;this._last={};this._radar=null;this._mount();if(this._hass)this._update();
  }
  set hass(hass){this._hass=hass;if(this._radar)this._radar.hass=hass;if(this.isConnected&&this._config)this._update();}
  connectedCallback(){this._timer=setInterval(()=>{this._page++;this._update();},15000);if(this._config)this._update();}
  disconnectedCallback(){clearInterval(this._timer);this.shadowRoot.querySelector('dialog')?.close();}
  getCardSize(){return 10;}
  _zone(){return this._hass?.config?.time_zone || 'Europe/Berlin';}
  _time(date){return new Intl.DateTimeFormat('de-DE',{timeZone:this._zone(),hour:'2-digit',minute:'2-digit'}).format(date);}
  _value(id,digits=0,unit=''){const n=numberState(this._hass,id);return n===null?'—':`${n.toLocaleString('de-DE',{minimumFractionDigits:digits,maximumFractionDigits:digits})}${unit}`;}
  _mount(){
    this.shadowRoot.innerHTML=`<style>${STYLE}</style><main><header><span class="clock"></span><span>Home · V${VERSION}</span></header><div class="grid">${['climate','price','radar','car','calendar','weather','night','pv'].map(x=>`<section class="tile ${x}" id="${x}"></section>`).join('')}</div></main><dialog class="price-dialog" aria-labelledby="price-title"><div class="heading"><h2 id="price-title">Strompreise · ct/kWh</h2><button type="button" class="price-close" aria-label="Strompreisansicht schließen">Schließen</button></div><p>Im Diagramm tippen oder ziehen, um einen Preis auszuwählen.</p><div class="price-detail-chart"></div><output class="price-readout" aria-live="polite"></output><label class="price-slider-label">Zeitpunkt<input class="price-slider" type="range" min="0" step="1" aria-label="Preisintervall auswählen"></label><small class="price-detail-status"></small></dialog>`;
    const dialog=this.shadowRoot.querySelector('dialog');
    dialog.onclose=()=>this.shadowRoot.querySelector('.price-open')?.focus();
    this.shadowRoot.querySelector('.price-close').onclick=()=>dialog.close();
    dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.close();}});
    this.shadowRoot.querySelector('.price-slider').oninput=e=>this._selectPrice(Number(e.target.value));
    this._radarReady=false;
  }
  async _update(){
    if(!this._hass||!this._config||!this.isConnected)return;
    this._render();
    if(this._busy)return;this._busy=true;
    const now=new Date(),w=dayWindow(now,this._zone());
    const jobs=[['prices',300000,()=>this._service('tibber','get_prices',{start:w.start.toISOString(),end:w.end.toISOString()}).then(r=>selectPrices(r,this._config.tibber_home,w,this._config.price_factor??100))],
      ['events',300000,async()=>{
        // Separate requests keep other calendars visible if one is unavailable.
        const results=await Promise.allSettled(this._config.calendars.map(id=>this._service('calendar','get_events',{start_date_time:w.start.toISOString(),end_date_time:w.end.toISOString()},{entity_id:id})));
        const merged={};let failures=0;
        results.forEach(r=>{if(r.status==='fulfilled')Object.assign(merged,r.value);else failures++;});
        if(failures===results.length&&results.length)throw new Error('Kalender nicht abrufbar.');
        this._calendarFailures=failures;return calendarEvents(merged,w,this._zone());
      }],
      ['daily',1800000,()=>this._service('weather','get_forecasts',{type:'daily'},{entity_id:this._config.weather}).then(r=>r[this._config.weather]?.forecast||[])],
      ['hourly',1800000,()=>this._service('weather','get_forecasts',{type:'hourly'},{entity_id:this._config.weather}).then(r=>r[this._config.weather]?.forecast||[])],
      ['extrema',900000,async()=>historyExtrema(await this._hass.callApi('GET',`history/period/${encodeURIComponent(w.start.toISOString())}?filter_entity_id=${encodeURIComponent(this._config.rooms.map(r=>r[1]).join(','))}&end_time=${encodeURIComponent(now.toISOString())}&minimal_response&no_attributes`))]];
    if(this._day!==w.today){this._day=w.today;this._last={};this._data={};}
    const enabled={prices:!!this._config.entities.current_price || !!this._config.tibber_home,events:this._config.calendars.length>0,daily:!!this._config.weather,hourly:!!this._config.weather,extrema:this._config.rooms.length>0};
    await Promise.all(jobs.filter(([key,interval])=>enabled[key]&&(!this._last[key]||Date.now()-this._last[key]>interval)).map(async([key,,fn])=>{
      this._last[key]=Date.now();try{this._data[key]=await fn();delete this._errors[key];}catch(e){this._errors[key]=true;}
    }));
    this._busy=false;if(this.isConnected)this._render();
    this._setupRadar();
  }
  async _service(domain,service,service_data,target){
    const result=await this._hass.callWS({type:'call_service',domain,service,service_data,...(target?{target}:{}),return_response:true});
    return result.response || {};
  }
  async _setupRadar(){
    if(this._radarReady)return;this._radarReady=true;
    const host=this.shadowRoot.getElementById('radar');
    try{
      if(!customElements.get('weather-radar-card')){host.innerHTML='<h2>Regenradar</h2><p>Weather Radar Card laden: siehe Installation.</p>';this._radarReady=false;return;}
      const helpers=await window.loadCardHelpers();
      this._radar=helpers.createCardElement(this._config.radar);this._radar.hass=this._hass;
      const cover=document.createElement('div');cover.className='radar-cover';cover.append(this._radar);host.replaceChildren(cover);
    }catch(e){host.innerHTML='<h2>Regenradar</h2><p>Kartenkonfiguration prüfen.</p>';this._radarReady=false;}
  }
  _render(){
    const root=this.shadowRoot,h=this._hass,c=this._config,now=new Date(),zone=this._zone(),w=dayWindow(now,zone);
    const put=(id,html)=>{root.getElementById(id).innerHTML=html;};
    root.querySelector('.clock').textContent=`${this._time(now)} · ${new Intl.DateTimeFormat('de-DE',{timeZone:zone,weekday:'long',day:'numeric',month:'long'}).format(now)}`;
    put('climate',`<h2>Raumklima</h2><div class="rooms" style="--room-count:${Math.max(1,c.rooms.length)}">${!c.rooms.length?'<p>Räume im Dashboard-YAML konfigurieren</p>':''}${c.rooms.map(([name,t,hum,co2,rain])=>{
      const n=co2?numberState(h,co2):null,e=this._errors.extrema?null:this._data.extrema?.[t];
      return `<div class="room"><strong>${esc(name)}</strong><div><b>${this._value(t,1,'°')}</b><small>${e?`↑${e.max.toFixed(1)}° ↓${e.min.toFixed(1)}°`:'↑— ↓—'}</small></div><span class="cyan">${this._value(hum,0,'%')}</span><span title="${rain?'Niederschlag heute':'CO₂'}" class="co2 ${rain?'cyan':n===null?'':n<1000?'green':n<2000?'yellow':'red'}">${rain?`${this._value(rain,1)}<small>${esc(h.states[rain]?.attributes?.unit_of_measurement || 'mm')}</small>`:co2?`${n===null?'—':`● ${Math.round(n)}`}<small>${n===null?'':'ppm'}</small>`:'—'}</span></div>`;
    }).join('')}</div>${this._errors.extrema?'<small>Tages-Min/Max: Historie nicht abrufbar</small>':''}`);
    put('price',`<div class="heading"><h2>ϟ Preis <small>${this._data.prices?.some(p=>dayKey(new Date(p.time),zone)===w.tomorrow)?'heute + morgen':'heute'}</small></h2><strong>${this._value(c.entities.current_price,1)}<small>ct/kWh</small></strong></div>${this._data.prices?.length?`<button class="price-open" type="button" aria-label="Strompreisdiagramm vergrößern">${this._graph(now,w)}<span>Vergrößern ↗</span></button>`:this._graph(now,w)}${this._errors.prices?'<small class="red">Preisabruf fehlgeschlagen – ggf. letzte Daten</small>':''}`);
    const priceOpen=root.querySelector('.price-open');if(priceOpen)priceOpen.onclick=()=>{this._renderPriceDetail();root.querySelector('dialog').showModal();};
    if(root.querySelector('dialog').open)this._renderPriceDetail();
    const plug=h.states[c.entities.vehicle_plug]?.state,charging=h.states[c.entities.vehicle_charging]?.state;
    put('car',`<h2>🚘 ${esc(c.vehicle_name)}</h2><div class="heading"><strong class="big yellow">${this._value(c.entities.vehicle_soc,0,'%')}</strong><span>Ladeziel ${this._value(c.entities.vehicle_target_soc,0,'%')}</span></div><small>Reichweite ${this._value(c.entities.vehicle_range,0,' km')} · Heute ${this._value(c.entities.vehicle_charged_today,1,' kWh')}</small><small class="${charging==='on'?'green':plug==='off'?'red':''}">${charging==='on'?'Lädt':plug==='on'?'Verbunden':plug==='off'?'Getrennt':'Status unbekannt'}</small>`);
    put('pv',`<h2>☀ BKW & Batteriespeicher</h2><div class="energy-values"><div><strong>${this._value(c.entities.pv_power,0)} <small>W</small></strong><small>Heute ${this._value(c.entities.pv_energy_today,2,' kWh')}</small></div><div class="battery"><strong>${this._value(c.battery_soc,0,'%')}</strong><small>Speicher-SOC</small></div></div>`);
    const events=this._data.events||[],pages=Math.max(1,Math.ceil(events.length/4)),page=this._page%pages;
    put('calendar',`<h2>Heute & morgen</h2>${this._errors.events?'<p>Kalender nicht abrufbar</p>':events.length?events.slice(page*4,page*4+4).map(e=>{
      const startKey=dayKey(new Date(e.start),zone),label=startKey<=w.today?'Heute':'Morgen';
      return `<div class="event"><small class="cyan">${label} · ${e.allDay?'Ganztägig':this._time(new Date(e.start))}${!e.allDay&&startKey<w.today?' · seit Vortag':''}</small><div>${esc(e.summary)}</div></div>`;
    }).join(''):`<p>${!c.calendars.length?'Keine Kalender konfiguriert':this._data.events?'Keine Termine heute und morgen':'Termine werden geladen …'}</p>`}${pages>1?`<small>Seite ${page+1}/${pages} · Wechsel alle 15 s</small>`:''}${this._calendarFailures?'<small class="yellow">Einzelne Kalender nicht abrufbar</small>':''}`);
    const weather=h.states[c.weather],icon=WEATHER[weather?.state]||['—','Wetter nicht verfügbar'],daily=this._errors.daily?[]:this._data.daily||[],hourly=this._errors.hourly?[]:(this._data.hourly||[]).filter(f=>Date.parse(f.datetime)>=now.getTime()).slice(0,6);
    put('weather',`<div class="heading"><h2>Wetter</h2><span>${icon[0]}</span></div><div class="heading"><strong class="big">${weather?.attributes.temperature!=null&&Number.isFinite(Number(weather.attributes.temperature))?esc(weather.attributes.temperature):'—'}°</strong><span>${esc(icon[1])}</span></div><div class="hours">${hourly.map(f=>`<div><small>${this._time(new Date(f.datetime))}</small><span>${(WEATHER[f.condition]||['—'])[0]}</span><b>${esc(f.temperature??'—')}°</b></div>`).join('')}</div><div class="days">${daily.filter(f=>dayKey(new Date(f.datetime),zone)>=w.today).slice(0,5).map(f=>`<div><b>${new Intl.DateTimeFormat('de-DE',{weekday:'short',timeZone:zone}).format(new Date(f.datetime))}</b><span>${(WEATHER[f.condition]||['—'])[0]}</span><span>${esc(f.templow??'—')}°</span><b>${esc(f.temperature??'—')}°</b></div>`).join('')}</div>${this._errors.daily?'<small class="yellow">Tagesvorhersage nicht verfügbar</small>':''}${this._errors.hourly?'<small class="yellow">Stundenvorhersage nicht verfügbar</small>':''}`);
    put('night',c.allow_night_action&&c.night_script?`<button type="button">☾ Alles aus · Gute Nacht</button><small>${h.states[c.night_script]?.state==='on'?'Ablauf läuft …':this._nightStatus||'Tippen zum Starten'}</small>`:'<h2>☾ Gute Nacht</h2><small>Bedienung gesperrt</small>');
    const button=root.querySelector('#night button');if(button)button.onclick=async()=>{
      button.disabled=true;try{await h.callService('script','turn_on',{entity_id:c.night_script});this._nightStatus='Gestartet';}catch(e){this._nightStatus='Start fehlgeschlagen';}this._render();
    };
  }
  _priceWindow(now=new Date()){
    const w=dayWindow(now,this._zone()),all=this._data.prices||[];
    const tomorrow=all.some(p=>dayKey(new Date(p.time),this._zone())===w.tomorrow);
    const end=tomorrow?w.end:midnight(w.tomorrow,this._zone());
    return {w,end,rows:all.filter(p=>p.time>=w.start.getTime()&&p.time<end.getTime())};
  }
  _renderPriceDetail(){
    const root=this.shadowRoot,{w,end,rows}=this._priceWindow();
    root.querySelector('.price-detail-chart').innerHTML=this._graph(new Date(),w,true);
    const slider=root.querySelector('.price-slider');slider.max=Math.max(0,rows.length-1);slider.disabled=!rows.length;
    root.querySelector('.price-detail-status').textContent=this._errors.prices?'Preisabruf fehlgeschlagen – ggf. letzte Daten.':'Preise laut Tibber · Zeitzone '+this._zone();
    if(!rows.length){root.querySelector('.price-readout').textContent='Keine Preisdaten verfügbar.';return;}
    const time=this._selectedPriceTime??Date.now();
    this._selectPrice(Math.max(0,rows.findLastIndex(p=>p.time<=time)));
    const svg=root.querySelector('.price-detail-chart svg');
    const select=e=>{
      const matrix=svg.getScreenCTM();if(!matrix)return;
      const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;
      const x=point.matrixTransform(matrix.inverse()).x;
      const time=w.start.getTime()+Math.max(0,Math.min(1,(x-38)/304))*(end-w.start);
      this._selectPrice(Math.max(0,rows.findLastIndex(p=>p.time<=time)));
    };
    svg.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();svg.setPointerCapture(e.pointerId);select(e);};
    svg.onpointermove=e=>{if(svg.hasPointerCapture(e.pointerId))select(e);};
    svg.onpointerup=e=>{if(svg.hasPointerCapture(e.pointerId)){select(e);svg.releasePointerCapture(e.pointerId);}};
  }
  _selectPrice(index){
    const root=this.shadowRoot,{w,end,rows}=this._priceWindow(),i=Math.max(0,Math.min(index,rows.length-1)),p=rows[i];if(!p)return;
    this._selectedPriceTime=p.time;
    const next=rows[i+1]?.time??Math.min(end.getTime(),p.time+(i?p.time-rows[i-1].time:900000));
    const date=new Intl.DateTimeFormat('de-DE',{timeZone:this._zone(),weekday:'short',day:'2-digit',month:'2-digit'}).format(new Date(p.time));
    const offset=new Intl.DateTimeFormat('de-DE',{timeZone:this._zone(),timeZoneName:'shortOffset'}).formatToParts(new Date(p.time)).find(p=>p.type==='timeZoneName')?.value||'';
    root.querySelector('.price-readout').textContent=`${date} · ${this._time(new Date(p.time))}–${this._time(new Date(next))} (${offset}) · ${p.price.toLocaleString('de-DE',{maximumFractionDigits:6})} ct/kWh`;
    const slider=root.querySelector('.price-slider');slider.value=i;slider.setAttribute('aria-valuetext',root.querySelector('.price-readout').textContent);
    const x=38+(p.time-w.start.getTime())/(end-w.start)*304;
    const cursor=root.querySelector('.price-cursor');if(cursor){cursor.setAttribute('d',`M${x} 20 V145`);cursor.removeAttribute('hidden');}
  }
  _graph(now,w,detail=false){
    const {end,rows}=this._priceWindow(now),tomorrow=end.getTime()===w.end.getTime();
    if(!rows.length)return '<p>Keine Preisdaten verfügbar.<br><small>tibber.get_prices muss eingerichtet sein.</small></p>';
    const low=Math.floor(Math.min(...rows.map(p=>p.price))/5)*5-2,high=Math.ceil(Math.max(...rows.map(p=>p.price))/5)*5+2;
    const x=t=>38+(t-w.start.getTime())/(end.getTime()-w.start.getTime())*304,y=p=>145-(p-low)/(high-low)*120;
    const steps=rows.map((p,i)=>{
      const next=rows[i+1]?.time??Math.min(end.getTime(),p.time+(rows.length>1?p.time-rows[i-1].time:900000));
      return `<path d="M ${x(p.time)} ${y(p.price)} H ${x(next)}${i+1<rows.length?` V ${y(rows[i+1].price)}`:''}" stroke="${p.price>=30?'#ff942e':'#13c5b0'}"/>`;
    }).join('');
    return `<svg viewBox="0 0 350 180" preserveAspectRatio="none" role="img" aria-label="Strompreisverlauf in Cent pro Kilowattstunde"><g fill="#9da5ab" font-size="9">${[low,(low+high)/2,high].map(p=>`<text x="0" y="${y(p)+4}">${p.toFixed(0)}</text><path d="M38 ${y(p)} H342" stroke="#ffffff14"/>`).join('')}${Array.from({length:tomorrow?8:4},(_,i)=>w.start.getTime()+i*6*3600000).map(t=>{
      return `<text x="${x(t)}" y="170" text-anchor="middle">${this._time(new Date(t))}</text>`;
    }).join('')}${tomorrow?`<text x="${x(midnight(w.tomorrow,this._zone()).getTime())+3}" y="15">Morgen</text><path d="M${x(midnight(w.tomorrow,this._zone()).getTime())} 20 V145" stroke="#ffffff44"/>`:''}</g><g fill="none" stroke-width="2">${steps}</g><path d="M${x(now.getTime())} 20 V145" stroke="#eee" stroke-dasharray="3 4"/>${detail?'<path class="price-cursor" d="" stroke="#ffda18" stroke-width="1.5"/>':''}</svg>`;
  }
}
const STYLE=`
.price-open{display:block;width:100%;height:calc(100% - 48px);padding:0;border:0;background:transparent;color:var(--muted);text-align:right;cursor:zoom-in}.price-open svg{height:calc(100% - 20px);max-height:none;margin:0}.price-open span{font-size:11px}.price-open:focus-visible,.price-close:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}.price-dialog{background:#171a1d;color:#f5f5f5;border:1px solid #59636d;border-radius:18px;width:min(1000px,94vw);max-height:92vh;overflow:auto;padding:20px}.price-dialog::backdrop{background:#000b}.price-dialog h2{margin:0}.price-dialog p{margin:12px 0}.price-close{min-height:44px;padding:8px 16px;background:#303940;color:white;border:1px solid #687580;border-radius:10px;font:inherit;cursor:pointer}.price-detail-chart svg{height:clamp(180px,48vh,430px);max-height:none;touch-action:none;cursor:crosshair}.price-readout{display:block;min-height:48px;padding:12px 0;font-size:18px;color:#ffda18;font-variant-numeric:tabular-nums}.price-slider-label{display:block;font-size:13px}.price-slider{display:block;width:100%;min-height:44px;accent-color:#6bd2dc}
:host{display:block;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--cyan:#6bd2dc;--muted:#9da5ab}*{box-sizing:border-box}main{background:radial-gradient(ellipse at 55% 45%,#454748,#17191b 85%);padding:12px 18px 18px;border-radius:16px}header{display:flex;justify-content:space-between;align-items:center;font-weight:650;height:30px;margin-bottom:10px;font-size:14px}header>span:last-child{color:var(--muted)}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:2.5fr 1fr 1.1fr .95fr;grid-template-areas:'climate price radar' 'climate calendar weather' 'car calendar weather' 'night pv weather';gap:14px;height:calc(100vh - var(--header-height,56px) - 90px);min-height:520px;max-height:1000px}.tile{background:#171a1de8;border-radius:22px;padding:14px;min-width:0;overflow:hidden}.climate{grid-area:climate;display:flex;flex-direction:column}.price{grid-area:price}.radar{grid-area:radar;padding:0;position:relative}.car{grid-area:car}.calendar{grid-area:calendar}.weather{grid-area:weather;display:flex;flex-direction:column;gap:6px}.weather>.heading{flex-shrink:0}.weather h2{margin:0}.weather .big{font-size:28px}.weather>.heading>span{font-size:13px}.night{grid-area:night;background:#08a7dd}.pv{grid-area:pv}.pv h2{font-size:13px;margin-bottom:8px}.energy-values{display:flex;align-items:center;justify-content:space-between;gap:8px}.energy-values strong{font-size:24px;white-space:nowrap}.energy-values strong small{display:inline}.energy-values .battery{text-align:right}.energy-values small{font-size:10px}h2{font-size:16px;margin:0 0 10px}p{font-size:14px;color:var(--muted)}small{display:block;font-size:11px;color:var(--muted);line-height:1.4}strong{font-size:18px}b{font-size:17px}.heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.heading>strong{text-align:right}.big{font-size:32px;line-height:1.2}.big small{display:inline}.cyan{color:var(--cyan)}.green{color:#7ac64f}.yellow{color:#ffda18}.red{color:#ff645d}.rooms{display:grid;flex:1;min-height:0;grid-template-rows:repeat(var(--room-count,8),minmax(0,1fr));gap:2px}.room{display:grid;grid-template-columns:1.05fr 1.15fr .7fr 1fr;align-items:center;gap:4px;min-height:0}.room>*{min-width:0}.room>div{white-space:nowrap}.room strong{font-size:13px}.room b{font-size:16px}.co2{font-size:12px;white-space:nowrap}.co2 small{display:inline;margin-left:2px;font-size:9px}.room small{font-size:9px}svg{width:100%;max-height:calc(100% - 56px);display:block;margin-top:6px}.hours{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:2px;margin:6px 0;flex-shrink:0}.hours>div{text-align:center}.hours span{display:block;font-size:18px;line-height:1.2;margin:4px 0}.hours b{font-size:12px}.hours small{font-size:10px;white-space:nowrap}.days{border-top:1px solid #ffffff33;padding-top:6px;display:grid;grid-auto-rows:minmax(0,1fr);flex:1;min-height:0}.days>div{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;align-items:center;min-height:0}.days b{font-size:14px}.days span{font-size:14px}.days span:nth-child(3){color:var(--muted)}.days b:last-child{text-align:right}.event{padding:6px 0;border-bottom:1px solid #ffffff12;font-size:13px;overflow-wrap:anywhere}.event small{font-size:10px}.event>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.night button{appearance:none;border:0;background:transparent;color:white;font:inherit;font-weight:700;font-size:18px;padding:0;text-align:left;cursor:pointer;min-height:44px}.night small{color:#e1f7ff}.radar-cover{height:100%;pointer-events:none;user-select:none}.radar-cover>*{height:100%;display:block}.radar h2,.radar p{padding:14px}@media(max-width:760px){main{padding:10px}.grid{height:auto;min-height:0;grid-template-columns:1fr 1fr;grid-template-rows:400px 250px 230px 120px;grid-template-areas:'climate weather' 'price radar' 'calendar calendar' 'car pv' 'night night'}.tile{padding:12px}.radar{padding:0}}`;
if(!customElements.get('home-dashboard'))customElements.define('home-dashboard',HomeDashboard);
window.customCards=window.customCards||[];
window.customCards.push({type:'home-dashboard',name:`Home Dashboard iPad V${VERSION}`,description:'Raumklima, Energie, Wetter und Termine im Querformat.'});

console.info(`Home Dashboard iPad v${VERSION} geladen`);
