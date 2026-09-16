use std::io::{self, Read};
fn main(){ let mut input=String::new();io::stdin().take(8_000_001).read_to_string(&mut input).unwrap();println!("{}",universe_rgb_engine::validate_rgb(&input)); }
