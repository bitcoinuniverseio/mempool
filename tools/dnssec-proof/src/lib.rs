use base64::{engine::general_purpose::STANDARD, Engine};
use dnssec_prover::{rr::{Name, RR}, ser::parse_rr_stream, validation::verify_rr_stream};
use serde_json::{json, Value};
mod payment;

pub fn verify_request(request: &[u8]) -> Result<Value, &'static str> {
    if request.len() > 1_400_000 { return Err("proof-too-large"); }
    let input: Value = serde_json::from_slice(request).map_err(|_| "invalid-request")?;
    if input["operation"].as_str() == Some("inspect-uri") {
        return payment::inspect(input["uri"].as_str().ok_or("invalid-uri")?, input["network"].as_str().ok_or("invalid-network")?, input["now"].as_u64().ok_or("invalid-time")?);
    }
    let name: Name = input["name"].as_str().ok_or("invalid-name")?.try_into().map_err(|_| "invalid-name")?;
    let now = input["now"].as_u64().ok_or("invalid-time")?;
    let proof = STANDARD.decode(input["proof"].as_str().ok_or("invalid-proof")?).map_err(|_| "invalid-proof")?;
    if proof.len() > 1_000_000 { return Err("proof-too-large"); }
    let records = parse_rr_stream(&proof).map_err(|_| "malformed-proof")?;
    // BIP353 forbids SHA1 signatures and RSA moduli shorter than 1024 bits.
    // Apply a conservative rejection to all supplied DNSKEYs, including unused ones.
    for record in &records {
        if let RR::DnsKey(key) = record {
            if matches!(key.alg, 5 | 7) { return Err("weak-dnssec-algorithm"); }
            if matches!(key.alg, 8 | 10) {
                let exponent_len = match key.pubkey.first() {
                    Some(0) if key.pubkey.len() >= 3 => 3 + u16::from_be_bytes([key.pubkey[1], key.pubkey[2]]) as usize,
                    Some(len) => 1 + *len as usize,
                    None => return Err("invalid-rsa-key"),
                };
                let modulus = key.pubkey.get(exponent_len..).ok_or("invalid-rsa-key")?;
                let first = modulus.iter().position(|b| *b != 0).ok_or("invalid-rsa-key")?;
                let bits = (modulus.len() - first) * 8 - modulus[first].leading_zeros() as usize;
                if bits < 1024 { return Err("weak-rsa-key"); }
            }
        }
    }
    let verified = verify_rr_stream(&records).map_err(|_| "dnssec-invalid")?;
    if now < verified.valid_from || now >= verified.expires { return Err("dnssec-expired-or-not-yet-valid"); }
    let mut matching = Vec::new();
    for record in verified.resolve_name(&name) {
        if let RR::Txt(txt) = record {
            let bytes = txt.data.as_vec();
            if bytes.len() >= 8 && bytes[..8].eq_ignore_ascii_case(b"bitcoin:") {
                matching.push(String::from_utf8(bytes).map_err(|_| "invalid-txt-encoding")?);
            }
        }
    }
    if matching.len() > 1 { return Err("ambiguous-payment-records"); }
    let uri = matching.first().ok_or("no-authenticated-payment-record")?;
    let instructions = match input["network"].as_str() {
        Some(network) => payment::inspect(uri, network, now)?,
        None => Value::Null,
    };
    Ok(json!({"name": name.as_str(), "uri": uri, "validFrom": verified.valid_from,
        "expires": verified.expires, "maxCacheTtl": verified.max_cache_ttl,
        "verifier": "dnssec-prover-0.6.10", "dnssecValid": true, "instructions": instructions}))
}

// Minimal bounded byte-buffer ABI shared by browsers and the offline Node test.
// Each allocation is represented by its exact boxed-slice length; the JS caller
// frees both its request allocation and the returned result in a finally block.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn allocate(len: u32) -> u32 {
    if len > 1_400_000 { return 0; }
    Box::into_raw(vec![0u8; len as usize].into_boxed_slice()) as *mut u8 as u32
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn deallocate(ptr: u32, len: u32) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr as *mut u8, len as usize)));
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn verify(ptr: u32, len: u32) -> u64 {
    let request = std::slice::from_raw_parts(ptr as *const u8, len as usize);
    let response = match verify_request(request) {
        Ok(value) => value,
        Err(code) => json!({"error": code}),
    };
    let bytes = serde_json::to_vec(&response).unwrap().into_boxed_slice();
    let length = bytes.len() as u64;
    let pointer = Box::into_raw(bytes) as *mut u8 as u64;
    (pointer << 32) | length
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn empty_proof_cannot_validate() {
        assert!(verify_request(br#"{"name":"x.example.","now":1790000000,"proof":""}"#).is_err());
    }
    #[test] fn malformed_and_oversized_proofs_are_rejected() {
        assert_eq!(verify_request(b"broken").unwrap_err(), "invalid-request");
        assert_eq!(verify_request(&vec![0; 1_400_001]).unwrap_err(), "proof-too-large");
    }
    #[test] fn authenticated_offer_is_inspected_without_onchain_fallback_or_network_access() {
        let vectors: Value = serde_json::from_str(include_str!("../bip353-official-vectors.json").trim_start_matches('\u{feff}')).unwrap();
        let vector = &vectors[2];
        let name = format!("{}.", vector["name"].as_str().unwrap().replace('@', ".user._bitcoin-payment."));
        let record = verify_request(&serde_json::to_vec(&json!({"name":name,"proof":vector["proof"],"now":1754481600u64})).unwrap()).unwrap();
        let uri = record["uri"].as_str().unwrap();
        let offer = uri.split("lno=").nth(1).unwrap().split('&').next().unwrap();
        let offer_uri = format!("bitcoin:?lno={}", offer);
        let result = payment::inspect(&offer_uri, "mainnet", 1754481600).unwrap();
        assert_eq!(result["methods"], json!(["Lightning BOLT12"]));
        assert_eq!(result["addresses"], json!([]));
        assert!(payment::inspect(&offer_uri, "signet", 1754481600).is_err());
        assert!(payment::inspect("bitcoin:?lno=lno1broken", "mainnet", 1754481600).is_err());
    }
}
