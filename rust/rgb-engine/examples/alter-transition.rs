use std::io::{self,Read};
use amplify::confinement::Confined;
use rgbstd::containers::Consignment;
use strict_encoding::{StrictDeserialize,StrictSerialize};
fn main(){let mut input=String::new();io::stdin().read_to_string(&mut input).unwrap();let bytes=hex::decode(input.trim()).unwrap();let mut c=Consignment::<true>::from_strict_serialized(Confined::<Vec<u8>,0,2000000>::try_from(bytes).unwrap()).unwrap();let mut bundles=c.bundles.clone().release();let mut transitions=bundles[0].bundle.known_transitions.clone().release();transitions[0].transition.nonce^=1;bundles[0].bundle.known_transitions=Confined::try_from(transitions).unwrap();c.bundles=Confined::try_from(bundles).unwrap();println!("{}",hex::encode(c.to_strict_serialized::<2000000>().unwrap().as_ref()));}
