import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Production code and HACS bundle contain no literal HA entity assignments',async()=>{
  for(const file of ['www/home-dashboard/home-dashboard.js','www/home-dashboard/data.js','dist/Homedashboard-iPad.js']){
    const code=await readFile(new URL('../'+file,import.meta.url),'utf8');
    const literals=code.match(/['"`](?:sensor|binary_sensor|weather|calendar|script|person|device_tracker|climate|switch|input_boolean|input_text|automation)\.[a-z0-9_]+['"`]/g);
    assert.equal(literals,null,`${file} must obtain IDs exclusively from local configuration`);
  }
});
