use serde_json::{json,Value};
use simplicityhl::{CompiledProgram,Arguments,WitnessValues,simplicity::{CommitNode,BitIter,jet::Elements}};
use simplicityhl::parse::ParseFromStr;
use base64::{Engine,engine::general_purpose::STANDARD};
pub fn compile(request:&[u8])->Result<Value,String>{
 if request.len()>40000{return Err("Compiler request exceeds 40 KB".into())}
 let input:Value=serde_json::from_slice(request).map_err(|_|"Invalid compiler request")?;
 let source=input["source"].as_str().ok_or("Source is required")?;
 if source.is_empty()||source.len()>16000{return Err("Source must contain 1 to 16000 UTF-8 bytes".into())}
 let arguments:Arguments=serde_json::from_str(&input.get("arguments").cloned().unwrap_or(json!({})).to_string()).map_err(|e|format!("Invalid arguments: {e}"))?;
 let compiled=CompiledProgram::new(source,arguments,false)?;
 let node=compiled.commit();let bytes=node.to_vec_without_witness();
 let decoded=CommitNode::<Elements>::decode(BitIter::from(bytes.iter().copied())).map_err(|e|format!("Encoded program check failed: {e}"))?;
 if decoded.cmr()!=node.cmr(){return Err("Encoded program CMR mismatch".into())}
 let witness:WitnessValues=serde_json::from_str(&input.get("witness").cloned().unwrap_or(json!({})).to_string()).map_err(|e|format!("Invalid witness values: {e}"))?;
 let parsed=simplicityhl::parse::Program::parse_from_str(source)?;
 let ast=simplicityhl::ast::Program::analyze(&parsed).map_err(|e|e.to_string())?;
 for (name,_) in ast.witness_types().iter() { if witness.get(name).is_none() {return Err(format!("Missing witness value: {name}"))} }
 let satisfied=compiled.satisfy(witness)?;
 let redeem=satisfied.redeem();let bounds=redeem.bounds();
 let (_,witness_bytes)=redeem.to_vec_with_witness();
 Ok(json!({"version":"SimplicityHL 0.2.0 / rust-simplicity 0.5.0","cmr":node.cmr().to_string(),"program_base64":STANDARD.encode(bytes),"witness_base64":STANDARD.encode(witness_bytes),"static_cost":bounds.cost.to_string(),"memory_bound":bounds.extra_cells,"extra_frames":bounds.extra_frames,"program_type":decoded.arrow().to_string(),"cmr_redecoded":true}))
}
#[cfg(target_arch="wasm32")]
fn no_random(_: &mut [u8])->Result<(),getrandom::Error>{Err(getrandom::Error::UNSUPPORTED)}
#[cfg(target_arch="wasm32")]
getrandom::register_custom_getrandom!(no_random);
#[cfg(target_arch="wasm32")]
#[no_mangle]
pub extern "C" fn allocate(len:u32)->u32{if len>40000{return 0}Box::into_raw(vec![0;len as usize].into_boxed_slice()) as *mut u8 as u32}
#[cfg(target_arch="wasm32")]
#[no_mangle]
pub unsafe extern "C" fn verify(ptr:u32,len:u32)->u64{
 let result=match compile(std::slice::from_raw_parts(ptr as *const u8,len as usize)){Ok(v)=>v,Err(e)=>json!({"error":e})};
 let bytes=serde_json::to_vec(&result).unwrap().into_boxed_slice();let len=bytes.len() as u64;let ptr=Box::into_raw(bytes) as *mut u8 as u64;(ptr<<32)|len
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn actual_compile_and_decode(){let result=compile(br#"{"source":"fn main() {}"}"#).unwrap();assert_eq!(result["program_base64"],"JA==");assert_eq!(result["cmr_redecoded"],true);}
 #[test]fn invalid_source_is_not_compiled(){assert!(compile(br#"{"source":"this is not SimplicityHL"}"#).is_err());}
}
#[cfg(test)]mod independent_c_tests {
 use super::*;
 #[test] fn c_decoder_cmr_cost_and_execution_match() {
  use simplicity_sys::tests::{run_program,TestUpTo,ffi::SimplicityErr};
  for value in [42,43] {
   let request=json!({"source":"fn main() { let x: u32 = witness::VALUE; assert!(jet::eq_32(x, 42)); }","witness":{"VALUE":{"value":value.to_string(),"type":"u32"}}});
   let result=compile(&serde_json::to_vec(&request).unwrap()).unwrap();
   let program=STANDARD.decode(result["program_base64"].as_str().unwrap()).unwrap();
   let witness=STANDARD.decode(result["witness_base64"].as_str().unwrap()).unwrap();
   let c=run_program(&program,&witness,TestUpTo::Everything,None,None).unwrap();
   let cmr=c.cmr.s.iter().map(|word|format!("{word:08x}")).collect::<String>();
   assert_eq!(cmr,result["cmr"].as_str().unwrap());
   assert_eq!(c.cost_bound.to_string(),result["static_cost"].as_str().unwrap());
   if value==42 {assert_eq!(c.eval_result,SimplicityErr::NoError)}else{assert_ne!(c.eval_result,SimplicityErr::NoError)}
  }
 }
}
