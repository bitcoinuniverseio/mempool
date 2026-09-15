use bitcoin::{Network,secp256k1::PublicKey};
use lightning::offers::offer::{OfferBuilder, Quantity};
use std::{str::FromStr,num::NonZeroU64};
fn main() {
 // Public key from the official BOLT12 vectors. Unsigned parser fixture only;
 // no corresponding merchant, invoice service or payment acceptance is claimed.
 let key=PublicKey::from_str("02eec7245d6b7d2ccb30380bfbe2a3648cd7a942653f5aa340edcea1f283686619").unwrap();
 let offer=OfferBuilder::new(key).chain(Network::Signet).description("Native Signet parser fixture".into())
  .amount_msats(9007199254740993).supported_quantity(Quantity::Bounded(NonZeroU64::new(9007199254740993).unwrap())).build().unwrap();
 println!("{}",serde_json::json!({"offer":offer.to_string(),"network":"signet","amount_msat":"9007199254740993","scope":"Unsigned official-LDK-generated parser fixture; no issuance, merchant, invoice or payment claim"}));
}
