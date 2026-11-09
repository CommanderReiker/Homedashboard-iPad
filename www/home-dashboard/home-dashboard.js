import {escapeHTML as esc, dayKey, dayWindow, midnight, numberState, selectPrices, calendarEvents, historyExtrema, temperatureValue, heatingActivity, heatingSeries, heatingIntervals} from './data.js?v=2.4.4';

const VERSION='2.4.4';
const DEFAULT_ENTITIES={"current_price": null, "pv_power": null, "pv_energy_today": null, "electricity_consumption_today": null, "electricity_cost_today": null, "vehicle_range": null, "vehicle_soc": null, "vehicle_plug": null, "vehicle_charging": null, "vehicle_target_soc": null, "vehicle_charged_today": null};
const WEATHER={sunny:['☀','Sonnig'],clear:['☀','Klar'],'clear-night':['☾','Klare Nacht'],cloudy:['☁','Bewölkt'],partlycloudy:['⛅','Teils bewölkt'],rainy:['🌧','Regen'],pouring:['🌧','Starkregen'],snowy:['❄','Schnee'],'snowy-rainy':['🌨','Schneeregen'],fog:['≋','Nebel'],windy:['≋','Windig'],'windy-variant':['≋','Windig'],lightning:['ϟ','Gewitter'],'lightning-rainy':['⛈','Gewitter'],hail:['🌨','Hagel'],exceptional:['⚠','Unwetter']};
export class HomeDashboard extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this._data={};this._errors={};this._last={};this._page=0;this._busy=false;}
  setConfig(config){
    if(config.view && !['home','heating'].includes(config.view))throw new Error('view muss home oder heating sein.');
    if(config.heating!==undefined&&(!config.heating||typeof config.heating!=='object'||Array.isArray(config.heating)))throw new Error('heating muss ein Objekt sein.');
    for(const key of ['switches','thermostats']){
      const rows=config.heating?.[key];
      if(rows!==undefined&&(!Array.isArray(rows)||rows.length>4||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row))))throw new Error(`heating.${key}: maximal vier Einträge mit name und entity verwenden.`);
    }
    this._generation=(this._generation||0)+1;this._heatingBusy=false;this._heatingHistory=null;this._heatingError=false;this._heatingAttempt=0;
    this._config={view:'home',heating:{},pm25:null,weather:null,calendars:[],rooms:[],battery_soc:null,vehicle_name:'Auto',vehicle_name_entity:null,night_script:null,allow_night_action:false,...config,entities:{...DEFAULT_ENTITIES,...config.entities},radar:{type:'custom:weather-radar-card',height:'100%',data_source:'DWD',past_minutes:60,forecast_minutes:60,forecast_refresh_minutes:15,zoom_level:8,...config.radar}};
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
    if(this._config.view==='heating'){
      this.shadowRoot.innerHTML=`<style>${STYLE}</style><main class="heating-page"><header><span class="clock"></span><span>Heizung · V${VERSION}</span></header><div class="heating-layout"><section class="automation-status" aria-label="Status der Heizungsautomatik"></section><div class="thermostats"></div></div></main>`;
      return;
    }
    this.shadowRoot.innerHTML=`<style>${STYLE}</style><main><header><span class="clock"></span><span>Home · V${VERSION}</span></header><div class="grid"><div class="left-column">${['climate','car','night'].map(x=>`<section class="tile ${x}" id="${x}"></section>`).join('')}</div>${['price','radar','weather'].map(x=>`<section class="tile ${x}" id="${x}"></section>`).join('')}<div class="middle-bottom">${['pv','calendar'].map(x=>`<section class="tile ${x}" id="${x}"></section>`).join('')}</div></div></main><dialog class="price-dialog" aria-labelledby="price-title"><div class="heading"><h2 id="price-title">Strompreise · ct/kWh</h2><button type="button" class="price-close" aria-label="Strompreisansicht schließen">Schließen</button></div><p>Im Diagramm tippen oder ziehen, um einen Preis auszuwählen.</p><div class="price-detail-chart"></div><output class="price-readout" aria-live="polite"></output><label class="price-slider-label">Zeitpunkt<input class="price-slider" type="range" min="0" step="1" aria-label="Preisintervall auswählen"></label><small class="price-detail-status"></small></dialog>`;
    const dialog=this.shadowRoot.querySelector('dialog');
    dialog.onclose=()=>this.shadowRoot.querySelector('.price-open')?.focus();
    this.shadowRoot.querySelector('.price-close').onclick=()=>dialog.close();
    dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.close();}});
    this.shadowRoot.querySelector('.price-slider').oninput=e=>this._selectPrice(Number(e.target.value));
    this._radarReady=false;
  }
  async _update(){
    if(!this._hass||!this._config||!this.isConnected)return;
    if(this._config.view==='heating'){this._renderHeating();await this._updateHeating();return;}
    this._render();
    if(this._busy)return;this._busy=true;
    const now=new Date(),w=dayWindow(now,this._zone());
    const historyIds=[...new Set([...this._config.rooms.map(r=>r[1]),this._config.pm25].filter(Boolean))];
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
      ['extrema',900000,async()=>historyExtrema(await this._hass.callApi('GET',`history/period/${encodeURIComponent(w.start.toISOString())}?filter_entity_id=${encodeURIComponent(historyIds.join(','))}&end_time=${encodeURIComponent(now.toISOString())}&minimal_response&no_attributes`))]];
    if(this._day!==w.today){this._day=w.today;this._last={};this._data={};}
    const enabled={prices:!!this._config.entities.current_price || !!this._config.tibber_home,events:this._config.calendars.length>0,daily:!!this._config.weather,hourly:!!this._config.weather,extrema:historyIds.length>0};
    await Promise.all(jobs.filter(([key,interval])=>enabled[key]&&(!this._last[key]||Date.now()-this._last[key]>interval)).map(async([key,,fn])=>{
      this._last[key]=Date.now();try{this._data[key]=await fn();delete this._errors[key];}catch(e){this._errors[key]=true;}
    }));
    this._busy=false;if(this.isConnected)this._render();
    if(this._config.view==='home')this._setupRadar();
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
    if(this._config.view==='heating'){this._renderHeating();return;}
    const root=this.shadowRoot,h=this._hass,c=this._config,now=new Date(),zone=this._zone(),w=dayWindow(now,zone);
    const put=(id,html)=>{root.getElementById(id).innerHTML=html;};
    root.querySelector('.clock').textContent=`${this._time(now)} · ${new Intl.DateTimeFormat('de-DE',{timeZone:zone,weekday:'long',day:'numeric',month:'long'}).format(now)}`;
    const climateRows=c.rooms.map(room=>({room}));
    if(c.pm25)climateRows.splice(Math.max(0,climateRows.length-1),0,{pm25:true});
    put('climate',`<div class="rooms" role="group" aria-label="Temperaturen und Luftqualität" style="--room-count:${Math.max(1,climateRows.length)}">${!climateRows.length?'<p>Räume im Dashboard-YAML konfigurieren</p>':''}${climateRows.map(item=>{
      if(item.pm25){
        const e=this._errors.extrema?null:this._data.extrema?.[c.pm25],fmt=n=>n.toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1});
        const unit=esc(h.states[c.pm25]?.attributes?.unit_of_measurement||'µg/m³');
        return `<div class="room pm25"><strong>PM2.5</strong><div><b class="pm25-current">${this._value(c.pm25,1)}</b><small>${unit}</small></div><span class="pm25-range"><span><small>Min heute</small><b>${e?fmt(e.min):'—'}</b></span><span><small>Max heute</small><b>${e?fmt(e.max):'—'}</b></span></span></div>`;
      }
      const [name,t,hum,co2,rain]=item.room;
      const n=co2?numberState(h,co2):null,e=this._errors.extrema?null:this._data.extrema?.[t];
      return `<div class="room"><strong>${esc(name)}</strong><div><b>${this._value(t,1,'°')}</b><small>${e?`↑${e.max.toFixed(1)}° ↓${e.min.toFixed(1)}°`:'↑— ↓—'}</small></div><span class="cyan">${this._value(hum,0,'%')}</span><span title="${rain?'Niederschlag heute':'CO₂'}" class="co2 ${rain?'cyan':n===null?'':n<1000?'green':n<2000?'yellow':'red'}">${rain?`${this._value(rain,1)}<small>${esc(h.states[rain]?.attributes?.unit_of_measurement || 'mm')}</small>`:co2?`${n===null?'—':`● ${Math.round(n)}`}<small>${n===null?'':'ppm'}</small>`:'—'}</span></div>`;
    }).join('')}</div>${this._errors.extrema?'<small>Tages-Min/Max: Historie nicht abrufbar</small>':''}`);
    put('price',`<div class="heading"><h2>ϟ Preis <small>${this._data.prices?.some(p=>dayKey(new Date(p.time),zone)===w.tomorrow)?'heute + morgen':'heute'}</small></h2><strong>${this._value(c.entities.current_price,1)}<small>ct/kWh</small></strong></div>${this._data.prices?.length?`<button class="price-open" type="button" aria-label="Strompreisdiagramm vergrößern">${this._graph(now,w)}<span>Vergrößern ↗</span></button>`:this._graph(now,w)}${this._errors.prices?'<small class="red">Preisabruf fehlgeschlagen – ggf. letzte Daten</small>':''}`);
    const priceOpen=root.querySelector('.price-open');if(priceOpen)priceOpen.onclick=()=>{this._renderPriceDetail();root.querySelector('dialog').showModal();};
    if(root.querySelector('dialog').open)this._renderPriceDetail();
    const plug=h.states[c.entities.vehicle_plug]?.state,charging=h.states[c.entities.vehicle_charging]?.state;
    const soc=numberState(h,c.entities.vehicle_soc),socColor=soc===null?'':soc<20?'red':soc<70?'yellow':'green';
    const nameState=h.states[c.vehicle_name_entity]?.state?.trim();
    const vehicleName=nameState&&!['unknown','unavailable'].includes(nameState)?nameState:c.vehicle_name;
    put('car',`<div class="heading car-header"><h2>🚘 ${esc(vehicleName)}</h2><small class="car-status ${charging==='on'?'green':plug==='off'?'red':''}">${charging==='on'?'Lädt':plug==='on'?'Verbunden':plug==='off'?'Getrennt':'Status unbekannt'}</small></div><div class="heading"><strong class="big ${socColor}">${this._value(c.entities.vehicle_soc,0,'%')}</strong><span>Ladeziel ${this._value(c.entities.vehicle_target_soc,0,'%')}</span></div><small>Reichweite ${this._value(c.entities.vehicle_range,0,' km')} · Heute ${this._value(c.entities.vehicle_charged_today,1,' kWh')}</small>`);
    const costUnit=esc(h.states[c.entities.electricity_cost_today]?.attributes?.unit_of_measurement||h.config?.currency||'€');
    put('pv',`<h2>ϟ Strom, BKW & Batterie</h2><div class="energy-values"><div class="consumption"><small>Verbrauch heute</small><strong>${this._value(c.entities.electricity_consumption_today,2)} <small>kWh</small></strong></div><div class="cost"><small>Stromkosten heute</small><strong>${this._value(c.entities.electricity_cost_today,2)} <small>${costUnit}</small></strong></div><div class="production"><small>BKW-Leistung</small><strong>${this._value(c.entities.pv_power,0)} <small>W</small></strong><small>Ertrag heute ${this._value(c.entities.pv_energy_today,2,' kWh')}</small></div><div class="battery"><small>Speicher-SOC</small><strong>${this._value(c.battery_soc,0,'%')}</strong></div></div>`);
    const events=this._data.events||[],pages=Math.max(1,Math.ceil(events.length/4)),page=this._page%pages;
    put('calendar',`<h2>Heute & morgen</h2>${this._errors.events?'<p>Kalender nicht abrufbar</p>':events.length?events.slice(page*4,page*4+4).map(e=>{
      const startKey=dayKey(new Date(e.start),zone),label=startKey<=w.today?'Heute':'Morgen';
      return `<div class="event"><small class="cyan">${label} · ${e.allDay?'Ganztägig':this._time(new Date(e.start))}${!e.allDay&&startKey<w.today?' · seit Vortag':''}</small><div title="${esc(e.summary)}">${esc(e.summary)}</div></div>`;
    }).join(''):`<p>${!c.calendars.length?'Keine Kalender konfiguriert':this._data.events?'Keine Termine heute und morgen':'Termine werden geladen …'}</p>`}${pages>1?`<small>Seite ${page+1}/${pages} · Wechsel alle 15 s</small>`:''}${this._calendarFailures?'<small class="yellow">Einzelne Kalender nicht abrufbar</small>':''}`);
    const weather=h.states[c.weather],icon=WEATHER[weather?.state]||['—','Wetter nicht verfügbar'],daily=this._errors.daily?[]:this._data.daily||[],hourly=this._errors.hourly?[]:(this._data.hourly||[]).filter(f=>Date.parse(f.datetime)>=now.getTime()).slice(0,6);
    put('weather',`<div class="heading"><h2>Wetter</h2><span>${icon[0]}</span></div><div class="heading"><strong class="big">${weather?.attributes.temperature!=null&&Number.isFinite(Number(weather.attributes.temperature))?esc(weather.attributes.temperature):'—'}°</strong><span>${esc(icon[1])}</span></div><div class="hours">${hourly.map(f=>`<div><small>${this._time(new Date(f.datetime))}</small><span>${(WEATHER[f.condition]||['—'])[0]}</span><b>${esc(f.temperature??'—')}°</b></div>`).join('')}</div><div class="days">${daily.filter(f=>dayKey(new Date(f.datetime),zone)>=w.today).slice(0,5).map(f=>`<div><b>${new Intl.DateTimeFormat('de-DE',{weekday:'short',timeZone:zone}).format(new Date(f.datetime))}</b><span>${(WEATHER[f.condition]||['—'])[0]}</span><span>${esc(f.templow??'—')}°</span><b>${esc(f.temperature??'—')}°</b></div>`).join('')}</div>${this._errors.daily?'<small class="yellow">Tagesvorhersage nicht verfügbar</small>':''}${this._errors.hourly?'<small class="yellow">Stundenvorhersage nicht verfügbar</small>':''}`);
    put('night',c.allow_night_action&&c.night_script?`<button type="button">☾ Alles aus · Gute Nacht</button><small>${h.states[c.night_script]?.state==='on'?'Ablauf läuft …':this._nightStatus||'Tippen zum Starten'}</small>`:'<h2>☾ Gute Nacht</h2><small>Bedienung gesperrt</small>');
    const button=root.querySelector('#night button');if(button)button.onclick=async()=>{
      button.disabled=true;try{await h.callService('script','turn_on',{entity_id:c.night_script});this._nightStatus='Gestartet';}catch(e){this._nightStatus='Start fehlgeschlagen';}this._render();
    };
  }
  _heatingRooms(){return this._config.heating.thermostats||[];}
  async _updateHeating(){
    const ids=[...new Set(this._heatingRooms().flatMap(r=>[r.entity,r.temperature_entity,r.target_entity,r.heating_entity]).filter(Boolean))];
    if(!ids.length||this._heatingBusy||Date.now()-this._heatingAttempt<300000)return;
    this._heatingBusy=true;this._heatingAttempt=Date.now();const generation=this._generation;
    const end=Date.now(),start=end-86400000;
    try{
      // Full attribute history is needed for climate temperatures and hvac_action.
      const rows=await this._hass.callApi('GET',`history/period/${encodeURIComponent(new Date(start).toISOString())}?filter_entity_id=${encodeURIComponent(ids.join(','))}&end_time=${encodeURIComponent(new Date(end).toISOString())}&significant_changes_only=0`);
      if(generation!==this._generation)return;
      if(!Array.isArray(rows)||rows.some(row=>!Array.isArray(row)))throw new Error('Ungültige Historie');
      this._heatingHistory={rows,start,end};this._heatingError=false;
    }catch(e){if(generation===this._generation)this._heatingError=true;}
    finally{if(generation===this._generation){this._heatingBusy=false;if(this.isConnected)this._renderHeating();}}
  }
  _renderHeating(){
    const root=this.shadowRoot,h=this._hass,c=this._config;
    root.querySelector('.clock').textContent=`${this._time(new Date())} · Letzte 24 Stunden`;
    const switches=c.heating.switches||[];
    root.querySelector('.automation-status').innerHTML=Array.from({length:4},(_,i)=>{
      const item=switches[i],state=h.states[item?.entity]?.state;
      const label=!item?.entity?'Nicht konfiguriert':state==='on'?'Aktiv':state==='off'?'Aus':'Nicht verfügbar';
      return `<div class="automation-item"><span class="status-dot ${state==='on'?'active':state==='off'?'inactive':'unknown'}" aria-hidden="true"></span><div><span class="automation-name" title="${esc(item?.name||`Automatik ${i+1}`)}">${esc(item?.name||`Automatik ${i+1}`)}</span><small>${label}</small></div></div>`;
    }).join('');
    root.querySelector('.thermostats').innerHTML=Array.from({length:4},(_,i)=>{
      const room=this._heatingRooms()[i];
      if(!room)return `<section class="thermostat tile empty"><h2>Regler ${i+1}</h2><p>Heizungsregler noch nicht konfiguriert</p></section>`;
      const state=h.states[room.entity],name=room.name||state?.attributes?.friendly_name||`Regler ${i+1}`;
      const actual=temperatureValue(h.states[room.temperature_entity||room.entity],room.temperature_entity?null:'current_temperature');
      const target=temperatureValue(h.states[room.target_entity||room.entity],room.target_entity?null:'temperature');
      const active=heatingActivity(h.states[room.heating_entity||room.entity],room.heating_entity?null:'hvac_action');
      const action=active===1?'Heizt':active===0?'Heizpause':'Heizstatus unbekannt';
      const unit=esc(h.config?.unit_system?.temperature||'°C');
      const fmt=n=>n===null?'—':n.toLocaleString('de-DE',{maximumFractionDigits:1})+' '+unit;
      const history=this._heatingHistory;
      const chart=history?this._heatingGraph(room,name,history):'<div class="heating-empty">'+(this._heatingError?'Historie nicht abrufbar':this._heatingBusy?'Verlauf wird geladen …':room.entity||room.temperature_entity?'Verlauf wird geladen …':'Entitäten lokal konfigurieren')+'</div>';
      const note=this._heatingError?'Historie nicht abrufbar'+(history?' · letzter erfolgreicher Abruf '+this._time(new Date(history.end)):''):history?'Stand '+this._time(new Date(history.end))+' · HA-Zeitzone':'';
      return `<section class="thermostat tile"><div class="heading"><h2 title="${esc(name)}">${esc(name)}</h2><small class="heat-action ${active===1?'heating-active':''}">${action}</small></div>${chart}<div class="heating-legend"><span class="actual">● Ist <strong>${fmt(actual)}</strong></span><span class="target">● Soll <strong>${fmt(target)}</strong></span><small>▥ Heizphasen</small></div><small class="history-note ${this._heatingError?'yellow':''}">${note}</small></section>`;
    }).join('');
  }
  _heatingGraph(room,name,history){
    const {start,end}=history,series=heatingSeries(history.rows,room,start,end);
    const values=[...series.actual,...series.target].filter(p=>p.value!==null).map(p=>p.value);
    if(!values.length)return '<div class="heating-empty">Keine Temperaturhistorie verfügbar</div>';
    const [min,max]=values.reduce(([low,high],n)=>[Math.min(low,n),Math.max(high,n)],[Infinity,-Infinity]);
    const low=Math.floor(min)-1,high=Math.ceil(max)+1;
    const x=t=>36+(t-start)/(end-start)*394,y=v=>118-(v-low)/(high-low)*96;
    const line=(points,step)=>{
      let d='',previous=null;
      for(const p of points){
        if(p.value===null){if(previous)d+=` H${x(p.time)}`;previous=null;continue;}
        d+=previous?(step?` H${x(p.time)} V${y(p.value)}`:` L${x(p.time)} ${y(p.value)}`):` M${x(p.time)} ${y(p.value)}`;
        previous=p;
      }
      if(previous)d+=` H${x(end)}`;
      return d;
    };
    const bands=heatingIntervals(series.activity,end).map(interval=>`<rect x="${x(interval.start)}" y="22" width="${x(interval.end)-x(interval.start)}" height="96" fill="#ff645d" opacity=".42"/>`).join('');
    return `<svg class="heating-chart" viewBox="0 0 440 146" preserveAspectRatio="none" role="img" aria-label="${esc(name)}: Isttemperatur blau, Solltemperatur gelb und Heizphasen rot; letzte 24 Stunden"><g font-size="10" fill="#aeb6bd">${Array.from({length:4},(_,i)=>low+(high-low)*i/3).map(v=>`<path d="M36 ${y(v)} H430" stroke="#ffffff1c"/><text x="30" y="${y(v)+3}" text-anchor="end">${v.toLocaleString('de-DE',{maximumFractionDigits:1})}</text>`).join('')}${Array.from({length:5},(_,i)=>start+i*21600000).map((t,i)=>`<path d="M${x(t)} 22 V118" stroke="#ffffff12"/><text x="${x(t)}" y="138" text-anchor="${i===0?'start':i===4?'end':'middle'}">${this._time(new Date(t))}</text>`).join('')}<text x="6" y="12">${esc(this._hass.config?.unit_system?.temperature||'°C')}</text></g>${bands}<path class="actual-line" d="${line(series.actual,false)}" fill="none" stroke="#6593ff" stroke-width="2"/><path class="target-line" d="${line(series.target,true)}" fill="none" stroke="#f6c65b" stroke-width="2"/></svg>`;
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

.heating-layout{height:calc(100vh - var(--header-height,56px) - 90px);min-height:520px;max-height:1000px;display:flex;flex-direction:column;gap:14px}.automation-status{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;flex-shrink:0}.automation-item{display:flex;align-items:center;gap:10px;background:#171a1de8;border:1px solid #ffffff12;border-radius:14px;padding:12px;min-width:0}.automation-item>div{min-width:0}.automation-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}.status-dot{width:10px;height:10px;border-radius:50%;background:#d8b15d;flex-shrink:0}.status-dot.active{background:#83cb75;box-shadow:0 0 10px #83cb7540}.status-dot.inactive{background:#818991}.thermostats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));gap:14px;flex:1;min-height:0}.thermostat{display:flex;flex-direction:column;border:1px solid #ffffff15}.thermostat>.heading{flex-shrink:0;min-height:22px}.thermostat h2{margin:0;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.heat-action{white-space:nowrap;font-size:10px}.heating-active{color:#ff645d}.thermostat .heating-chart{display:block;flex:1;width:100%;height:0;min-height:80px;max-height:none;margin:8px 0}.heating-legend{display:flex;align-items:center;gap:18px;flex-shrink:0;flex-wrap:wrap;font-size:12px}.heating-legend strong{font-size:15px;margin-left:4px;white-space:nowrap}.heating-legend .actual{color:#8aacff}.heating-legend .target{color:#f6c65b}.heating-legend small{font-size:10px;color:#ff645d}.history-note{font-size:10px;min-height:14px;margin-top:5px}.heating-empty{display:grid;place-content:center;flex:1;min-height:80px;color:var(--muted);font-size:13px;text-align:center}.thermostat.empty p{margin:auto;text-align:center}@media(max-width:760px){.heating-layout{height:auto;min-height:0;max-height:none}.automation-status{grid-template-columns:repeat(2,minmax(0,1fr))}.thermostats{grid-template-columns:minmax(0,1fr);grid-template-rows:repeat(4,260px)}.automation-item{padding:10px}.heating-legend{gap:12px}}
.price-open{display:block;width:100%;height:calc(100% - 48px);padding:0;border:0;background:transparent;color:var(--muted);text-align:right;cursor:zoom-in}.price-open svg{height:calc(100% - 20px);max-height:none;margin:0}.price-open span{font-size:11px}.price-open:focus-visible,.price-close:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}.price-dialog{background:#171a1d;color:#f5f5f5;border:1px solid #59636d;border-radius:18px;width:min(1000px,94vw);max-height:92vh;overflow:auto;padding:20px}.price-dialog::backdrop{background:#000b}.price-dialog h2{margin:0}.price-dialog p{margin:12px 0}.price-close{min-height:44px;padding:8px 16px;background:#303940;color:white;border:1px solid #687580;border-radius:10px;font:inherit;cursor:pointer}.price-detail-chart svg{height:clamp(180px,48vh,430px);max-height:none;touch-action:none;cursor:crosshair}.price-readout{display:block;min-height:48px;padding:12px 0;font-size:18px;color:#ffda18;font-variant-numeric:tabular-nums}.price-slider-label{display:block;font-size:13px}.price-slider{display:block;width:100%;min-height:44px;accent-color:#6bd2dc}
:host{display:block;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--cyan:#6bd2dc;--muted:#9da5ab}*{box-sizing:border-box}main{background:radial-gradient(ellipse at 55% 45%,#454748,#17191b 85%);padding:12px 18px 18px;border-radius:16px}header{display:flex;justify-content:space-between;align-items:center;font-weight:650;height:30px;margin-bottom:10px;font-size:14px}header>span:last-child{color:var(--muted)}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:2.5fr 1fr 1.1fr .95fr;grid-template-areas:'left price radar' 'left middle weather' 'left middle weather' 'left middle weather';gap:14px;height:calc(100vh - var(--header-height,56px) - 90px);min-height:520px;max-height:1000px}.tile{background:#171a1de8;border-radius:22px;padding:14px;min-width:0;overflow:hidden}.middle-bottom{grid-area:middle;display:grid;grid-template-rows:minmax(136px,.95fr) minmax(140px,1fr);gap:14px;min-height:0;min-width:0}.middle-bottom>.tile{grid-area:auto;min-height:0}.left-column{grid-area:left;display:grid;grid-template-rows:minmax(0,4fr) minmax(100px,1.1fr) 64px;gap:14px;min-height:0;min-width:0}.left-column>.tile{grid-area:auto;min-height:0}.climate{grid-area:climate;display:flex;flex-direction:column}.price{grid-area:price}.radar{grid-area:radar;padding:0;position:relative}.car{grid-area:car}.car-header{margin-bottom:4px}.car-header h2{margin:0;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.car-status{flex-shrink:0}.car .big{font-size:28px}.calendar{grid-area:calendar;display:flex;flex-direction:column;gap:2px;padding:10px 12px}.calendar h2{font-size:12px;line-height:14px;margin:0}.calendar .event{display:grid;grid-template-columns:90px minmax(0,1fr);align-items:center;gap:6px;padding:2px 0;border-bottom:1px solid #ffffff12;font-size:11px;line-height:13px;min-height:18px}.calendar .event small{font-size:9px;line-height:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.calendar>small{font-size:8px;line-height:10px}.calendar p{margin:0;font-size:11px}.weather{grid-area:weather;display:flex;flex-direction:column;gap:6px}.weather>.heading{flex-shrink:0}.weather h2{margin:0}.weather .big{font-size:28px}.weather>.heading>span{font-size:13px}.night{grid-area:night;background:#08a7dd;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px}.night h2{margin:0;font-size:15px}.night small{font-size:9px;max-width:38%;text-align:right}.pv{grid-area:pv;padding:12px}.pv h2{font-size:13px;line-height:15px;margin-bottom:7px}.energy-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:6px 10px}.energy-values>div{min-width:0}.energy-values strong{display:block;font-size:20px;line-height:1.15;white-space:nowrap;font-variant-numeric:tabular-nums}.energy-values strong small{display:inline;font-weight:400}.energy-values small{font-size:10px;line-height:1.2}h2{font-size:16px;margin:0 0 10px}p{font-size:14px;color:var(--muted)}small{display:block;font-size:11px;color:var(--muted);line-height:1.4}strong{font-size:18px}b{font-size:17px}.heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.heading>strong{text-align:right}.big{font-size:32px;line-height:1.2}.big small{display:inline}.cyan{color:var(--cyan)}.green{color:#7ac64f}.yellow{color:#ffda18}.red{color:#ff645d}.rooms{display:grid;flex:1;min-height:0;grid-template-rows:repeat(var(--room-count,8),minmax(0,1fr));gap:2px}.room{display:grid;grid-template-columns:1.05fr 1.15fr .7fr 1fr;align-items:center;gap:4px;min-height:0}.room>*{min-width:0}.room.pm25{grid-template-columns:1.05fr 1.15fr 1.7fr}.pm25-range{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.room .pm25-range b{font-size:12px}.pm25-range>span{min-width:0}.pm25-range small{white-space:nowrap}.room>div{white-space:nowrap}.room strong{font-size:13px}.room b{font-size:16px}.co2{font-size:12px;white-space:nowrap}.co2 small{display:inline;margin-left:2px;font-size:9px}.room small{font-size:9px}svg{width:100%;max-height:calc(100% - 56px);display:block;margin-top:6px}.hours{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:2px;margin:6px 0;flex-shrink:0}.hours>div{text-align:center}.hours span{display:block;font-size:18px;line-height:1.2;margin:4px 0}.hours b{font-size:12px}.hours small{font-size:10px;white-space:nowrap}.days{border-top:1px solid #ffffff33;padding-top:6px;display:grid;grid-auto-rows:minmax(0,1fr);flex:1;min-height:0}.days>div{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;align-items:center;min-height:0}.days b{font-size:14px}.days span{font-size:14px}.days span:nth-child(3){color:var(--muted)}.days b:last-child{text-align:right}.event{padding:6px 0;border-bottom:1px solid #ffffff12;font-size:13px;overflow-wrap:anywhere}.event small{font-size:10px}.event>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.night button{appearance:none;border:0;background:transparent;color:white;font:inherit;font-weight:700;font-size:15px;padding:0;text-align:left;cursor:pointer;min-height:44px}.night small{color:#e1f7ff}.radar-cover{height:100%;pointer-events:none;user-select:none}.radar-cover>*{height:100%;display:block}.radar h2,.radar p{padding:14px}@media(max-width:760px){main{padding:10px}.left-column,.middle-bottom{display:contents}.middle-bottom>.pv{grid-area:pv}.middle-bottom>.calendar{grid-area:calendar}.left-column>.climate{grid-area:climate}.left-column>.car{grid-area:car}.left-column>.night{grid-area:night;padding:8px 12px}.grid{grid-auto-rows:64px}.grid{height:auto;min-height:0;grid-template-columns:1fr 1fr;grid-template-rows:400px 250px 160px 170px 120px;grid-template-areas:'climate weather' 'price radar' 'pv pv' 'calendar calendar' 'car car' 'night night'}.tile{padding:12px}.radar{padding:0}}`;
if(!customElements.get('home-dashboard'))customElements.define('home-dashboard',HomeDashboard);
window.customCards=window.customCards||[];
window.customCards.push({type:'home-dashboard',name:`Home Dashboard iPad V${VERSION}`,description:'Raumklima, Energie, Wetter und Termine im Querformat.'});

console.info(`Home Dashboard iPad v${VERSION} geladen`);
