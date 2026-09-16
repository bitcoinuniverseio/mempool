// Public exact-source Lean kernel fixture.
export const LEAN_PROOF_SAMPLE = {
  "schema_version": "1.0.0",
  "proof_system": "lean4",
  "source_text": "fn main() { assert!(jet::eq_32(42,42)); }",
  "program_bytes_hex": "d89b20000002a0408cdb882300813420e050",
  "program_cmr": "30b9ef28f62fbea32fe937efe2e13302b77bb036a4934b3547fe6bcba2721bd0",
  "source_hash": "bee51b83bf9db775a928abfc3e270fd73529e40a9529e70a1b875c587d2ecf9b",
  "compiler_revision": "simplicityhl-0.2.0",
  "libSimplicity_revision": "simplicity-sys-0.5.0",
  "proof_source": "{\"profile\":\"simplicity-u32-equality-v1\",\"left\":42,\"right\":42,\"term\":\"refl\",\"value\":42,\"program_cmr\":\"30b9ef28f62fbea32fe937efe2e13302b77bb036a4934b3547fe6bcba2721bd0\",\"program_bytes_sha256\":\"e979d6eeb2a74a1fd44493658d15550b5838e2ee9cabc645606cb267f769d87d\"}",
  "proof_source_hash": "9997944ef8d129b5248c1f2d0a28e267cf0ac4f5f662ed4a615a2975b35b337d",
  "proof_artifact_hash": "e979d6eeb2a74a1fd44493658d15550b5838e2ee9cabc645606cb267f769d87d",
  "statement": "(42 : UInt32) = (42 : UInt32)",
  "dependencies": [
    "simplicityhl-0.2.0",
    "simplicity-sys-0.5.0",
    "lean-4.24.0"
  ],
  "verification_command": "Bounded owned Lean kernel adapter; client commands are inert.",
  "proof_profile": "simplicity-u32-equality-v1",
  "kernel_revision": "lean-4.24.0"
} as const;
