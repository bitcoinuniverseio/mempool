use bitcoin::{constants::ChainHash, Network};
use lightning::offers::offer::{Offer, Amount, Quantity};
use lightning::util::ser::Writeable;
use serde_json::{json, Value};
use std::io::{self, Read};
fn hex(bytes: &[u8]) -> String { bytes.iter().map(|b| format!("{:02x}", b)).collect() }
fn decode(input: &Value) -> Result<Value, String> {
 let text = input["offer"].as_str().ok_or("Offer string required")?;
 if text.is_empty() || text.len() > 16384 { return Err("Offer must contain 1 to 16384 bytes".into()); }
 let network = match input["network"].as_str() { Some("mainnet")=>Network::Bitcoin, Some("testnet")=>Network::Testnet, Some("testnet4")=>Network::Testnet4, Some("signet")=>Network::Signet, Some("regtest")=>Network::Regtest, _=>return Err("Unsupported network".into()) };
 let now = input["now"].as_u64().ok_or("Exact observation time required")?;
 let offer: Offer = text.parse().map_err(|e| format!("Native BOLT12 parsing rejected input: {:?}", e))?;
 // LDK 0.2.6 accepts two encodings rejected by the pinned official vectors:
 // empty explicit chain lists and excessive Bech32 padding. Round-trip only
 // the permitted case/continuation presentation, preserving exact TLV bytes.
 let normalized = text.split('+').map(str::trim).collect::<String>().to_ascii_lowercase();
 if normalized != offer.to_string() { return Err("Noncanonical BOLT12 Bech32 padding or presentation".into()); }
 if offer.chains().is_empty() { return Err("offer_chains must contain at least one chain".into()); }
 let (amount, zero_amount) = match offer.amount() {
  None=>(Value::Null, false),
  Some(Amount::Bitcoin{amount_msats})=>(json!({"kind":"bitcoin","amount_msat":amount_msats.to_string()}), amount_msats==0),
  Some(Amount::Currency{iso4217_code,amount})=>(json!({"kind":"currency","currency":iso4217_code.as_str(),"amount_minor_units":amount.to_string()}), amount==0),
 };
 if zero_amount { return Err("BOLT12 offer_amount must be greater than zero".into()); }
 let unsupported = offer.offer_features().requires_unknown_bits();
 let expired = offer.absolute_expiry().map(|e| now > e.as_secs()).unwrap_or(false);
 let supported = offer.supports_chain(ChainHash::using_genesis_block(network));
 let quantity = match offer.supported_quantity() { Quantity::One=>json!({"kind":"one"}), Quantity::Unbounded=>json!({"kind":"unbounded"}), Quantity::Bounded(n)=>json!({"kind":"bounded","maximum":n.get().to_string()}) };
 let mut raw=Vec::new(); offer.write(&mut raw).map_err(|_| "Offer serialization failed")?;
 Ok(json!({"status":"decoded", "syntax_valid":true, "engine":"lightning-0.2.6", "network":input["network"],
  "offer_id":hex(&offer.id().0), "canonical_offer":offer.to_string(), "tlv_hex":hex(&raw),
  "description":offer.description().map(|s|s.to_string()), "issuer":offer.issuer().map(|s|s.to_string()),
  "issuer_signing_pubkey":offer.issuer_signing_pubkey().map(|k|k.to_string()), "amount":amount, "quantity":quantity,
  "absolute_expiry":offer.absolute_expiry().map(|e|e.as_secs().to_string()), "expired":expired,
  "network_compatible":supported, "unknown_required_features":unsupported,
  "usable_for_invoice_request":supported&&!expired&&!unsupported,
  "chain_hashes_wire_order":offer.chains().iter().map(|c|hex(c.as_ref())).collect::<Vec<_>>(),
  "blinded_path_count":offer.paths().len(),
  "signature_status":"not-applicable-unsigned-offer", "payment_verified":false,
  "scope":"Native BOLT12 offer decoding and invoice-request eligibility checks only. Offers are unsigned. Issuer identity, invoice signatures, routability and payment completion are not established."}))
}
fn main() {
 let mut bytes=Vec::new(); let result=io::stdin().take(131073).read_to_end(&mut bytes);
 let output=if result.is_err()||bytes.len()>131072 {json!({"status":"invalid","error":"Input exceeds bound"})} else {
  match serde_json::from_slice::<Value>(&bytes).map_err(|_| "Invalid JSON".to_string()).and_then(|v|decode(&v)) { Ok(v)=>v,Err(e)=>json!({"status":"invalid","syntax_valid":false,"error":e}) }
 };
 println!("{}",output);
}
