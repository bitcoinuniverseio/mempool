use elements::{
    confidential::Asset,
    encode::{deserialize, serialize},
    secp256k1_zkp::{Generator, Secp256k1},
    Transaction,
};
use serde_json::{json, Value};
fn main() {
    let paths: Vec<String> = std::env::args().collect();
    let f: Value = serde_json::from_slice(&std::fs::read(&paths[1]).unwrap()).unwrap();
    let tx: Transaction =
        deserialize(&hex::decode(f["transactionHex"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(tx.txid().to_string(), f["txid"].as_str().unwrap());
    let secp = Secp256k1::new();
    let parents: Vec<Transaction> = f["previousTransactions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| deserialize(&hex::decode(x.as_str().unwrap()).unwrap()).unwrap())
        .collect();
    let mut generators = Vec::new();
    for (i, input) in tx.input.iter().enumerate() {
        assert!(!input.has_issuance() && !input.is_pegin);
        assert_eq!(parents[i].txid(), input.previous_output.txid);
        let previous = &parents[i].output[input.previous_output.vout as usize];
        let generator = match previous.asset {
            Asset::Confidential(g) => g,
            Asset::Explicit(a) => Generator::new_unblinded(&secp, a.into_tag()),
            _ => panic!("Null input asset"),
        };
        generators.push(hex::encode(generator.serialize()));
    }
    let out = &tx.output[f["outputIndex"].as_u64().unwrap() as usize];
    let request = json!({"outputHex":hex::encode(serialize(out)),"blindingKey":f["blindingKey"],"rangeproofHex":hex::encode(out.witness.rangeproof.as_ref().unwrap().serialize()),"surjectionproofHex":hex::encode(out.witness.surjection_proof.as_ref().unwrap().serialize()),"inputGenerators":generators});
    let result = universe_liquid_proof::inspect(&serde_json::to_vec(&request).unwrap()).unwrap();
    assert_eq!(result["assetId"], f["expectedAsset"]);
    assert_eq!(result["valueSat"], f["expectedValueSat"]);
    std::fs::write(&paths[2], serde_json::to_vec_pretty(&request).unwrap()).unwrap();
    println!(
        "Verified actual Elements transaction {} output {}: exact asset and amount match wallet",
        tx.txid(),
        f["outputIndex"]
    );
}
