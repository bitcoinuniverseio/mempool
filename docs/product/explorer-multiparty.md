# MuSig2, Multisig Setup, and Wallet Policy Interoperability Center

## Overview
The MuSig2, Multisig Setup, and Wallet Policy Interoperability Center provides coordination tools, policy analysis, and cross-vendor interoperability verification for advanced Bitcoin multiparty custody schemes. It supports BIP327 (MuSig2), BIP129 (Bitcoin Secure Multisig Setup / BSMS), BIP388 (Wallet Policies), and BIP329 (Wallet Labels).

## Privacy and Cryptographic Safety
1. **Zero Exposure of Private Keys or Nonce Secrets**:
   - The platform never requests, handles, or persists private keys, seed phrases, or MuSig2 secret nonces.
   - Nonce reuse warnings and round validations are enforced strictly on public nonces.
2. **Deterministic Round State Machine**:
   - Manages MuSig2 two-round signing workflows with strict checks against nonce reuse and out-of-order partial signature aggregation.
3. **Descriptor Safety & Miniscript Analysis**:
   - Analyzes wallet policy descriptors for resource limits, witness malleability risks, and vendor compatibility without exposing wallet balances.

## Supported Specifications
- **BIP327 (MuSig2)**: Public key aggregation, two-round nonce exchange, partial signature verification, and final Schnorr signature combination.
- **BIP129 (BSMS)**: Secure multiparty coordinator-signer handshake, descriptor verification, and signature proof verification.
- **BIP388 (Wallet Policies)**: Formal wallet policy language for hardware signers, distinguishing internal keys from spending policies.
- **BIP329 (Labels)**: Structured wallet label import and export with cryptographic HMAC integrity protection.

## Routes and Navigation
- `/tools/multiparty`: Center overview, active multiparty sessions, and standards compatibility matrix.
- `/tools/multiparty/musig2`: MuSig2 protocol guide, session creator, and round progress tracker.
- `/tools/multiparty/musig2/session/:sessionId`: Live session coordinator displaying registered keys and nonces.
- `/tools/multiparty/bsms`: BIP129 BSMS coordinator and round-1/round-2 exchange token parser.
- `/tools/multiparty/policies`: BIP388 wallet policy analyzer with AST tree visualization.
- `/tools/multiparty/labels`: BIP329 wallet labels manager with export and cross-wallet synchronization.
- `/tools/multiparty/compatibility`: Hardware signer and software wallet interoperability test matrix.

## API Contracts
- `GET /api/v1/intelligence/multiparty/overview`: Active sessions, registered policies, and supported specifications.
- `GET /api/v1/intelligence/multiparty/musig2/sessions`: List of public or sanitized MuSig2 signing sessions.
- `GET /api/v1/intelligence/multiparty/musig2/sessions/:sessionId`: Detailed status of a MuSig2 signing round.
- `GET /api/v1/intelligence/multiparty/descriptors`: Registered wallet policy descriptors.
- `GET /api/v1/intelligence/multiparty/labels`: Exported label collections with provenance hashes.
- `POST /api/v1/intelligence/multiparty/bsms/verify`: Verification of BSMS coordination records and proofs.
- `POST /api/v1/intelligence/multiparty/policies/analyze`: Static analysis of BIP388 policies and Miniscript safety.
