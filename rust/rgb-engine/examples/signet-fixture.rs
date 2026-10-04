//! Owned Signet qualification construction only. No wallet, signing, RPC, or broadcast.
//! Uses the exact Cargo.lock RGB NIA schema, transition, MPC and OP_RETURN DBC builders.
use std::{collections::BTreeMap, io::{self, Read}, str::FromStr};
use amplify::confinement::Confined;
use rgbstd::{contract::{ContractBuilder,TransitionBuilder,IssuerWrapper,AllocatedState},containers::{BuilderSeal,Consignment,PubWitness,WitnessBundle,SecretSeals},stl::{AssetSpec,ContractTerms,Name,Ticker,RicardianContract},ChainNet,GenesisSeal,GraphSeal,Txid,Identity,Amount,Precision,Operation,Opout,KnownTransition,TransitionBundle};
use rgbcore::{seals::txout::TxPtr,bitcoin::{Transaction,consensus::{deserialize,serialize}},dbc::Anchor,validation::DbcProof,commit_verify::{mpc,TryCommitVerify,CommitId,EmbedCommitVerify,Conceal}};
use schemata::{NonInflatableAsset,OS_ASSET};
use strict_encoding::StrictSerialize;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request { network:String, funding_txid:String, funding_vout:u32, recipient_vout:u32, raw_tx:String, created_at:i64 }

fn check_template(r:&Request)->Result<Transaction,String> {
 if r.network!="signet" {return Err("Only explicit Signet qualification is supported".into());}
 if r.created_at<1231006505 {return Err("Invalid actual creation timestamp".into());}
 if r.raw_tx.len()>200000 || r.raw_tx.len()%2!=0 {return Err("Unsigned template exceeds bounds".into());}
 let tx:Transaction=deserialize(&hex::decode(&r.raw_tx).map_err(|_|"Invalid template hex")?).map_err(|_|"Invalid template transaction")?;
 let funding=Txid::from_str(&r.funding_txid).map_err(|_|"Invalid funding TXID")?;
 if tx.input.len()!=1 || tx.input[0].previous_output.txid!=funding || tx.input[0].previous_output.vout!=r.funding_vout {return Err("Template must consume only the declared fresh wallet seal".into());}
 if !tx.input[0].script_sig.is_empty() || !tx.input[0].witness.is_empty() {return Err("Supply unsigned template before any signature".into());}
 if tx.output.len()!=2 || tx.output.iter().filter(|o|o.script_pubkey.as_bytes()==[0x6a] && o.value.to_sat()==0).count()!=1 {return Err("Require exactly one zero-value empty OP_RETURN and one recipient".into());}
 let recipient=tx.output.get(r.recipient_vout as usize).ok_or("Invalid recipient output index")?;
 if recipient.script_pubkey.is_op_return() || recipient.value.to_sat()<330 || !recipient.script_pubkey.is_witness_program() {return Err("Recipient must be a non-dust Segwit wallet output".into());}
 Ok(tx)
}

