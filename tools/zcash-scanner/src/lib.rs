use serde_json::{json, Value};
use sha2::{Digest,Sha256};
use ff::PrimeField;
use zcash_protocol::consensus::{Parameters, Network};
use zcash_keys::keys::{UnifiedFullViewingKey,UnifiedIncomingViewingKey};
use sapling::{keys::PreparedIncomingViewingKey as SaplingKey,note_encryption::{try_sapling_note_decryption,try_sapling_compact_note_decryption,CompactOutputDescription,Zip212Enforcement}};
use orchard::{keys::PreparedIncomingViewingKey as OrchardKey,note_encryption::{OrchardDomain,CompactAction}};
use zcash_note_encryption::{EphemeralKeyBytes,try_note_decryption,try_compact_note_decryption};
use zcash_primitives::{block::Block,transaction::components::sapling::zip212_enforcement};

fn bytes<const N:usize>(v:&Value)->Result<[u8;N],String>{hex::decode(v.as_str().ok_or("Expected hex bytes")?).map_err(|_|"Invalid hex bytes")?.try_into().map_err(|_|"Incorrect byte length".into())}
fn text<'a>(v:&'a Value,key:&str)->Result<&'a str,String>{v[key].as_str().ok_or_else(||format!("Missing {key}"))}
struct Keys { sapling: Vec<SaplingKey>, orchard: Vec<OrchardKey>, family: &'static str }
fn keys(input:&Value,params:&Network)->Result<Keys,String>{
 let key=text(input,"viewing_key")?;
 if key.is_empty()||key.len()>4096{return Err("Viewing key exceeds supported length".into())}
 let mut result=Keys{sapling:vec![],orchard:vec![],family:""};
 match text(input,"key_type")? {
  "unified-full"=>{let full=UnifiedFullViewingKey::decode(params,key).map_err(|_|"Invalid or wrong-network Unified Full Viewing Key")?;result.family="unified-full";
   for scope in [zip32::Scope::External,zip32::Scope::Internal] { if let Some(s)=full.sapling(){result.sapling.push(SaplingKey::new(&s.to_ivk(scope)))}if let Some(o)=full.orchard(){result.orchard.push(o.to_ivk(scope).prepare())} }
  },
  "unified-incoming"=>{let incoming=UnifiedIncomingViewingKey::decode(params,key).map_err(|_|"Invalid or wrong-network Unified Incoming Viewing Key")?;result.family="unified-incoming";if let Some(s)=incoming.sapling(){result.sapling.push(s.prepare())}if let Some(o)=incoming.orchard(){result.orchard.push(o.prepare())}},
  "sapling-extended-full"=>{let (network,key)=zcash_keys::encoding::decode_extfvk_with_network(key).map_err(|_|"Invalid Sapling extended full viewing key")?;if network!=params.network_type(){return Err("Wrong-network Sapling viewing key".into())}result.family="sapling-extended-full";let full=key.to_diversifiable_full_viewing_key();for scope in [zip32::Scope::External,zip32::Scope::Internal]{result.sapling.push(SaplingKey::new(&full.to_ivk(scope))) }},
  "sapling-incoming-hex"=>{let scalar=Option::<jubjub::Fr>::from(jubjub::Fr::from_repr(bytes::<32>(&input["viewing_key"])?)).ok_or("Invalid Sapling incoming scalar")?;if scalar==jubjub::Fr::from(0){return Err("Zero incoming key is invalid".into())}result.sapling.push(SaplingKey::new(&sapling::SaplingIvk(scalar)));result.family="sapling-incoming-hex"},
  "orchard-incoming-hex"=>{let key=Option::<orchard::keys::IncomingViewingKey>::from(orchard::keys::IncomingViewingKey::from_bytes(&bytes::<64>(&input["viewing_key"])?)).ok_or("Invalid Orchard incoming key")?;result.orchard.push(key.prepare());result.family="orchard-incoming-hex"},
  _=>return Err("Unsupported key type. Addresses and spending keys cannot scan incoming notes.".into())
 }
 if result.sapling.is_empty()&&result.orchard.is_empty(){return Err("Key has no supported Sapling or Orchard receiver".into())}Ok(result)
}
fn merkle(mut hashes:Vec<[u8;32]>)->[u8;32]{while hashes.len()>1{if hashes.len()%2==1{hashes.push(*hashes.last().unwrap())}hashes=hashes.chunks(2).map(|pair|Sha256::digest(Sha256::digest(pair.concat())).into()).collect()}hashes[0]}
pub fn scan(request:&[u8])->Result<Value,String>{
 if request.len()>10000000{return Err("Scan request exceeds 10 MB".into())}let input:Value=serde_json::from_slice(request).map_err(|_|"Invalid scanner request")?;
 let params=match text(&input,"network")?{"mainnet"=>Network::MainNetwork,"testnet"=>Network::TestNetwork,_=>return Err("Only Zcash mainnet and testnet network schedules are supported".into())};
 let keys=keys(&input,&params)?;let mut notes=vec![];let mut total=0u64;let mut outputs=0u64;let mut scanned=0u64;let mut last_hash=None;let mut next_height=None;
 let mode=text(&input,"mode")?;
 if mode=="compact-artifact" {
  let items=input["outputs"].as_array().ok_or("Compact outputs are required")?;if items.len()>4096{return Err("Too many compact outputs".into())}
  for (index,item) in items.iter().enumerate(){outputs+=1;let epk=EphemeralKeyBytes(bytes(&item["ephemeral_key"])?);let ciphertext=bytes(&item["ciphertext"])?;
   let found=match text(item,"pool")? {
    "sapling"=>{let cmu=Option::from(sapling::note::ExtractedNoteCommitment::from_bytes(&bytes(&item["commitment"])?)).ok_or("Invalid Sapling commitment")?;let output=CompactOutputDescription{ephemeral_key:epk,cmu,enc_ciphertext:ciphertext};let enforcement=match text(item,"zip212")?{"off"=>Zip212Enforcement::Off,"on"=>Zip212Enforcement::On,"grace"=>Zip212Enforcement::GracePeriod,_=>return Err("Invalid ZIP212 domain".into())};keys.sapling.iter().find_map(|key|try_sapling_compact_note_decryption(key,&output,enforcement).map(|(note,to)|(note.value().inner(),hex::encode(to.to_bytes()))))},
    "orchard"=>{let nf=Option::from(orchard::note::Nullifier::from_bytes(&bytes(&item["nullifier"])?)).ok_or("Invalid Orchard nullifier")?;let cmx=Option::from(orchard::note::ExtractedNoteCommitment::from_bytes(&bytes(&item["commitment"])?)).ok_or("Invalid Orchard commitment")?;let output=CompactAction::from_parts(nf,cmx,epk,ciphertext);let domain=OrchardDomain::for_compact_action(&output);keys.orchard.iter().find_map(|key|try_compact_note_decryption(&domain,key,&output).map(|(note,to)|(note.value().inner(),hex::encode(to.to_raw_address_bytes()))))},
    _=>return Err("Unsupported shielded pool".into())};
   if let Some((value,recipient))=found {total=total.checked_add(value).ok_or("Received amount overflow")?;notes.push(json!({"pool":item["pool"],"output_index":index,"value_zat":value.to_string(),"recipient_hex":recipient}));}
  }
 }else if mode=="owned-blocks" {
  let blocks=input["blocks"].as_array().ok_or("Raw block interval is required")?;if blocks.is_empty()||blocks.len()>10{return Err("Scan intervals require 1 to 10 blocks".into())}
  let mut previous=text(&input,"previous_hash")?.to_owned();let start=input["start_height"].as_u64().filter(|h|*h>0&&*h<=u32::MAX as u64).ok_or("Invalid start height")?;
  for (offset,item) in blocks.iter().enumerate(){let raw=hex::decode(text(item,"hex")?).map_err(|_|"Invalid raw block hex")?;if raw.len()>2000000{return Err("Raw block exceeds consensus size bound".into())}let mut reader=&raw[..];let block=Block::read(&mut reader,&params).map_err(|_|"Invalid or unsupported Zcash block/transaction encoding")?;
   if !reader.is_empty()||u32::from(block.claimed_height()) as u64!=start+offset as u64||block.header().hash().to_string()!=text(item,"hash")?||block.header().prev_block.to_string()!=previous{return Err("Block interval, header hash, height or previous checkpoint mismatch".into())}
   let hashes:Vec<[u8;32]>=block.vtx().iter().map(|tx|*tx.txid().as_ref()).collect();let mut unique=std::collections::HashSet::new();if !hashes.iter().all(|hash|unique.insert(*hash))||merkle(hashes)!=block.header().merkle_root{return Err("Block transaction Merkle commitment mismatch".into())}
   let enforcement=zip212_enforcement(&params,block.claimed_height());
   for tx in block.vtx().iter(){
    if tx.consensus_branch_id()!=zcash_protocol::consensus::BranchId::for_height(&params,block.claimed_height()){return Err("Transaction consensus branch differs from network height".into())}
    if let Some(bundle)=tx.sapling_bundle(){for (index,output) in bundle.shielded_outputs().iter().enumerate(){outputs+=1;if let Some((note,to,_memo))=keys.sapling.iter().find_map(|key|try_sapling_note_decryption(key,output,enforcement)){let value=note.value().inner();total=total.checked_add(value).ok_or("Received amount overflow")?;notes.push(json!({"pool":"sapling","height":start+offset as u64,"txid":tx.txid().to_string(),"output_index":index,"value_zat":value.to_string(),"recipient_hex":hex::encode(to.to_bytes())}));}}}
    if let Some(bundle)=tx.orchard_bundle(){for (index,action) in bundle.actions().iter().enumerate(){outputs+=1;let domain=OrchardDomain::for_action(action);if let Some((note,to,_memo))=keys.orchard.iter().find_map(|key|try_note_decryption(&domain,key,action)){let value=note.value().inner();total=total.checked_add(value).ok_or("Received amount overflow")?;notes.push(json!({"pool":"orchard","height":start+offset as u64,"txid":tx.txid().to_string(),"output_index":index,"value_zat":value.to_string(),"recipient_hex":hex::encode(to.to_raw_address_bytes())}));}}}
   }
   scanned+=1;previous=block.header().hash().to_string();if outputs>4096{return Err("Interval exceeds 4096 shielded outputs; request a smaller interval".into())}
  }last_hash=Some(previous);next_height=Some(start+scanned);
 }else{return Err("Unsupported scanner mode".into())}
 Ok(json!({"key_family":keys.family,"sapling_supported":!keys.sapling.is_empty(),"orchard_supported":!keys.orchard.is_empty(),"mode":mode,"scanned_blocks":scanned,"outputs_examined":outputs,"notes_found":notes.len(),"received_zatoshis":total.to_string(),"balance_zatoshis":null,"notes":notes,"last_hash":last_hash,"next_height":next_height,"history_complete":false,"spend_status":"not_scanned"}))
}
#[cfg(target_arch="wasm32")]
fn no_random(_: &mut [u8])->Result<(),getrandom::Error>{Err(getrandom::Error::UNSUPPORTED)}
#[cfg(target_arch="wasm32")]
getrandom::register_custom_getrandom!(no_random);
#[cfg(target_arch="wasm32")]
#[no_mangle]
pub extern "C" fn allocate(len:u32)->u32{if len>10000000{return 0}Box::into_raw(vec![0;len as usize].into_boxed_slice()) as *mut u8 as u32}
#[cfg(target_arch="wasm32")]
#[no_mangle]
pub unsafe extern "C" fn verify(ptr:u32,len:u32)->u64{let result=match scan(std::slice::from_raw_parts(ptr as *const u8,len as usize)){Ok(v)=>v,Err(e)=>json!({"error":e})};let bytes=serde_json::to_vec(&result).unwrap().into_boxed_slice();let len=bytes.len() as u64;let ptr=Box::into_raw(bytes) as *mut u8 as u64;(ptr<<32)|len}

#[cfg(test)]mod tests {
 use super::*;
 fn fixtures()->Vec<Value>{serde_json::from_str(include_str!("../fixtures.json")).unwrap()}
 #[test]fn independent_python_note_vectors(){for input in fixtures(){let result=scan(&serde_json::to_vec(&input).unwrap()).unwrap();assert_eq!(result["notes_found"],1);assert_eq!(result["received_zatoshis"],input["expected_zatoshis"]);assert_eq!(result["balance_zatoshis"],Value::Null);assert_eq!(result["scanned_blocks"],0);}}
 #[test]fn tampered_ciphertexts_and_other_valid_keys_do_not_decrypt(){let all=fixtures();for (index,input) in all.iter().enumerate(){let mut corrupted=input.clone();let mut ciphertext=bytes::<52>(&corrupted["outputs"][0]["ciphertext"]).unwrap();ciphertext[10]^=1;corrupted["outputs"][0]["ciphertext"]=json!(hex::encode(ciphertext));assert_eq!(scan(&serde_json::to_vec(&corrupted).unwrap()).unwrap()["notes_found"],0);let mut wrong=input.clone();wrong["viewing_key"]=all[if index<10{(index+1)%10}else{10+(index+1)%10}]["viewing_key"].clone();assert_eq!(scan(&serde_json::to_vec(&wrong).unwrap()).unwrap()["notes_found"],0);}}
 #[test]fn official_raw_block_hash_height_merkle_binding(){let raw=hex::decode(include_str!("../block-mainnet-415000.hex").trim()).unwrap();let block=Block::read(&raw[..],&Network::MainNetwork).unwrap();let mut input=fixtures()[0].clone();input["mode"]=json!("owned-blocks");input["start_height"]=json!(415000);input["previous_hash"]=json!(block.header().prev_block.to_string());input["blocks"]=json!([{"hex":hex::encode(raw),"hash":block.header().hash().to_string()}]);let result=scan(&serde_json::to_vec(&input).unwrap()).unwrap();assert_eq!(result["scanned_blocks"],1);assert_eq!(result["next_height"],415001);input["start_height"]=json!(415001);assert!(scan(&serde_json::to_vec(&input).unwrap()).is_err());input["start_height"]=json!(415000);input["previous_hash"]=json!("00".repeat(32));assert!(scan(&serde_json::to_vec(&input).unwrap()).is_err());}
 #[test]fn unified_key_network_and_checksum_are_real(){use zcash_keys::keys::UnifiedSpendingKey;use zip32::AccountId;let key=UnifiedSpendingKey::from_seed(&Network::MainNetwork,&[7u8;32],AccountId::ZERO).unwrap().to_unified_full_viewing_key();let mut input=fixtures()[0].clone();input["key_type"]=json!("unified-full");input["viewing_key"]=json!(key.encode(&Network::MainNetwork));assert!(scan(&serde_json::to_vec(&input).unwrap()).is_ok());input["network"]=json!("testnet");assert!(scan(&serde_json::to_vec(&input).unwrap()).is_err());input["network"]=json!("mainnet");input["viewing_key"]=json!("u1notaviewingkey");assert!(scan(&serde_json::to_vec(&input).unwrap()).is_err());}
}

