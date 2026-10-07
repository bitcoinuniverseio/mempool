import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import path from 'path';
export function isolatedBackend(file: string, mocks: Record<string, any>) {
  const absolute=path.join(__dirname,'..','src',file);
  const code=ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const mod={exports:{}};
  vm.runInNewContext(code,{module:mod,exports:mod.exports,Buffer,console,process,Date,setTimeout,clearTimeout,URL,
    require:(name: string) => name in mocks ? mocks[name] : name.startsWith('.') ? {__esModule:true,default:{}} : require(name),
  },{filename:absolute});
  return mod.exports as any;
}
export const defaultMock=(value: any) => ({__esModule:true,default:value});
export const quietLogger=defaultMock({debug:()=>{},notice:()=>{},info:()=>{},warn:()=>{},err:()=>{}});