fn build(r:&Request)->Result<serde_json::Value,String> {
 let mut tx=check_template(r)?;
 let genesis_seal=GenesisSeal::with_blinding(Txid::from_str(&r.funding_txid).unwrap(),r.funding_vout,654321);
 let contract=ContractBuilder::with(Identity::default(),NonInflatableAsset::schema(),NonInflatableAsset::types(),NonInflatableAsset::scripts(),ChainNet::BitcoinSignet)
 .add_global_state("spec",AssetSpec{ticker:Ticker::from("RGBTEST"),name:Name::from("Owned Signet RGB qualification"),details:None,precision:Precision::try_from(0).unwrap()}).map_err(|e|e.to_string())?
 .add_global_state("terms",ContractTerms{text:RicardianContract::default(),media:None}).map_err(|e|e.to_string())?
 .add_global_state("issuedSupply",Amount::from(1000u64)).map_err(|e|e.to_string())?
 .add_fungible_state("assetOwner",BuilderSeal::from(genesis_seal),1000u64).map_err(|e|e.to_string())?.issue_contract_raw(r.created_at).map_err(|e|e.to_string())?;
 let opout=Opout{op:contract.genesis.id(),ty:OS_ASSET,no:0};let cid=contract.genesis.contract_id();
 let seal=GraphSeal::with_blinding(TxPtr::WitnessTx,r.recipient_vout,987654);
 let transition=TransitionBuilder::named_transition(cid,NonInflatableAsset::schema(),"transfer",NonInflatableAsset::types()).map_err(|e|e.to_string())?.set_nonce(0)
 .add_input(opout,AllocatedState::from(Amount::from(1000u64))).map_err(|e|e.to_string())?.add_fungible_state("assetOwner",BuilderSeal::from(seal),1000u64).map_err(|e|e.to_string())?.complete_transition().map_err(|e|e.to_string())?;
 let opid=transition.id();let bundle=TransitionBundle{input_map:Confined::try_from(BTreeMap::from([(opout,opid)])).map_err(|e|e.to_string())?,known_transitions:Confined::try_from(vec![KnownTransition::new(opid,transition)]).map_err(|e|e.to_string())?};
 let protocol=mpc::ProtocolId::from(cid);let source=mpc::MultiSource{messages:Confined::try_from(BTreeMap::from([(protocol,mpc::Message::from(bundle.bundle_id()))])).map_err(|e|e.to_string())?,static_entropy:Some(123456),..Default::default()};
 let tree=mpc::MerkleTree::try_commit(&source).map_err(|e|e.to_string())?;let commitment=tree.commit_id();let proof=mpc::MerkleBlock::from(tree).to_merkle_proof(protocol).map_err(|e|e.to_string())?;
 let dbc=tx.embed_commit(&commitment).map_err(|e|e.to_string())?;let witness_id=tx.compute_txid();
 let transfer=Consignment::<true>{version:contract.version,transfer:true,terminals:Confined::try_from(BTreeMap::from([(bundle.bundle_id(),SecretSeals::from(Confined::try_from(std::collections::BTreeSet::from([seal.conceal()])).map_err(|e|e.to_string())?))])).map_err(|e|e.to_string())?,genesis:contract.genesis.clone(),bundles:Confined::try_from(vec![WitnessBundle::with(PubWitness::Txid(witness_id),Anchor::new(proof,DbcProof::Opret(dbc)),bundle)]).map_err(|e|e.to_string())?,schema:contract.schema.clone(),types:contract.types.clone(),scripts:contract.scripts.clone()};
 let bytes=transfer.to_strict_serialized::<2000000>().map_err(|e|e.to_string())?;
 Ok(json!({"schema":"owned-signet-rgb-unsigned-construction-v1","network":"signet","consignment":hex::encode(bytes.as_ref()),"unsigned_raw_tx":hex::encode(serialize(&tx)),"contract_id":cid.to_string(),"anchor_txid":witness_id.to_string(),"genesis_seal":{"txid":r.funding_txid,"vout":r.funding_vout},"terminal_vout":r.recipient_vout,"quantity_atomic":"1000","scope":"Unsigned pinned NIA construction only; caller must independently verify custom Signet identity, real funding and signed anchor confirmation. No issuer authentication, ownership/recovery or broadcast inferred."}))
}
fn main(){let mut input=String::new();io::stdin().take(400001).read_to_string(&mut input).unwrap();let result=(||{if input.len()>400000{return Err("Request exceeds bound".into());}let request:Request=serde_json::from_str(&input).map_err(|e|e.to_string())?;build(&request)})();match result{Ok(v)=>println!("{v}"),Err(e)=>{eprintln!("{e}");std::process::exit(2)}}}

#[cfg(test)]
mod tests {
 use super::*;
 fn request()->Request { Request{network:"signet".into(),funding_txid:"11".repeat(32),funding_vout:0,recipient_vout:0,created_at:1791138600,raw_tx:format!("0200000001{}0000000000ffffffff02e803000000000000160014{}0000000000000000016a00000000","11".repeat(32),"22".repeat(20))} }
 #[test] fn actual_pinned_builder_constructs_signet_genesis_and_transition(){let r=request();let v=build(&r).unwrap();assert_eq!(v["network"],"signet");assert_eq!(v["terminal_vout"],0);assert_eq!(v["quantity_atomic"],"1000");assert_eq!(v,build(&r).unwrap());let result:serde_json::Value=serde_json::from_str(&universe_rgb_engine::validate_rgb(&json!({"consignment":v["consignment"],"network":"signet","witnesses":{}}).to_string())).unwrap();assert_eq!(result["status"],"unresolved");assert_eq!(result["contract_id"],v["contract_id"]);assert_eq!(result["anchor_txids"][0],v["anchor_txid"]);}
 #[test] fn wrong_network_is_rejected(){let mut r=request();r.network="mainnet".into();assert!(check_template(&r).unwrap_err().contains("Signet"));}
 #[test] fn foreign_funding_is_rejected(){let mut r=request();r.funding_txid="33".repeat(32);assert!(check_template(&r).unwrap_err().contains("declared"));}
 #[test] fn recipient_cannot_be_commitment(){let mut r=request();r.recipient_vout=1;assert!(check_template(&r).unwrap_err().contains("Recipient"));}
 #[test] fn signed_template_is_rejected(){let r=request();let mut tx=check_template(&r).unwrap();tx.input[0].script_sig=rgbcore::bitcoin::ScriptBuf::from_bytes(vec![0x51]);let signed=Request{raw_tx:hex::encode(serialize(&tx)),..r};assert!(check_template(&signed).unwrap_err().contains("unsigned"));}
 #[test] fn no_commitment_slot_is_rejected(){let r=request();let mut tx=check_template(&r).unwrap();tx.output[1].script_pubkey=tx.output[0].script_pubkey.clone();let bad=Request{raw_tx:hex::encode(serialize(&tx)),..r};assert!(check_template(&bad).unwrap_err().contains("OP_RETURN"));}
}
