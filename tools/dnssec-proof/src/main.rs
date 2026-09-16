#[cfg(not(target_arch = "wasm32"))]
fn main() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use dnssec_prover::{query::build_txt_proof, rr::Name};
    use serde_json::json;
    use std::{net::SocketAddr, time::{SystemTime, UNIX_EPOCH}};
    let result = (|| -> Result<serde_json::Value, &'static str> {
        let mut args = std::env::args().skip(1);
        let resolver: SocketAddr = args.next().ok_or("resolver-required")?.parse().map_err(|_| "invalid-resolver")?;
        let name: Name = args.next().ok_or("name-required")?.as_str().try_into().map_err(|_| "invalid-name")?;
        if args.next().is_some() { return Err("invalid-arguments"); }
        let (proof, ttl) = build_txt_proof(resolver, &name).map_err(|_| "resolver-failure-or-unsigned-answer")?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "invalid-clock")?.as_secs();
        let request = json!({"name": name.as_str(), "now": now, "proof": STANDARD.encode(&proof)});
        let validation = universe_dnssec_proof::verify_request(&serde_json::to_vec(&request).unwrap())?;
        Ok(json!({"proof": STANDARD.encode(&proof), "ttl": ttl, "validation": validation}))
    })();
    match result {
        Ok(value) => println!("{}", value),
        Err(code) => { println!("{}", json!({"error":code})); std::process::exit(1); }
    }
}

#[cfg(target_arch = "wasm32")]
fn main() {}
