use bitcoin::Network;
use bitcoin_payment_instructions::{PaymentInstructions, PaymentMethod, PossiblyResolvedPaymentMethod,
    amount::Amount, hrn_resolution::{HrnResolver, HrnResolutionFuture, HumanReadableName, LNURLResolutionFuture}};
use serde_json::{json, Value};
use std::{future::Future, task::{Context, Poll, Waker}};

struct NoNetwork;
impl HrnResolver for NoNetwork {
    fn resolve_hrn<'a>(&'a self, _: &'a HumanReadableName) -> HrnResolutionFuture<'a> { Box::pin(async { Err("network-disabled") }) }
    fn resolve_lnurl<'a>(&'a self, _: &'a str) -> HrnResolutionFuture<'a> { Box::pin(async { Err("network-disabled") }) }
    fn resolve_lnurl_to_invoice<'a>(&'a self, _: String, _: Amount, _: [u8; 32]) -> LNURLResolutionFuture<'a> { Box::pin(async { Err("network-disabled") }) }
}

pub fn inspect(uri: &str, network: &str, now: u64) -> Result<Value, &'static str> {
    let network = match network {
        "" | "mainnet" => Network::Bitcoin, "testnet" => Network::Testnet,
        "testnet4" => Network::Testnet4, "signet" => Network::Signet, "regtest" => Network::Regtest,
        _ => return Err("unsupported-network"),
    };
    let mut future = Box::pin(PaymentInstructions::parse(uri, network, &NoNetwork, false));
    let parsed = match future.as_mut().poll(&mut Context::from_waker(Waker::noop())) {
        Poll::Ready(Ok(parsed)) => parsed,
        _ => return Err("invalid-or-unsupported-payment-instructions"),
    };
    let methods: Vec<&PaymentMethod> = match &parsed {
        PaymentInstructions::FixedAmount(instructions) => instructions.methods().iter().collect(),
        PaymentInstructions::ConfigurableAmount(instructions) => instructions.methods().filter_map(|m| match m {
            PossiblyResolvedPaymentMethod::Resolved(method) => Some(method), _ => None,
        }).collect(),
    };
    if methods.is_empty() { return Err("no-local-payment-instructions"); }
    let mut kinds = Vec::new();
    let mut addresses = Vec::new();
    let mut expires = u64::MAX;
    for method in methods {
        match method {
            PaymentMethod::OnChain(address) => { kinds.push("On-chain"); addresses.push(address.to_string()); },
            PaymentMethod::LightningBolt11(invoice) => {
                kinds.push("Lightning BOLT11");
                expires = expires.min(invoice.duration_since_epoch().as_secs().saturating_add(invoice.expiry_time().as_secs()));
            },
            PaymentMethod::LightningBolt12(offer) => {
                kinds.push("Lightning BOLT12");
                if let Some(expiry) = offer.absolute_expiry() { expires = expires.min(expiry.as_secs()); }
            },
            PaymentMethod::Cashu(_) => { kinds.push("Cashu"); },
        }
    }
    if expires <= now { return Err("payment-instructions-expired"); }
    Ok(json!({"methods": kinds, "addresses": addresses,
        "expires": if expires == u64::MAX { Value::Null } else { json!(expires) }}))
}
