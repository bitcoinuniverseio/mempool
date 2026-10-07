use std::io::{self, Read};
use serde_json::{json, Value};
use vpack::{ConsensusEngine, VpackIngredients, VpackState};
use ark::encode::ProtocolEncoding;

fn keys(value: &Value, allowed: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or("Expected a JSON object")?;
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("Unsupported field {key}; refusing to discard package data"));
    }
    Ok(())
}

fn strict_state(value: &Value) -> Result<(), String> {
    keys(value, &["schema_version", "implementation", "ingredients"])?;
    let ingredients = value.get("ingredients").ok_or("Missing ingredients")?;
    match value.get("implementation").and_then(Value::as_str) {
        Some("ark_labs") => {
            keys(ingredients, &["anchor_outpoint", "parent_outpoint", "fee_anchor_script", "nSequence", "outputs", "siblings", "child_output", "internal_key", "asp_expiry_script"])?;
            for output in ingredients.get("outputs").and_then(Value::as_array).ok_or("Missing outputs")? { keys(output, &["value", "script"])?; }
            if let Some(output) = ingredients.get("child_output").filter(|v| !v.is_null()) { keys(output, &["value", "script"])?; }
            if let Some(siblings) = ingredients.get("siblings").and_then(Value::as_array) { for sibling in siblings { keys(sibling, &["hash", "value", "script"])?; } }
        }
        Some("second_tech") => {
            keys(ingredients, &["anchor_outpoint", "parent_outpoint", "fee_anchor_script", "amount", "script_pubkey", "script_pubkey_hex", "script", "exit_delta", "vout", "expiry_height", "path", "genesis", "internal_key", "asp_expiry_script"])?;
            if let Some(path) = ingredients.get("path").or_else(|| ingredients.get("genesis")).and_then(Value::as_array) {
                for step in path {
                    keys(step, &["siblings", "parent_index", "sequence", "child_amount", "child_script_pubkey", "child_script"])?;
                    if let Some(siblings) = step.get("siblings").and_then(Value::as_array) { for sibling in siblings { keys(sibling, &["hash", "value", "script"])?; } }
                }
            }
        }
        _ => return Err("Unsupported implementation".into()),
    }
    Ok(())
}

// IMPLEMENTATION-HANDOFF [WP-RS-001]
// Coverage: COV-RS-VPACK-STATE-ARK, COV-RS-VPACK-STATE-SECOND.
// Defect: DEF-RS-001. Preparation only; executable behavior is unchanged.
// Verified source cause: strict_state permits each supplied sibling.hash, but
// the pinned libvpack typed builders replace it with a hash derived from value
// and script. A well-formed but incorrect supplied commitment is silently lost
// before validate_invariants sees the tree. This is a reconstruction-integrity
// defect, not evidence that a spend or signature was accepted. Native execution
// of the reproduction is BLOCKED in the preparation workspace: Cargo is absent.
// References at e1f783a02489680b84121c71388a6a96122f5c63:
// https://github.com/jgmcalpine/libvpack-rs/blob/e1f783a02489680b84121c71388a6a96122f5c63/src/export.rs
// (tree_from_ark_labs_ingredients and tree_from_second_tech_ingredients), and
// https://github.com/jgmcalpine/libvpack-rs/blob/e1f783a02489680b84121c71388a6a96122f5c63/src/consensus/mod.rs
// (hash_sibling_birth_tx documents the compact sibling commitment).
// 1. After VpackState deserialization and before consuming state.ingredients,
//    validate every ArkLabs sibling and every SecondTech path-step sibling.
//    Compare its decoded [u8; 32] hash with
//    vpack::consensus::hash_sibling_birth_tx(sibling.value, &sibling.script).
//    Return an error identifying the variant/step/sibling on mismatch. Do not
//    silently replace a supplied hash, guess byte order, or modify native Bark.
// 2. Keep strict_state unknown-field rejection and typed numeric/hex bounds.
//    Invoke the existing builders only after this comparison succeeds. Retain
//    binary-package checksum/invariant checks and the explicit unknown fields
//    for signature verification and exit viability. No dependency upgrade or
//    wire-format change is required; prerequisites: none.
// 3. Add fixtures to this file's tests module for both typed variants. Derive a
//    matching hash with the pinned helper, then change one hash byte while
//    preserving value/script. Assert matching states reconstruct identically
//    to the baseline, changed hashes reject, malformed lengths still reject,
//    and an unknown field remains rejected. Cover each SecondTech path step.
//    Run cargo test --manifest-path rust/vpack-engine/Cargo.toml --locked and
//    cargo build --manifest-path rust/vpack-engine/Cargo.toml --release --locked.
//    These commands require the pinned dependencies and are UNVERIFIED here.
// 4. Coordinate backend/src/api/intelligence/ark-vpack/vpack-reconstruction.ts
//    and vpack-reconstruction.test.ts: a native exit status of 2 must surface as
//    HTTP 400 invalid-package; valid state/Bark/binary reconstruction must retain
//    its prior IDs, scripts and transaction bytes. Exercise both state variants
//    through POST /api/v1/intelligence/ark/vpack/packages/reconstruct on Signet
//    with owned anchor evidence and the packaged native binary; retain logs,
//    revision, fixture hashes and downstream translate/exit-plan regressions.
// 5. Acceptance requires those native/API tests, not this annotation or a code
//    inspection alone. Rebuild and package the correct OS/architecture binary.
//    No migration/backfill or user signing is required. Roll back the wrapper
//    and binary together if deployment fails; old evidence does not establish
//    this new validation gate. Preserve supplied public package bytes for retry.
fn validate_sibling_commitments(state: &VpackState) -> Result<(), String> {
    match &state.ingredients {
        VpackIngredients::ArkLabs(ingredients) => {
            for (index, sibling) in ingredients.siblings.iter().flatten().enumerate() {
                if sibling.hash != vpack::consensus::hash_sibling_birth_tx(sibling.value, &sibling.script) {
                    return Err(format!("ark_labs sibling {index} commitment mismatch"));
                }
            }
        }
        VpackIngredients::SecondTech(ingredients) => {
            for (step_index, step) in ingredients.path.iter().enumerate() {
                for (index, sibling) in step.siblings.iter().enumerate() {
                    if sibling.hash != vpack::consensus::hash_sibling_birth_tx(sibling.value, &sibling.script) {
                        return Err(format!("second_tech step {step_index} sibling {index} commitment mismatch"));
                    }
                }
            }
        }
    }
    Ok(())
}

