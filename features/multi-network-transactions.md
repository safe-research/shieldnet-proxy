# Multi-Network Transaction Submission

## Executive Summary

Extend safenet-proxy to submit transaction attestations to multiple consensus chains
simultaneously, rather than a single configured chain. Each incoming Safe multisig
event results in `proposeTransaction` calls to the consensus contract on all configured
networks, enabling cross-chain consensus coverage from a single proxy instance.

## Current State

The proxy is configured with a single `CHAIN_ID` (the consensus chain) and a single
`RPC_URL`. When a Safe transaction event arrives, one attestation is submitted to one
chain. Expanding coverage to additional networks requires running multiple proxy
instances with separate configurations, which duplicates infrastructure and operational
overhead.

Limitations:
- One proxy instance supports exactly one consensus chain.
- Adding a network means deploying and operating a new worker with its own secrets.
- No shared nonce or fee optimisation across chains.

## Proposed Solution

Replace the single-chain configuration with multi-chain equivalents:

| Old variable | Type | New variable | Type |
|---|---|---|---|
| `CHAIN_ID` | env var (number) | `CHAIN_IDS` | env var (comma-separated) |
| `RPC_URL` | secret (URL string) | `RPC_URLS` | secret (JSON: `Record<chainId, url>`) |
| `CONSENSUS_ADDRESS` | env var (address) | `CONSENSUS_ADDRESSES` | env var (JSON: `Record<chainId, address>`) |
| `PRIVATE_KEY` | secret | `PRIVATE_KEY` | secret (unchanged — same account on all chains) |

### Configuration example

`wrangler.jsonc` (non-secret vars):
```jsonc
"CHAIN_IDS": "11155111,100",
"CONSENSUS_ADDRESSES": "{\"11155111\":\"0xAbc...\",\"100\":\"0xDef...\"}"
```

Cloudflare secret (set once):
```
RPC_URLS = {"11155111":"https://sepolia.rpc...","100":"https://gnosis.rpc..."}
```

### Submission semantics

Every queue message is submitted to **all** chains listed in `CHAIN_IDS`. The
`SafeTransaction` struct passed to `proposeTransaction` already contains the original
`chainId` field, so each consensus chain knows which network the Safe transaction
originated on.

### Batch-level optimisation (preserved)

For each chain, the queue consumer fetches EIP-1559 fees and the account nonce once
per batch. Per-chain nonce is `baseNonce[chain] + messageIndex`, preserving the
existing optimisation across multiple networks.

Submissions across chains for a given message are parallelised with
`Promise.allSettled`, so latency scales with the slowest chain rather than the sum.

### Failure handling

Consistent with the existing no-retry policy: each message is acknowledged after
attempting submission to all chains. Per-chain failures are logged but do not block
other chains or other messages in the batch.

## Implementation Plan

### Phase 1 — Config layer (30 min)
- Update `src/config/schemas.ts`: introduce `RPC_URLS`, `CONSENSUS_ADDRESSES`, `CHAIN_IDS` with cross-field validation.
- Update `src/index.ts` `Bindings` interface.
- Update `wrangler.jsonc`.

### Phase 2 — Queue consumer (1 h)
- Refactor `src/queue/consumer.ts`: per-chain client initialisation, parallel multi-chain submission, per-chain nonce tracking.
- Remove now-unused `Config` import (type no longer threaded into `submitTransaction`).

### Phase 3 — Documentation (30 min)
- Create `features/multi-network-transactions.md` (this file).

## Metrics & Success Criteria

- `npm run check` passes with zero errors.
- For `CHAIN_IDS="A,B"` and a batch of N messages, logs show 2N submission attempts.
- Each chain receives a transaction with the correct `to` address from `CONSENSUS_ADDRESSES`.
- Nonces on each chain form a contiguous sequence with no gaps within the batch.

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RPC_URLS JSON malformed | Low | Startup failure | Zod schema rejects at parse time with clear error |
| Chain missing from RPC_URLS or CONSENSUS_ADDRESSES | Low | Startup failure | Cross-field `.refine()` validates completeness at startup |
| One chain's RPC unreachable | Medium | Partial attestation | Per-chain errors are logged; other chains unaffected |
| Nonce collision if concurrent sender | Low | Transaction failure | Pre-existing limitation; unchanged by this PR |
| Fee spike on one chain causes overpayment | Low | Higher gas cost | Pre-existing 2× buffer; unchanged by this PR |

## Cost-Benefit Analysis

**Effort:** ~2 hours total (config + consumer refactor + docs).

**Benefits:**
- Single worker covers N consensus chains with no additional infrastructure.
- Operational simplicity: one set of secrets to manage.
- Parallel submission means latency overhead for N chains ≈ latency of one chain.

**Costs / trade-offs:**
- `RPC_URLS` and `CONSENSUS_ADDRESSES` are JSON strings, which is slightly less
  ergonomic than named vars. However, this scales cleanly to any number of chains
  without changes to the worker deployment.
- A misconfigured JSON secret silently drops all submissions until the worker is
  redeployed with corrected config — mitigated by startup validation.
