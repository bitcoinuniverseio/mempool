use rgbstd::vm::{WitnessOrd, WitnessPos};
use std::{collections::BTreeMap, num::NonZeroU32, str::FromStr};
use amplify::confinement::Confined;
use rgbstd::{containers::Consignment, contract::IssuerWrapper, validation::{ResolveWitness, WitnessStatus, WitnessResolverError, ValidationConfig, ValidationError}, ChainNet, Txid, Operation};
use rgbcore::bitcoin::{consensus::deserialize, Transaction};
use schemata::*;
use serde::Deserialize;
use serde_json::{json, Value};
use strict_encoding::StrictDeserialize;
use wasm_bindgen::prelude::*;
const MAX: usize = 2_000_000;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request { consignment: String, network: String, #[serde(default)] witnesses: BTreeMap<String, Evidence> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Evidence { raw_tx: String, height: Option<u32>, timestamp: Option<i64> }
struct Resolver { network: ChainNet, txs: BTreeMap<Txid, WitnessStatus> }
impl ResolveWitness for Resolver {
 fn check_chain_net(&self, net: ChainNet)->Result<(),WitnessResolverError>{ if net==self.network {Ok(())} else {Err(WitnessResolverError::WrongChainNet)} }
 fn resolve_witness(&self, id:Txid)->Result<WitnessStatus,WitnessResolverError>{ self.txs.get(&id).cloned().ok_or_else(||WitnessResolverError::ResolverIssue(Some(id),"Public anchor evidence unavailable".into())) }
}
fn parse<const T:bool>(s:&str)->Result<Consignment<T>,String>{
 if s.starts_with("-----BEGIN RGB CONSIGNMENT-----") { return Consignment::<T>::from_str(s).map_err(|e|e.to_string()); }
 let bytes=hex::decode(s).map_err(|_|"Expected strict-encoded hex or RGB ASCII armor")?;
 Consignment::<T>::from_strict_serialized(Confined::<Vec<u8>,0,MAX>::try_from(bytes).map_err(|_|"Consignment exceeds bound")?).map_err(|e|e.to_string())
}
fn run<const T:bool>(c:Consignment<T>,r:&Request,network:ChainNet)->Value{
 let id=c.genesis.contract_id().to_string();let sid=c.schema_id();
 let anchors:Vec<String>=c.bundles.iter().map(|b|b.witness_id().to_string()).collect();
 let mut out=json!({"engine":"rgb-ops 0.11.1-rc.11","contract_id":id,"schema_id":sid.to_string(),"network":r.network,"genesis_network":format!("{:?}",c.genesis.chain_net),"anchor_txids":anchors,"transition_bundles":c.bundles.len(),"consignment_uploaded":false});
 let types=match sid {
 NIA_SCHEMA_ID=>NonInflatableAsset::types(), CFA_SCHEMA_ID=>CollectibleFungibleAsset::types(),
 UDA_SCHEMA_ID=>UniqueDigitalAsset::types(), IFA_SCHEMA_ID=>InflatableFungibleAsset::types(),
 PFA_SCHEMA_ID=>PermissionedFungibleAsset::types(), _=>{out["status"]=json!("unresolved");out["reason"]=json!("Schema is not among the five pinned official schema/type definitions");return out;}
 };
 if c.bundles.len()>256 {out["status"]=json!("malformed");out["reason"]=json!("More than 256 transition bundles");return out;}
 let mut resolver=Resolver{network,txs:BTreeMap::new()};
 for (id,e) in &r.witnesses {
  let parsed=(||->Result<_,String>{let id=Txid::from_str(id).map_err(|e|e.to_string())?;let tx:Transaction=deserialize(&hex::decode(&e.raw_tx).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
   if tx.compute_txid()!=id{return Err("Public transaction ID mismatch".into());}
   let ord=match (e.height,e.timestamp){(Some(h),Some(t))=>WitnessOrd::Mined(WitnessPos::bitcoin(NonZeroU32::new(h).ok_or("Invalid height")?,t).ok_or("Invalid timestamp")?), (None,None)=>WitnessOrd::Tentative,_=>return Err("Incomplete mined evidence".into())};Ok((id,WitnessStatus::Resolved(tx,ord)))})();
  match parsed{Ok((id,status))=>{resolver.txs.insert(id,status);},Err(e)=>{out["status"]=json!("unresolved");out["reason"]=json!(e);return out;}}
 }
 let cfg=ValidationConfig{chain_net:network,trusted_typesystem:types,..Default::default()};
 match c.validate(&resolver,&cfg){Ok(valid)=>{out["status"]=json!(if valid.validation_status().warnings.is_empty(){"valid"}else{"warnings"});out["validation"]=serde_json::to_value(valid.validation_status()).unwrap();},Err(ValidationError::InvalidConsignment(e))=>{out["status"]=json!("invalid");out["reason"]=json!(e.to_string());},Err(ValidationError::ResolverError(e))=>{out["status"]=json!("unresolved");out["reason"]=json!(e.to_string());}}
 out
}
#[wasm_bindgen]
pub fn validate_rgb(input:&str)->String {
 let result=(||->Result<Value,String>{if input.len()>MAX*4{return Err("Request exceeds bound".into());}let r:Request=serde_json::from_str(input).map_err(|e|e.to_string())?;if r.consignment.len()>MAX*2||r.witnesses.len()>256{return Err("Import exceeds bound".into());}
 let net=match r.network.as_str(){"signet"=>ChainNet::BitcoinSignet,"regtest"=>ChainNet::BitcoinRegtest,"testnet"=>ChainNet::BitcoinTestnet3,"testnet4"=>ChainNet::BitcoinTestnet4,"mainnet"=>ChainNet::BitcoinMainnet,_=>return Err("Unsupported network".into())};
 let s=r.consignment.trim();match parse::<true>(s){Ok(c)=>Ok(run(c,&r,net)),Err(first)=>match parse::<false>(s){Ok(c)=>Ok(run(c,&r,net)),Err(_)=>Err(first)}}})();
 result.unwrap_or_else(|reason|json!({"status":"malformed","reason":reason,"engine":"rgb-ops 0.11.1-rc.11"})).to_string()
}