fn reconstruct(input: &str) -> Result<Value, String> {
    let request: Value = serde_json::from_str(input).map_err(|_| "Invalid JSON")?;
    if let Some(raw) = request.get("bark_hex").and_then(Value::as_str) {
        let bytes = hex::decode(raw).map_err(|_| "Invalid Bark hexadecimal")?;
        if bytes.len() > 1_048_576 { return Err("Bark package exceeds bound".into()); }
        let vtxo: ark::vtxo::Vtxo<ark::vtxo::Full, ark::VtxoPolicy> = ark::vtxo::Vtxo::deserialize(&bytes).map_err(|e| e.to_string())?;
        let encoded = vtxo.serialize();
        if encoded != bytes { return Err("Native Bark encoding does not round-trip exactly".into()); }
        let transactions: Vec<String> = vtxo.transactions().take(513).map(|item| hex::encode(ark::bitcoin::consensus::serialize(&item.tx))).collect();
        if transactions.len() > 512 { return Err("Bark path exceeds 512 transaction bound".into()); }
        return Ok(json!({"engine":"ark-lib 0.7.1", "bark_hex":hex::encode(encoded), "vtxo_id":vtxo.id().to_string(),
            "anchor_outpoint":vtxo.chain_anchor().to_string(), "amount_sats":vtxo.amount().to_sat(),
            "asp_pubkey":vtxo.server_pubkey().to_string(), "user_pubkey":vtxo.policy().user_pubkey().to_string(),
            "sequence":vtxo.transactions().last().and_then(|item| item.tx.input.first().map(|input| input.sequence.0)),
            "script_pub_key":hex::encode(vtxo.output_script_pubkey().as_bytes()), "exit_delta":vtxo.exit_delta(),
            "expiry":vtxo.expiry_height(), "transactions":transactions, "signature_verification":null, "exit_viable":null,
            "scope":"Native Bark ProtocolEncoding round-trip and transaction reconstruction only; independent signature and chain checks follow."}));
    }
    let bytes = if let Some(raw) = request.get("vpack_hex").and_then(Value::as_str) {
        hex::decode(raw).map_err(|_| "Invalid V-PACK hexadecimal")?
    } else {
        strict_state(request.get("state").ok_or("Supply state or vpack_hex")?)?;
        let state: VpackState = serde_json::from_value(request.get("state").cloned().ok_or("Supply state or vpack_hex")?).map_err(|e| e.to_string())?;
        validate_sibling_commitments(&state)?;
        match state.ingredients {
            VpackIngredients::ArkLabs(i) => vpack::create_vpack_ark_labs(i),
            VpackIngredients::SecondTech(i) => vpack::create_vpack_second_tech(i),
        }.map_err(|e| format!("{e:?}"))?
    };
    if bytes.len() < 24 || bytes.len() > 1_048_600 { return Err("V-PACK size outside supported bounds".into()); }
    let header = vpack::header::Header::from_bytes(&bytes[..24]).map_err(|e| format!("{e:?}"))?;
    header.verify_checksum(&bytes[24..]).map_err(|e| format!("{e:?}"))?;
    let tree = vpack::payload::reader::BoundedReader::parse(&header, &bytes[24..]).map_err(|e| format!("{e:?}"))?;
    vpack::payload::validate_invariants(&header, &tree).map_err(|e| format!("{e:?}"))?;
    let anchor_value = request.get("anchor_value_sats").and_then(Value::as_u64);
    let output = match header.tx_variant {
        vpack::TxVariant::V3Anchored => vpack::ArkLabsV3.compute_vtxo_id(&tree, anchor_value),
        vpack::TxVariant::V3Plain => vpack::SecondTechV3.compute_vtxo_id(&tree, anchor_value),
    }.map_err(|e| format!("{e:?}"))?;
    Ok(json!({
        "engine": "libvpack-rs e1f783a02489680b84121c71388a6a96122f5c63",
        "vpack_hex": hex::encode(bytes), "variant": header.tx_variant.as_u8(),
        "vtxo_id": output.id.to_string(), "anchor_outpoint": tree.anchor.to_string(),
        "amount_sats": tree.leaf.amount, "script_pub_key": hex::encode(&tree.leaf.script_pubkey),
        "exit_delta": tree.leaf.exit_delta, "expiry": tree.leaf.expiry, "sequence": tree.leaf.sequence,
        "transactions": output.signed_txs.iter().map(hex::encode).collect::<Vec<_>>(),
        "signature_verification": null, "exit_viable": null,
        "scope": "Pinned V-PACK serialization and transaction reconstruction only. Transaction signatures and chain spendability require independent validation."
    }))
}

