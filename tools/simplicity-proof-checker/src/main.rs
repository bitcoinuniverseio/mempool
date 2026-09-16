use simplicityhl::{Arguments,CompiledProgram,WitnessValues,parse::ParseFromStr,simplicity::{dag::{DagLike,MaxSharing},node::Inner,jet::Elements}};
use simplicity_sys::tests::{run_program,TestUpTo,ffi::SimplicityErr};
use serde_json::{Value,json};
use std::io::{Read,Write};
use sha2::{Digest,Sha256};
fn check(v:&Value)->Result<Value,&'static str>{
 if v["proof_system"]=="lean4" { return check_lean(v); }
 check_closed(v)
}
fn check_closed(v:&Value)->Result<Value,&'static str>{
 let source=v["source_text"].as_str().ok_or("missing-source")?;
 if source.len()>8192 {return Err("source-too-large")}
 let parsed=simplicityhl::parse::Program::parse_from_str(source).map_err(|_|"source-parse-failed")?;
 let ast=simplicityhl::ast::Program::analyze(&parsed).map_err(|_|"source-analysis-failed")?;
 if ast.witness_types().iter().next().is_some()||ast.parameters().iter().next().is_some(){return Err("only-closed-programs-supported")}
 let compiled=CompiledProgram::new(source,Arguments::default(),false).map_err(|_|"source-compile-failed")?;
 let node=compiled.commit();
 for entry in node.as_ref().post_order_iter::<MaxSharing<_>>() {
  match entry.node.inner(){
   Inner::Jet(j) if !matches!(j,Elements::Verify|Elements::Eq1|Elements::Eq8|Elements::Eq16|Elements::Eq32|Elements::Eq64|Elements::Eq256)=>return Err("unsupported-environment-or-jet"),
   Inner::Witness(_)|Inner::Disconnect(_,_)=>return Err("only-closed-programs-supported"),
   _=>{}
  }
 }
 let encoded=node.to_vec_without_witness();
 if v["program_bytes_hex"].as_str()!=Some(hex::encode(&encoded).as_str())||v["program_cmr"].as_str()!=Some(node.cmr().to_string().as_str()){return Err("source-program-binding-mismatch")}
 let satisfied=compiled.satisfy(WitnessValues::default()).map_err(|_|"program-finalization-failed")?;
 let (_,witness)=satisfied.redeem().to_vec_with_witness();
 if !witness.is_empty(){return Err("only-closed-programs-supported")}
 let result=run_program(&encoded,&witness,TestUpTo::Everything,None,None).map_err(|_|"independent-c-check-failed")?;
 let c_cmr=result.cmr.s.iter().map(|word|format!("{word:08x}")).collect::<String>();
 if c_cmr!=node.cmr().to_string(){return Err("independent-c-cmr-mismatch")}
 if result.eval_result!=SimplicityErr::NoError{return Err("closed-program-evaluation-failed")}
 Ok(json!({"verified":true,"program_cmr":c_cmr,"checker":"simplicity-closed-program-v1","cost_milliweight":result.cost_bound}))
}
fn lean_source(left:u32,right:u32,proof_value:u32,cmr:&str)->String{
 // Every inserted token is a bounded integer or validated hex, never submitted Lean text.
 format!("-- Bound Simplicity program CMR: {cmr}\nset_option maxRecDepth 256\nset_option maxHeartbeats 20000\ntheorem artifact : ({left} : UInt32) = ({right} : UInt32) := Eq.refl ({proof_value} : UInt32)\n")
}
fn run_lean(source:&str)->Result<String,&'static str>{
 use std::{process::{Command,Stdio},fs,path::PathBuf};
 let executable=PathBuf::from(std::env::var("SIMPLICITY_LEAN_EXECUTABLE").map_err(|_|"lean-kernel-unavailable")?);
 if !executable.is_absolute()||!executable.is_file(){return Err("lean-kernel-unavailable")}
 let configure=||{let mut command=Command::new(&executable);command.env_remove("LEAN_PATH").env_remove("LEAN_SRC_PATH").env_remove("LEAN_SYSROOT").env_remove("LEAN_CC").env_remove("LEAN_AR").stdin(Stdio::null());
  #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
  command};
 let version=configure().arg("--version").output().map_err(|_|"lean-kernel-unavailable")?;
 if !version.status.success()||(!String::from_utf8_lossy(&version.stdout).starts_with("Lean (version 4.24.0,")||!String::from_utf8_lossy(&version.stdout).contains("commit 797c613eb9b6d4ec95db23e3e00af9ac6657f24b")){return Err("unsupported-lean-kernel-revision")}
 let directory=std::env::temp_dir().join(format!("universe-lean-proof-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"clock-unavailable")?.as_nanos()));
 fs::create_dir(&directory).map_err(|_|"kernel-workspace-unavailable")?;let file=directory.join("Artifact.lean");
 let result=(||{let mut artifact=fs::OpenOptions::new().write(true).create_new(true).open(&file).map_err(|_|"kernel-workspace-unavailable")?;artifact.write_all(source.as_bytes()).map_err(|_|"kernel-workspace-unavailable")?;
  let status=configure().current_dir(&directory).args(["--trust=0","--threads=2","--memory=256","--timeout=200000","Artifact.lean"]).stdout(Stdio::null()).stderr(Stdio::null()).status().map_err(|_|"lean-kernel-unavailable")?;
  if !status.success(){return Err("lean-proof-rejected")}
  Ok(hex::encode(Sha256::digest(source.as_bytes())))})();
 let _=fs::remove_file(file);let _=fs::remove_dir(directory);result
}
fn check_lean(v:&Value)->Result<Value,&'static str>{
 let integer=|key:&str|v[key].as_u64().and_then(|n|u32::try_from(n).ok()).ok_or("invalid-u32-proof-term");
 let (left,right,proof_value)=(integer("left")?,integer("right")?,integer("proof_value")?);
 let cmr=v["program_cmr"].as_str().filter(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_hexdigit())).ok_or("invalid-cmr")?;
 if v["source_text"].as_str()!=Some(format!("fn main() {{ assert!(jet::eq_32({left},{right})); }}").as_str()){return Err("unsupported-lean-source-profile")}
 let source=lean_source(left,right,proof_value,cmr);
 let artifact_hash=run_lean(&source)?;
 // Independent C execution and actual compiler CMR bind the proved u32 equality to these program bytes.
 let mut result=check_closed(v)?;
 result["checker"]=json!("lean4-simplicity-u32-equality-v1");result["kernel_revision"]=json!("lean-4.24.0");result["kernel_artifact_hash"]=json!(artifact_hash);result["kernel_statement"]=json!(format!("({left} : UInt32) = ({right} : UInt32)"));
 Ok(result)
}
fn main(){
 if !limit_memory(){println!("{}",json!({"verified":false,"error":"memory-limit-unavailable"}));return}
 let mut bytes=Vec::new();let response=match std::io::stdin().take(30001).read_to_end(&mut bytes){
  Ok(_) if bytes.len()<=30000=>match serde_json::from_slice(&bytes){Ok(v)=>match check(&v){Ok(result)=>result,Err(error)=>json!({"verified":false,"error":error})},Err(_)=>json!({"verified":false,"error":"invalid-json"})},
  _=>json!({"verified":false,"error":"request-too-large"})
 };
 let _=std::io::stdout().write_all(serde_json::to_string(&response).unwrap().as_bytes());
}
#[cfg(test)]mod tests{use super::*;
 fn artifact(source:&str)->Value{let node=CompiledProgram::new(source,Arguments::default(),false).unwrap().commit();json!({"source_text":source,"program_cmr":node.cmr().to_string(),"program_bytes_hex":hex::encode(node.to_vec_without_witness())})}
 #[test]fn closed_proof_accepts_and_independently_checks(){assert_eq!(check(&artifact("fn main() { assert!(jet::eq_32(42,42)); }")).unwrap()["verified"],true)}
 #[test]fn false_claim_rejected(){assert_eq!(check(&artifact("fn main() { assert!(jet::eq_32(42,43)); }")).unwrap_err(),"closed-program-evaluation-failed")}
 #[test]fn altered_program_rejected(){let mut a=artifact("fn main() {}");a["program_cmr"]=json!("00".repeat(32));assert!(check(&a).is_err());}
 #[test]fn free_witness_rejected(){assert_eq!(check(&artifact("fn main() {let a:u32=witness::A;assert!(jet::eq_32(a,42));}")).unwrap_err(),"only-closed-programs-supported")}
 #[test]fn pinned_lean_kernel_rejects_false_statement_and_wrong_proof(){
  if std::env::var_os("SIMPLICITY_LEAN_EXECUTABLE").is_none(){return}
  for (left,right,value,valid) in [(42,42,42,true),(42,43,42,false),(42,42,43,false),(u32::MAX,u32::MAX,u32::MAX,true)] {
   let mut v=artifact(&format!("fn main() {{ assert!(jet::eq_32({left},{right})); }}"));v["proof_system"]=json!("lean4");v["left"]=json!(left);v["right"]=json!(right);v["proof_value"]=json!(value);let result=check(&v);assert_eq!(result.is_ok(),valid);if valid{assert_eq!(result.unwrap()["kernel_revision"],"lean-4.24.0")}
  }
 }
}
// Limit only this task-owned checker process, before accepting compiler input.
#[cfg(windows)]
fn limit_memory()->bool { unsafe {
 use windows_sys::Win32::System::{JobObjects::*,Threading::GetCurrentProcess};
 let job=CreateJobObjectW(std::ptr::null(),std::ptr::null());if job.is_null(){return false}
 let mut limits:JOBOBJECT_EXTENDED_LIMIT_INFORMATION=std::mem::zeroed();
 limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_PROCESS_MEMORY|JOB_OBJECT_LIMIT_JOB_MEMORY|JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
 limits.ProcessMemoryLimit=256*1024*1024;
 limits.JobMemoryLimit=512*1024*1024;
 if SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits as *const _ as *const _,std::mem::size_of_val(&limits) as u32)==0{return false}
 AssignProcessToJobObject(job,GetCurrentProcess())!=0
}}
#[cfg(unix)]
fn limit_memory()->bool { unsafe {let limit=libc::rlimit{rlim_cur:256*1024*1024,rlim_max:256*1024*1024};let cpu=libc::rlimit{rlim_cur:5,rlim_max:5};libc::setrlimit(libc::RLIMIT_AS,&limit)==0&&libc::setrlimit(libc::RLIMIT_CPU,&cpu)==0} }
#[cfg(not(any(windows,unix)))]
fn limit_memory()->bool {false}
