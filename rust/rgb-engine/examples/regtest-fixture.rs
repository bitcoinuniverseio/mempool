use std::{io::{self,Read},str::FromStr,collections::BTreeMap};
use amplify::confinement::Confined;
use rgbstd::{contract::{ContractBuilder,TransitionBuilder,IssuerWrapper,AllocatedState},containers::{BuilderSeal,Consignment,PubWitness,WitnessBundle,SecretSeals},stl::{AssetSpec,ContractTerms,Name,Ticker,RicardianContract},ChainNet,GenesisSeal,GraphSeal,Txid,Identity,Amount,Precision,Operation,Opout,KnownTransition,TransitionBundle};
use rgbcore::{seals::txout::TxPtr,bitcoin::{Transaction,ScriptBuf,consensus::{deserialize,serialize}},dbc::Anchor,validation::DbcProof,commit_verify::{mpc,TryCommitVerify,CommitId,EmbedCommitVerify,Conceal}};
use schemata::{NonInflatableAsset,OS_ASSET};
use strict_encoding::StrictSerialize;
use serde_json::{json,Value};
fn main(){let mut input=String::new();io::stdin().read_to_string(&mut input).unwrap();let request:Value=serde_json::from_str(&input).unwrap();let txid=Txid::from_str(request["funding_txid"].as_str().unwrap()).unwrap();let vout=request["funding_vout"].as_u64().unwrap() as u32;
 let genesis_seal=GenesisSeal::with_blinding(txid,vout,654321u64);
 let contract=ContractBuilder::with(Identity::default(),NonInflatableAsset::schema(),NonInflatableAsset::types(),NonInflatableAsset::scripts(),ChainNet::BitcoinRegtest)
 .add_global_state("spec",AssetSpec{ticker:Ticker::from("RGBTEST"),name:Name::from("Disposable RGB proof"),details:None,precision:Precision::try_from(0).unwrap()}).unwrap()
 .add_global_state("terms",ContractTerms{text:RicardianContract::default(),media:None}).unwrap()
 .add_global_state("issuedSupply",Amount::from(1000u64)).unwrap()
 .add_fungible_state("assetOwner",BuilderSeal::from(genesis_seal),1000u64).unwrap().issue_contract_raw(request["created_at"].as_i64().unwrap()).unwrap();
 let opout=Opout{op:contract.genesis.id(),ty:OS_ASSET,no:0};let contract_id=contract.genesis.contract_id();
 let mut tx:Transaction=deserialize(&hex::decode(request["raw_tx"].as_str().unwrap()).unwrap()).unwrap();let recipient=tx.output.iter().position(|o|!o.script_pubkey.is_op_return()).unwrap() as u32;
 let seal=GraphSeal::with_blinding(TxPtr::WitnessTx,recipient,987654u64);
 let transition=TransitionBuilder::named_transition(contract_id,NonInflatableAsset::schema(),"transfer",NonInflatableAsset::types()).unwrap().set_nonce(0)
 .add_input(opout,AllocatedState::from(Amount::from(1000u64))).unwrap().add_fungible_state("assetOwner",BuilderSeal::from(seal),1000u64).unwrap().complete_transition().unwrap();
 let opid=transition.id();let bundle=TransitionBundle{input_map:Confined::try_from(BTreeMap::from([(opout,opid)])).unwrap(),known_transitions:Confined::try_from(vec![KnownTransition::new(opid,transition)]).unwrap()};
 let protocol=mpc::ProtocolId::from(contract_id);let source=mpc::MultiSource{messages:Confined::try_from(BTreeMap::from([(protocol,mpc::Message::from(bundle.bundle_id()))])).unwrap(),static_entropy:Some(123456),..Default::default()};
 let tree=mpc::MerkleTree::try_commit(&source).unwrap();let commitment=tree.commit_id();let proof=mpc::MerkleBlock::from(tree).to_merkle_proof(protocol).unwrap();
 for o in &mut tx.output{if o.script_pubkey.is_op_return(){o.script_pubkey=ScriptBuf::from_bytes(vec![0x6a]);break;}}
 let dbc=tx.embed_commit(&commitment).unwrap();let witness_id=tx.compute_txid();
 let transfer=Consignment::<true>{version:contract.version,transfer:true,terminals:Confined::try_from(BTreeMap::from([(bundle.bundle_id(),SecretSeals::from(Confined::try_from(std::collections::BTreeSet::from([seal.conceal()])).unwrap()))])).unwrap(),genesis:contract.genesis.clone(),bundles:Confined::try_from(vec![WitnessBundle::with(PubWitness::Txid(witness_id),Anchor::new(proof,DbcProof::Opret(dbc)),bundle)]).unwrap(),schema:contract.schema.clone(),types:contract.types.clone(),scripts:contract.scripts.clone()};
 let bytes=transfer.to_strict_serialized::<2000000>().unwrap();println!("{}",json!({"consignment":hex::encode(bytes.as_ref()),"raw_tx":hex::encode(serialize(&tx)),"contract_id":contract_id.to_string(),"anchor_txid":witness_id.to_string(),"network":"regtest"}));}
