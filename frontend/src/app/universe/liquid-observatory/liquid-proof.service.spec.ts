import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectLiquidOutput, LiquidProofInput } from './liquid-proof.service';
const fixture:LiquidProofInput=JSON.parse(readFileSync(resolve(process.cwd(),'../tools/liquid-proof/fixture.json'),'utf8'));
let module:WebAssembly.Module;
beforeAll(async()=>{module=await WebAssembly.compile(readFileSync('src/resources/liquid-proof/universe_liquid_proof.wasm'));});
async function inspect(input:LiquidProofInput=fixture){return inspectLiquidOutput(await WebAssembly.instantiate(module),input);}
describe('actual Elements secp256k1-zkp WASM unblinding',()=>{
 it('recovers exact asset and amount from real synthetic range/surjection proofs',async()=>{
  expect(await inspect()).toEqual({assetId:'17'.repeat(32),valueSat:'15000001',rangeproofValid:true,surjectionproofValid:true});
 });
 it('wipes entire one-use crypto memory after success',async()=>{
  const instance=await WebAssembly.instantiate(module);inspectLiquidOutput(instance,fixture);
  expect(new Uint8Array((instance.exports.memory as WebAssembly.Memory).buffer).every(b=>b===0)).toBe(true);
 });
 it('rejects a wrong key and wipes crypto memory after failure',async()=>{
  const instance=await WebAssembly.instantiate(module);
  expect(()=>inspectLiquidOutput(instance,{...fixture,blindingKey:'2b'.repeat(32)})).toThrow('Unblinding failed');
  expect(new Uint8Array((instance.exports.memory as WebAssembly.Memory).buffer).every(b=>b===0)).toBe(true);
 });
 it.each(['rangeproofHex','surjectionproofHex','outputHex'] as const)('rejects altered %s',async field=>{
  const original=fixture[field];const altered=original.slice(0,-2)+(original.endsWith('00')?'01':'00');
  await expect(inspect({...fixture,[field]:altered})).rejects.toThrow();
 });
 it('requires actual input generators rather than accepting proof presence',async()=>{
  await expect(inspect({...fixture,inputGenerators:[]})).rejects.toThrow();
  const generator=fixture.inputGenerators[0];
  await expect(inspect({...fixture,inputGenerators:[(generator.startsWith('0a')?'0b':'0a')+generator.slice(2)]})).rejects.toThrow('Surjection');
 });
 it.each(['00'.repeat(32),'ff'.repeat(32),'not a key'])('rejects invalid scalar %s',async blindingKey=>{
  await expect(inspect({...fixture,blindingKey})).rejects.toThrow();
 });
 it('rejects scripts, outpoints, trailing bytes, truncated outputs and oversized requests',async()=>{
  for(const outputHex of ['51','11'.repeat(32)+':0',fixture.outputHex+'00',fixture.outputHex.slice(0,-2),'00'.repeat(11001)]){
   await expect(inspect({...fixture,outputHex})).rejects.toThrow();
  }
 });
});
