import { readFileSync } from 'node:fs';
import { compileSimplicity,compilerImports } from '../../frontend/src/resources/simplicity-compiler/compiler.worker.js';
const module=await WebAssembly.compile(readFileSync(new URL('../../frontend/src/resources/simplicity-compiler/universe_simplicity_compiler.wasm',import.meta.url)));
const instance=await WebAssembly.instantiate(module,compilerImports(module));
console.log(JSON.stringify(compileSimplicity(instance,{source:'fn main() {}',arguments:{},witness:{}})));
