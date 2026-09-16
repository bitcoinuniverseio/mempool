use bitcoin::{consensus::{deserialize,serialize},Transaction,Block,VarInt};
use serde_json::{Value,json};
use std::io::{self,Read};
fn hex(bytes:&[u8])->String{bytes.iter().map(|b|format!("{:02x}",b)).collect()}
fn decode(value:&str)->Result<Vec<u8>,String>{if !value.is_ascii()||value.len()>800000||value.len()%2!=0{return Err("hex-bound".into())} (0..value.len()).step_by(2).map(|i|u8::from_str_radix(&value[i..i+2],16).map_err(|_|"invalid-hex".into())).collect()}
fn evaluate(target:&str,input:&str)->Value{
 let bytes=match decode(input){Ok(b)=>b,Err(e)=>return json!({"status":"rejected","error":e})};
 match target{
  "transaction_parse"=>match deserialize::<Transaction>(&bytes){Ok(tx)=>json!({"status":"accepted","txid":tx.compute_txid().to_string(),"wtxid":tx.compute_wtxid().to_string(),"canonical_hex":hex(&serialize(&tx))}),Err(e)=>json!({"status":"rejected","error":e.to_string()})},
  "compact_size"=>match deserialize::<VarInt>(&bytes){Ok(n)=>json!({"status":"accepted","value":n.0.to_string(),"canonical_hex":hex(&serialize(&n))}),Err(e)=>json!({"status":"rejected","error":e.to_string()})},
  "block_parse"=>match deserialize::<Block>(&bytes){Ok(block)=>json!({"status":"accepted","block_hash":block.block_hash().to_string(),"merkle_root_matches":block.check_merkle_root(),"witness_commitment_matches":block.check_witness_commitment(),"pow_matches_embedded_target":block.header.validate_pow(block.header.target()).is_ok()}),Err(e)=>json!({"status":"rejected","error":e.to_string()})},
  _=>json!({"status":"unsupported"})
 }
}
fn main(){let mut input=String::new();if io::stdin().take(2_100_001).read_to_string(&mut input).is_err()||input.len()>2_100_000{std::process::exit(2)}let request:Value=match serde_json::from_str(&input){Ok(v)=>v,Err(_)=>std::process::exit(2)};let target=request["target"].as_str().unwrap_or("");let inputs=match request["inputs"].as_array(){Some(v) if !v.is_empty()&&v.len()<=128=>v,_=>std::process::exit(2)};let results:Vec<Value>=inputs.iter().map(|v|json!({"id":v["id"],"outcome":evaluate(target,v["hex"].as_str().unwrap_or(""))})).collect();println!("{}",json!({"engine":"rust-bitcoin 0.32.102","scope":"Deserialization and stated structural checks only; not full consensus validation.","results":results}));}
