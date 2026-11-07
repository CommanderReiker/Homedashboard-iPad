export const escapeHTML = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function dayKey(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(date).map(x => [x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function shiftDay(key, days) {
  const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10);
}
export function midnight(key, timeZone) {
  const target = Date.parse(`${key}T00:00:00Z`); let value = target;
  for (let i=0;i<4;i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
    const actual = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    value += target-actual;
  }
  return new Date(value);
}
export function dayWindow(now, zone) {
  const today=dayKey(now,zone), tomorrow=shiftDay(today,1);
  return {today,tomorrow,start:midnight(today,zone),end:midnight(shiftDay(today,2),zone)};
}
export function numberState(hass, id) {
  const v=hass.states[id]?.state;
  return v == null || String(v).trim()==='' || !Number.isFinite(Number(v)) ? null : Number(v);
}
export function selectPrices(response, home, window, factor=100) {
  const homes=response?.prices || {}; const keys=Object.keys(homes);
  if (!home && keys.length>1) throw new Error('Mehrere Tibber-Häuser: tibber_home konfigurieren.');
  if (home && !Object.hasOwn(homes,home)) throw new Error('Konfiguriertes Tibber-Haus nicht gefunden.');
  const rows=homes[home || keys[0]] || [];
  return rows.map(x=>({time:Date.parse(x.start_time),price:Number(x.price)*factor}))
    .filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.price)&&x.time>=window.start.getTime()&&x.time<window.end.getTime())
    .sort((a,b)=>a.time-b.time);
}
export function calendarEvents(response, window, zone) {
  const rows=[];
  for (const [calendar,data] of Object.entries(response || {})) {
    for (const e of data.events || []) {
      const allDay=/^\d{4}-\d{2}-\d{2}$/.test(e.start || '');
      const start=allDay ? midnight(e.start,zone).getTime() : Date.parse(e.start);
      const end=allDay ? midnight(e.end,zone).getTime() : Date.parse(e.end);
      if (!Number.isFinite(start)||!Number.isFinite(end)) continue;
      // Calendar end dates are exclusive, including all-day events.
      if (start<window.end.getTime()&&end>window.start.getTime()) rows.push({calendar,summary:e.summary||'Termin',start,end,allDay});
    }
  }
  return rows.sort((a,b)=>a.start-b.start || a.summary.localeCompare(b.summary,'de'));
}
export function historyExtrema(histories) {
  const out={};
  for (const history of histories || []) {
    const id=history.find(x=>x.entity_id)?.entity_id;
    const values=history.map(x=>x.state).filter(x=>x!=null&&String(x).trim()!==''&&Number.isFinite(Number(x))).map(Number);
    if (id && values.length) out[id]={min:Math.min(...values),max:Math.max(...values)};
  }
  return out;
}

// Recorder rows must retain attributes and last_updated: climate changes often
// leave the HVAC mode (and therefore last_changed) unchanged.
export function temperatureValue(record, attribute) {
  if (!record || ['unknown','unavailable'].includes(record.state)) return null;
  const value=attribute ? record.attributes?.[attribute] : record.state;
  return value == null || String(value).trim()==='' || !Number.isFinite(Number(value)) ? null : Number(value);
}
export function heatingActivity(record, attribute) {
  if (!record || ['unknown','unavailable'].includes(record.state)) return null;
  const value=attribute ? record.attributes?.[attribute] : record.state;
  if (['heating','on'].includes(value)) return 1;
  return ['idle','off','cooling','drying','fan','defrosting'].includes(value) ? 0 : null;
}
export function historySeries(history, read, start, end) {
  const rows=(history || []).map(row=>({time:Date.parse(row.last_updated || row.last_changed),value:read(row)}))
    .filter(p=>Number.isFinite(p.time)&&p.time<=end).sort((a,b)=>a.time-b.time);
  const points=[];
  for (const row of rows) {
    const point={...row,time:Math.max(start,row.time)};
    if (points.at(-1)?.time===point.time) points[points.length-1]=point;
    else points.push(point);
  }
  return points;
}
export function heatingSeries(histories, room, start, end) {
  const byId=new Map((histories || []).map(rows=>[rows.find(row=>row.entity_id)?.entity_id,rows]));
  return {
    actual:historySeries(byId.get(room.temperature_entity || room.entity),r=>temperatureValue(r,room.temperature_entity?null:'current_temperature'),start,end),
    target:historySeries(byId.get(room.target_entity || room.entity),r=>temperatureValue(r,room.target_entity?null:'temperature'),start,end),
    activity:historySeries(byId.get(room.heating_entity || room.entity),r=>heatingActivity(r,room.heating_entity?null:'hvac_action'),start,end)
  };
}

// Join only consecutive active samples. Even the shortest reported pause or
// unknown state closes the interval; there is no debounce or time smoothing.
export function heatingIntervals(points, end) {
  const intervals=[];let start=null;
  for (const point of points) {
    if (point.value===1) {
      if (start===null) start=point.time;
    } else if (start!==null) {
      if (point.time>start) intervals.push({start,end:point.time});
      start=null;
    }
  }
  if (start!==null && end>start) intervals.push({start,end});
  return intervals;
}
