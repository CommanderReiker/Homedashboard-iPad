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
