use elements::{TxOut, encode::deserialize, confidential::{Asset, Value}, secp256k1_zkp::{Secp256k1, SecretKey, Generator, RangeProof, SurjectionProof}};
use serde_json::{Value as Json, json};
fn bytes(v: &Json, key: &str, max: usize) -> Result<Vec<u8>, &'static str> {
 let s=v[key].as_str().ok_or("Missing hex field")?;
 if s.is_empty() || s.len()>max*2 {return Err("Invalid field length")}
 hex::decode(s).map_err(|_|"Invalid hex encoding")
}
pub fn inspect(data: &[u8]) -> Result<Json, &'static str> {
 if data.len()>100000 {return Err("Request too large")}
 let v:Json=serde_json::from_slice(data).map_err(|_|"Invalid request")?;
 let mut out:TxOut=deserialize(&bytes(&v,"outputHex",11000)?).map_err(|_|"Invalid serialized Elements output")?;
 let mut key_bytes=bytes(&v,"blindingKey",32)?;
 let key=SecretKey::from_slice(&key_bytes).map_err(|_|"Invalid private blinding key"); key_bytes.fill(0); let key=key?;
 let (asset,value)=match (out.asset,out.value) {(Asset::Confidential(a),Value::Confidential(b))=>(a,b),_=>return Err("Expected confidential asset and value commitments")};
 let range=RangeProof::from_slice(&bytes(&v,"rangeproofHex",5134)?).map_err(|_|"Malformed rangeproof")?;
 let surjection=SurjectionProof::from_slice(&bytes(&v,"surjectionproofHex",10000)?).map_err(|_|"Malformed surjection proof")?;
 let inputs=v["inputGenerators"].as_array().ok_or("Input asset generators are required")?;
 if inputs.is_empty() || inputs.len()>256 {return Err("Provide 1 to 256 ordered input asset generators")}
 let inputs=inputs.iter().map(|x| {
  let s=x.as_str().ok_or("Invalid input asset generator")?;
  if s.len()!=66 {return Err("Invalid input asset generator")}
  Generator::from_slice(&hex::decode(s).map_err(|_|"Invalid input asset generator")?).map_err(|_|"Invalid input asset generator")
 }).collect::<Result<Vec<_>,_>>()?;
 let secp=Secp256k1::new();
 range.verify(&secp,value,out.script_pubkey.as_bytes(),asset).map_err(|_|"Rangeproof verification failed")?;
 if !surjection.verify(&secp,asset,&inputs) {return Err("Surjection proof verification failed for supplied input generators")}
 out.witness.rangeproof=Some(Box::new(range)); out.witness.surjection_proof=Some(Box::new(surjection));
 let secrets=out.unblind(&secp,key).map_err(|_|"Unblinding failed: key or output does not match")?;
 Ok(json!({"assetId":secrets.asset.to_string(),"valueSat":secrets.value.to_string(),"rangeproofValid":true,"surjectionproofValid":true}))
}
#[cfg(target_arch="wasm32")]
#[no_mangle]
pub extern "C" fn allocate(len:u32)->u32 {if len>100000{return 0} Box::into_raw(vec![0u8;len as usize].into_boxed_slice()) as *mut u8 as u32}
#[cfg(target_arch="wasm32")]
#[no_mangle]
pub unsafe extern "C" fn deallocate(ptr:u32,len:u32) { let mut bytes=Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr as *mut u8,len as usize)); bytes.fill(0); }
#[cfg(target_arch="wasm32")]
#[no_mangle]
pub unsafe extern "C" fn verify(ptr:u32,len:u32)->u64 {
 let response=match inspect(std::slice::from_raw_parts(ptr as *const u8,len as usize)){Ok(v)=>v,Err(e)=>json!({"error":e})};
 let bytes=serde_json::to_vec(&response).unwrap().into_boxed_slice(); let len=bytes.len() as u64; let ptr=Box::into_raw(bytes) as *mut u8 as u64; (ptr<<32)|len
}
#[cfg(test)]
mod tests {
 use super::*;
 use elements::{AssetId, Script, TxOutSecrets, confidential::{AssetBlindingFactor,ValueBlindingFactor},encode::serialize,secp256k1_zkp::PublicKey};
 use rand::{SeedableRng,rngs::StdRng};
 #[test] fn synthetic_fixture_roundtrip() {
 let secp=Secp256k1::new(); let mut rng=StdRng::seed_from_u64(35347);
 let key=SecretKey::from_slice(&[42;32]).unwrap();
 let asset=AssetId::from_byte_array([23;32]);
 let input=TxOutSecrets::new(asset,AssetBlindingFactor::zero(),15000001,ValueBlindingFactor::zero());
 let secrets=TxOutSecrets::new(asset,AssetBlindingFactor::new(&mut rng),15000001,ValueBlindingFactor::new(&mut rng));
 let out=TxOut::with_txout_secrets(&mut rng,&secp,Script::from(vec![0x51]),PublicKey::from_secret_key(&secp,&key),SecretKey::from_slice(&[43;32]).unwrap(),secrets,&[input]).unwrap();
 let request=json!({"outputHex":hex::encode(serialize(&out)),"blindingKey":hex::encode(key.secret_bytes()),"rangeproofHex":hex::encode(out.witness.rangeproof.as_ref().unwrap().serialize()),"surjectionproofHex":hex::encode(out.witness.surjection_proof.as_ref().unwrap().serialize()),"inputGenerators":[hex::encode(Generator::new_unblinded(&secp,asset.into_tag()).serialize())]});
 assert_eq!(inspect(&serde_json::to_vec(&request).unwrap()).unwrap()["valueSat"],"15000001");
 std::fs::write("fixture.json",serde_json::to_string_pretty(&request).unwrap()).unwrap();
 }
}
#[cfg(target_arch="wasm32")]
fn no_random(_: &mut [u8]) -> Result<(),getrandom::Error> { Err(getrandom::Error::UNSUPPORTED) }
#[cfg(target_arch="wasm32")]
getrandom::register_custom_getrandom!(no_random);
