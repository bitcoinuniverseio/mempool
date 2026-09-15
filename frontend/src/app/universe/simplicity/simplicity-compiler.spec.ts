import { beforeAll,describe,expect,it,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileSimplicity,compilerImports } from '../../../resources/simplicity-compiler/compiler.worker.js';
import { SimplicityToolsComponent } from './simplicity-tools.component';
let module:WebAssembly.Module;
beforeAll(async()=>{module=await WebAssembly.compile(readFileSync('src/resources/simplicity-compiler/universe_simplicity_compiler.wasm'));});
async function compile(source:string,witness={},args={}) {return compileSimplicity(await WebAssembly.instantiate(module,compilerImports(module)),{source,witness,arguments:args});}
describe('actual pinned SimplicityHL compiler WASM',()=>{
 it('enforces the 128 MiB WASM memory ceiling',async()=>{
  const instance=await WebAssembly.instantiate(module,compilerImports(module));
  expect(()=>(instance.exports.memory as WebAssembly.Memory).grow(2049)).toThrow();
 });
 it('matches canonical unit program encoding and independently specified CMR',async()=>{
  const result=await compile('fn main() {}');
  expect(result.program_base64).toBe('JA==');expect(result.cmr).toBe('c40a10263f7436b4160acbef1c36fba4be4d95df181a968afeab5eac247adff7');
  expect(result.static_cost).toBe('100');expect(result.cmr_redecoded).toBe(true);
 });
 it('compiles the displayed sample and derives its exact typed witness bytes',async()=>{
  const page=new SimplicityToolsComponent({markForCheck:vi.fn()} as any,{} as any);
  const initial=await compile(page.sourceCode);expect(initial.program_base64).not.toBe('JA==');
  page.loadSample();const sample=await compile(page.sourceCode,JSON.parse(page.witnessJson));
  expect(sample.witness_base64).toBe('AAAAKg==');expect(sample.cmr).not.toBe(initial.cmr);
  expect(Number(sample.static_cost)).toBeGreaterThan(100);expect(sample.memory_bound).toBeGreaterThan(0);
 });
 it('changes the program commitment when source semantics change',async()=>{
  const a=await compile('fn main() { assert!(jet::eq_32(1, 1)); }');
  const b=await compile('fn main() { assert!(jet::eq_32(2, 2)); }');
  expect(a.cmr).not.toBe(b.cmr);expect(a.program_base64).not.toBe(b.program_base64);
 });
 it.each(['broken source','fn main() { let x: u32 = true; }','fn main() { jet::not_a_real_jet(); }','fn main() { let x: u32 = witness::MISSING; assert!(jet::eq_32(x, 42)); }'])('reports real syntax/type/jet/witness errors',async source=>{
  await expect(compile(source)).rejects.toThrow();
 });
 it('type-checks witness data and keeps witness changes outside CMR',async()=>{
  const source='fn main() { let x: u32 = witness::VALUE; assert!(jet::eq_32(x, 42)); }';
  const a=await compile(source,{VALUE:{value:'42',type:'u32'}}),b=await compile(source,{VALUE:{value:'43',type:'u32'}});
  expect(a.cmr).toBe(b.cmr);expect(a.witness_base64).not.toBe(b.witness_base64);
  await expect(compile(source,{VALUE:{value:'true',type:'bool'}})).rejects.toThrow();
 });
 it('rejects oversized source and wipes single-use memory',async()=>{
  const instance=await WebAssembly.instantiate(module,compilerImports(module));
  expect(()=>compileSimplicity(instance,{source:'x'.repeat(16001)})).toThrow();
  expect(new Uint8Array((instance.exports.memory as WebAssembly.Memory).buffer).every(x=>x===0)).toBe(true);
 });
});
