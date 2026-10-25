import test from 'node:test';
import assert from 'node:assert/strict';
import {dayWindow,dayKey,midnight,selectPrices,calendarEvents,historyExtrema,escapeHTML,numberState} from '../www/home-dashboard/data.js';
const zone='Europe/Berlin';
test('Zeitumstellung Herbst: zwei lokale Tage umfassen 49 Stunden',()=>{
  const w=dayWindow(new Date('2026-10-25T12:00:00Z'),zone);
  assert.equal(w.today,'2026-10-25');assert.equal(w.tomorrow,'2026-10-26');
  assert.equal((w.end-w.start)/3600000,49);
});
test('Zeitumstellung Frühling: zwei lokale Tage umfassen 47 Stunden',()=>{
  const w=dayWindow(new Date('2026-03-29T12:00:00Z'),zone);
  assert.equal((w.end-w.start)/3600000,47);
});
test('Tagesgrenze kommt aus HA-Zeitzone statt UTC',()=>{
  assert.equal(dayKey(new Date('2026-07-01T23:00:00Z'),zone),'2026-07-02');
  assert.equal(midnight('2026-07-02',zone).toISOString(),'2026-07-01T22:00:00.000Z');
});
test('Tibber: EUR nach Cent, negative Preise, Sortierung und morgen',()=>{
  const w=dayWindow(new Date('2026-10-20T12:00:00Z'),zone);
  const rows=selectPrices({prices:{Haus:[{start_time:'2026-10-21T00:00:00+02:00',price:.21},{start_time:'2026-10-20T00:00:00+02:00',price:-.02},{start_time:'invalid',price:3}]}},null,w);
  assert.equal(rows.length,2);assert.equal(rows[0].price,-2);assert.equal(rows[1].price,21);
});
test('Tibber: bei mehreren Häusern wird nicht still das falsche ausgewählt',()=>{
  const w=dayWindow(new Date(),zone),r={prices:{A:[],B:[]}};
  assert.throws(()=>selectPrices(r,null,w),/Mehrere/);assert.deepEqual(selectPrices(r,'B',w),[]);
  assert.throws(()=>selectPrices(r,'C',w),/nicht gefunden/);
});
test('Tibber: leere Morgenpreise bleiben leer und Viertelstunden bleiben erhalten',()=>{
  const w=dayWindow(new Date('2026-10-20T12:00:00Z'),zone);
  const rows=Array.from({length:96},(_,i)=>({start_time:new Date(w.start.getTime()+i*900000).toISOString(),price:.25}));
  const out=selectPrices({prices:{Haus:rows}},null,w);
  assert.equal(out.length,96);assert.ok(out.every(x=>dayKey(new Date(x.time),zone)===w.today));
});
test('Kalender: exklusive Enden, mehrtägige Termine und Sortierung',()=>{
  const w=dayWindow(new Date('2026-10-20T12:00:00Z'),zone);
  const rows=calendarEvents({'calendar.a':{events:[
    {summary:'Vorbei',start:'2026-10-19',end:'2026-10-20'},
    {summary:'Morgen',start:'2026-10-21T10:00:00+02:00',end:'2026-10-21T11:00:00+02:00'},
    {summary:'Ferien',start:'2026-10-18',end:'2026-10-23'},
    {summary:'Heute',start:'2026-10-20T12:00:00+02:00',end:'2026-10-20T13:00:00+02:00'},
    {summary:'Zu spät',start:'2026-10-22',end:'2026-10-23'},
  ]}},w,zone);
  assert.deepEqual(rows.map(x=>x.summary),['Ferien','Heute','Morgen']);assert.equal(rows[0].allDay,true);
});
test('Ausfälle werden nicht als null Grad dargestellt',()=>{
  const hass={states:{a:{state:'unavailable'},b:{state:'unknown'},c:{state:'0'},d:{state:''}}};
  assert.equal(numberState(hass,'a'),null);assert.equal(numberState(hass,'b'),null);assert.equal(numberState(hass,'c'),0);assert.equal(numberState(hass,'d'),null);
});
test('Historie: kompakte HA-Antwort, ungültige Werte ausschließen',()=>{
  assert.deepEqual(historyExtrema([[{entity_id:'sensor.t',state:'20.1'},{state:'unknown'},{state:'21.3'},{state:''}]]),{'sensor.t':{min:20.1,max:21.3}});
});
test('Kalendertitel und Namen können kein HTML einschleusen',()=>{
  assert.equal(escapeHTML('<img src="x" onerror="alert(1)">'), '&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
});
