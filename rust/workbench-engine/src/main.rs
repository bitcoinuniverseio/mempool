use miniscript::{bitcoin::{PublicKey, secp256k1::Secp256k1, taproot::{LeafVersion, TapLeafHash}}, descriptor::{Wsh, DescriptorPublicKey}, policy::Concrete, Segwitv0, Descriptor};
use serde_json::{json, Value};
use std::{io::{self, Read}, str::FromStr};

fn compile(input: &str) -> Result<Value, String> {
    if input.len() > 4096 { return Err("Policy exceeds 4096 bytes".into()); }
    let policy = Concrete::<PublicKey>::from_str(input.trim()).map_err(|_| "Invalid concrete public-key policy")?;
    let ms = policy.compile::<Segwitv0>().map_err(|_| "Policy cannot compile within Segwit v0 rules")?;
    ms.sanity_check().map_err(|_| "Compiled policy fails Miniscript safety analysis")?;
    let non_malleable = ms.is_non_malleable();
    let timelock_safe = !ms.has_mixed_timelocks();
    let text = ms.to_string();
    let descriptor = Wsh::new(ms).map_err(|_| "Cannot construct WSH descriptor")?;
    descriptor.sanity_check().map_err(|_| "Descriptor fails sanity checks")?;
    let weight = descriptor.max_weight_to_satisfy().map_err(|_| "Policy has no satisfaction")?.to_wu();
    Ok(json!({"miniscript":text,"descriptor":descriptor.to_string(),"script_hex":descriptor.inner_script().to_hex_string(),
        "max_witness_size":weight + 1,"worst_case_satisfaction_weight":weight,
        "properties":{"non_malleable":non_malleable,"timelock_safe":timelock_safe},
        "engine":"rust-miniscript 12.3.7","scope":"Concrete public-key policy compiled for Segwit v0 P2WSH; upper-bound witness sizing assumes 73-byte ECDSA signatures. No transaction or spend was executed."}))
}

fn main() {
    let mut input = String::new();
    if io::stdin().take(16385).read_to_string(&mut input).is_err() {
        println!("{}", json!({"error":"Invalid UTF-8 policy"})); std::process::exit(2);
    }
    let result = if std::env::args().nth(1).as_deref() == Some("--taproot") { taproot(&input) } else { compile(&input) };
    match result {
        Ok(result) => println!("{}", result),
        Err(error) => { println!("{}", json!({"error":error})); std::process::exit(2); }
    }
}

fn taproot(input: &str) -> Result<Value, String> {
    if input.len() > 16384 {return Err("Descriptor request is oversized".into());}
    let request: Value = serde_json::from_str(input).map_err(|_| "Invalid request")?;
    let text = request["descriptor"].as_str().ok_or("Missing descriptor")?;
    let index = request["index"].as_u64().ok_or("Missing index")?;
    if index >= 0x80000000 {return Err("Invalid derivation index".into());}
    let secp = Secp256k1::verification_only();
    let descriptor = Descriptor::<DescriptorPublicKey>::from_str(text).map_err(|_| "Unsupported public descriptor")?
        .at_derivation_index(index as u32).map_err(|_| "Cannot derive descriptor")?
        .derived_descriptor(&secp).map_err(|_| "Cannot derive public keys")?;
    let tr = match &descriptor {Descriptor::Tr(tr) => tr,_ => return Err("Expected Taproot descriptor".into())};
    let info = tr.spend_info();
    let mut leaves = Vec::new();
    for (depth, ms) in tr.iter_scripts() {
        if leaves.len() >= 128 {return Err("Tree exceeds 128 leaves".into());}
        let script = ms.encode();
        let control = info.control_block(&(script.clone(), LeafVersion::TapScript)).ok_or("No control block")?;
        let verified = control.verify_taproot_commitment(&secp, info.output_key().to_x_only_public_key(), &script);
        leaves.push(json!({"depth":depth,"miniscript":ms.to_string(),"script_hex":script.to_hex_string(),
            "leaf_hash":TapLeafHash::from_script(&script,LeafVersion::TapScript).to_string(),
            "control_block":control.serialize().iter().map(|b|format!("{b:02x}")).collect::<String>(),"commitment_verified":verified}));
    }
    Ok(json!({"engine":"rust-miniscript 12.3.7","internal_key":info.internal_key().to_string(),
        "output_key":info.output_key().to_string(),"merkle_root":info.merkle_root().map(|hash|hash.to_string()),
        "script_pub_key":descriptor.script_pubkey().to_hex_string(),"leaves":leaves,
        "scope":"Taproot descriptor commitments and control blocks independently computed; no on-chain ownership or script satisfaction is implied."}))
}

#[cfg(test)]
mod tests {
    use super::*;
    const KEY: &str = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    #[test] fn distinct_policies_produce_distinct_scripts() {
        let a = compile(&format!("pk({KEY})")).unwrap();
        let b = compile(&format!("and(pk({KEY}),older(144))")).unwrap();
        assert_ne!(a["script_hex"], b["script_hex"]);
        assert_ne!(a["worst_case_satisfaction_weight"], b["worst_case_satisfaction_weight"]);
        assert_eq!(b["properties"]["non_malleable"], true);
    }
    #[test] fn invalid_or_unsafe_policy_fails() {
        assert!(compile("pk(A)").is_err());
        assert!(compile("older(144)").is_err());
        assert!(compile(&"x".repeat(4097)).is_err());
    }
}
