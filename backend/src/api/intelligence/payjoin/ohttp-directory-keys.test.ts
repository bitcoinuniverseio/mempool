import { parseOhttpDirectoryKeys } from './ohttp-directory-keys';
const key=Buffer.concat([Buffer.from('0029','hex'),Buffer.from('010020','hex'),Buffer.from('c06b1a7e21e823734ea5cfe6b4c592ceac3d5f0f53b2fb9e7bfe401c02414c07','hex'),Buffer.from('000400010001','hex')]);
describe('RFC9458 key collections',()=>{
  it('decodes the complete X25519 configuration and supported suite',()=>expect(parseOhttpDirectoryKeys(key)).toEqual([{key_id:1,kem_id:32,suites:[{kdf_id:1,aead_id:1}]}]));
  it.each([Buffer.from('<html>no keys</html>'),Buffer.alloc(0),key.subarray(0,-1),Buffer.concat([key,Buffer.from('00','hex')]),Buffer.concat([key,key])])('rejects invalid/truncated/duplicate collections',body=>expect(()=>parseOhttpDirectoryKeys(body)).toThrow());
});
