import test from 'node:test';
import assert from 'node:assert/strict';
import {temperatureValue, heatingActivity, heatingSeries, historySeries, heatingIntervals} from '../www/home-dashboard/data.js';
const start=Date.parse('2026-11-06T00:00:00Z'),end=start+86400000;
const row=(hours,state,attributes={})=>({entity_id:'climate.demo',state,attributes,last_changed:new Date(start-3600000).toISOString(),last_updated:new Date(start+hours*3600000).toISOString()});
test('Climate history uses attribute timestamps and retains unavailable gaps',()=>{
  const series=heatingSeries([[row(-1,'heat',{current_temperature:20,temperature:21,hvac_action:'idle'}),row(2,'heat',{current_temperature:20.5,temperature:22,hvac_action:'heating'}),row(3,'unavailable'),row(4,'heat',{current_temperature:21,temperature:22,hvac_action:'idle'})]],{entity:'climate.demo'},start,end);
  assert.deepEqual(series.actual,[{time:start,value:20},{time:start+7200000,value:20.5},{time:start+10800000,value:null},{time:start+14400000,value:21}]);
  assert.deepEqual(series.target.map(p=>p.value),[21,22,null,22]);
  assert.deepEqual(series.activity.map(p=>p.value),[0,1,null,0]);
});
test('Separate sensor and binary sensor sources override climate attributes',()=>{
  const rows=[[{...row(0,'19.2'),entity_id:'sensor.demo_actual'}],[{...row(0,'21'),entity_id:'sensor.demo_target'}],[{...row(0,'on'),entity_id:'binary_sensor.demo_heating'}]];
  const result=heatingSeries(rows,{entity:'climate.demo',temperature_entity:'sensor.demo_actual',target_entity:'sensor.demo_target',heating_entity:'binary_sensor.demo_heating'},start,end);
  assert.equal(result.actual[0].value,19.2);assert.equal(result.target[0].value,21);assert.equal(result.activity[0].value,1);
});
test('History is ordered, clipped and deduplicated; missing history stays empty',()=>{
  const read=r=>temperatureValue(r);
  const series=historySeries([row(2,'21'),row(-2,'18'),row(-1,'19'),row(2,'22'),row(25,'24'),{state:'23',last_updated:'invalid'}],read,start,end);
  assert.deepEqual(series,[{time:start,value:19},{time:start+7200000,value:22}]);
  assert.deepEqual(heatingSeries([],{entity:'climate.missing'},start,end),{actual:[],target:[],activity:[]});
});
test('Unavailable values are never zero degrees and unknown activity is distinct from idle',()=>{
  for(const state of ['unknown','unavailable','', ' '])assert.equal(temperatureValue({state}),null);
  assert.equal(temperatureValue({state:'heat',attributes:{current_temperature:0}},'current_temperature'),0);
  assert.equal(temperatureValue({state:'unavailable',attributes:{temperature:22}},'temperature'),null);
  assert.equal(heatingActivity({state:'heat',attributes:{hvac_action:'heating'}},'hvac_action'),1);
  assert.equal(heatingActivity({state:'heat',attributes:{hvac_action:'idle'}},'hvac_action'),0);
  assert.equal(heatingActivity({state:'heat'},'hvac_action'),null);
});

test('High-frequency temperature updates produce one uninterrupted heating interval',()=>{
  const records=Array.from({length:3600},(_,i)=>({...row(0,'heat',{current_temperature:20+i/10000,hvac_action:'heating'}),last_updated:new Date(start+i*1000).toISOString()}));
  const series=heatingSeries([records],{entity:'climate.demo'},start,end);
  assert.equal(series.activity.length,3600);
  assert.deepEqual(heatingIntervals(series.activity,end),[{start,end}]);
});
test('A one-second idle or unknown state remains an exact gap at any sampling rate',()=>{
  const points=[{time:start,value:1},{time:start+1000,value:1},{time:start+2000,value:0},{time:start+3000,value:1},{time:start+4000,value:null},{time:start+5000,value:1}];
  assert.deepEqual(heatingIntervals(points,end),[
    {start,end:start+2000},
    {start:start+3000,end:start+4000},
    {start:start+5000,end}
  ]);
});
test('Leading idle, trailing unknown, empty history and zero-length intervals are not painted',()=>{
  assert.deepEqual(heatingIntervals([],end),[]);
  assert.deepEqual(heatingIntervals([{time:start,value:0},{time:start+1000,value:null}],end),[]);
  assert.deepEqual(heatingIntervals([{time:start,value:0},{time:start+1000,value:1},{time:start+2000,value:null}],end),[{start:start+1000,end:start+2000}]);
  assert.deepEqual(heatingIntervals([{time:end,value:1}],end),[]);
});