#[cfg(test)]mod full_ciphertext_tests {
 use super::*;
 struct Output{epk:EphemeralKeyBytes,cm:[u8;32],ciphertext:[u8;580]}
 impl<D:zcash_note_encryption::Domain<ExtractedCommitmentBytes=[u8;32]>> zcash_note_encryption::ShieldedOutput<D,580> for Output{fn ephemeral_key(&self)->EphemeralKeyBytes{self.epk.clone()}fn cmstar_bytes(&self)->[u8;32]{self.cm}fn enc_ciphertext(&self)->&[u8;580]{&self.ciphertext}}
 #[test]fn full_authenticated_ciphertexts_and_memos_match_python_vectors(){
  for (pool,source) in [("sapling",include_str!("../sapling-vectors.json")),("orchard",include_str!("../orchard-vectors.json"))]{let rows:Value=serde_json::from_str(source).unwrap();let names:Vec<_>=rows[1][0].as_str().unwrap().split(", ").collect();for row in rows.as_array().unwrap().iter().skip(2){let value=Value::Object(names.iter().enumerate().map(|(i,n)|(n.to_string(),row[i].clone())).collect());let mut output=Output{epk:EphemeralKeyBytes(bytes(&value[if pool=="sapling"{"epk"}else{"ephemeral_key"}]).unwrap()),cm:bytes(&value[if pool=="sapling"{"cmu"}else{"cmx"}]).unwrap(),ciphertext:bytes(&value["c_enc"]).unwrap()};let request=json!({"key_type":format!("{pool}-incoming-hex"),"viewing_key":value[if pool=="sapling"{"ivk"}else{"incoming_viewing_key"}]});let keys=keys(&request,&Network::MainNetwork).unwrap();
   if pool=="sapling"{let (note,_,memo)=try_sapling_note_decryption(&keys.sapling[0],&output,Zip212Enforcement::Off).unwrap();assert_eq!(note.value().inner(),value["v"].as_u64().unwrap());assert_eq!(hex::encode(memo),value["memo"].as_str().unwrap());output.ciphertext[579]^=1;assert!(try_sapling_note_decryption(&keys.sapling[0],&output,Zip212Enforcement::Off).is_none());}
   else{let compact=CompactAction::from_parts(Option::from(orchard::note::Nullifier::from_bytes(&bytes(&value["rho"]).unwrap())).unwrap(),Option::from(orchard::note::ExtractedNoteCommitment::from_bytes(&output.cm)).unwrap(),output.epk.clone(),output.ciphertext[..52].try_into().unwrap());let domain=OrchardDomain::for_compact_action(&compact);let (note,_,memo)=try_note_decryption(&domain,&keys.orchard[0],&output).unwrap();assert_eq!(note.value().inner(),value["v"].as_u64().unwrap());assert_eq!(hex::encode(memo),value["memo"].as_str().unwrap());output.ciphertext[579]^=1;assert!(try_note_decryption(&domain,&keys.orchard[0],&output).is_none());}
  }}
 }
}