fn main() {
    let mut input = String::new();
    if io::stdin().take(2_100_001).read_to_string(&mut input).is_err() || input.len() > 2_100_000 {
        println!("{}", json!({"error":"Input exceeds supported bound"})); std::process::exit(2);
    }
    match reconstruct(&input) {
        Ok(output) => println!("{output}"),
        Err(error) => { println!("{}", json!({"error":error})); std::process::exit(2); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn sibling_commitments_checked_before_normalization() {
        let script = vec![0x51];
        let hash = hex::encode(vpack::consensus::hash_sibling_birth_tx(1000, &script));
        let sibling = json!({"hash": hash, "value":1000, "script":"51"});
        for variant in ["ark_labs", "second_tech"] {
            let mut ingredients = if variant == "ark_labs" {
                json!({"anchor_outpoint":format!("{}:0", "11".repeat(32)), "nSequence":4294967295u32, "outputs":[{"value":1000,"script":"51"}], "siblings":[sibling.clone()], "child_output":{"value":1000,"script":"51"}})
            } else {
                json!({"anchor_outpoint":format!("{}:0", "11".repeat(32)), "amount":1000,"script_pubkey":"51", "path":[{"siblings":[sibling.clone()],"child_amount":1000,"child_script":"51"},{"siblings":[sibling.clone()],"child_amount":1000,"child_script":"51"}]})
            };
            let state = json!({"schema_version":"1.0", "implementation":variant,"ingredients":ingredients.clone()});
            let typed: VpackState = serde_json::from_value(state).unwrap();
            assert!(validate_sibling_commitments(&typed).is_ok());
            if variant == "ark_labs" { ingredients["siblings"][0]["hash"] = json!("00".repeat(32)); }
            else { ingredients["path"][1]["siblings"][0]["hash"] = json!("00".repeat(32)); }
            let typed: VpackState = serde_json::from_value(json!({"schema_version":"1.0","implementation":variant,"ingredients":ingredients})).unwrap();
            assert!(validate_sibling_commitments(&typed).unwrap_err().contains("commitment mismatch"));
        }
    }
    #[test] fn short_header_is_rejected_without_panic() { assert!(reconstruct(r#"{"vpack_hex":"56504b"}"#).is_err()); }
    #[test] fn invalid_json_is_rejected() { assert!(reconstruct("{").is_err()); }
    #[test] fn unsupported_fields_cannot_be_silently_discarded() {
        let state = json!({"schema_version":"1.0", "implementation":"ark_labs", "ingredients":{"exit_delta":432,"outputs":[]}});
        assert!(strict_state(&state).unwrap_err().contains("exit_delta"));
    }
}
