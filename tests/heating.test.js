import test from 'node:test';
import assert from 'node:assert/strict';
import {temperatureValue, heatingActivity, heatingSeries, historySeries} from '../www/home-dashboard/data.js';
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
