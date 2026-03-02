# CLAUDE.md — Shieldnet Proxy

## Project Overview

**Shieldnet Proxy** is a Cloudflare Worker (TypeScript) that bridges Safe multisig wallets to a Consensus smart contract. When a Safe transaction is executed, the proxy receives a webhook event, fetches the full transaction details from the Safe API, then signs and submits a `proposeTransaction` call to the Consensus contract on-chain.

---

## Repository Structure

```
shieldnet-proxy/
├── src/
│   ├── index.ts               # Entry point: Hono app, route definitions, Bindings type
│   ├── config/
│   │   ├── chains.ts          # Supported viem chains (gnosis, sepolia, anvil)
│   │   ├── schemas.ts         # Zod schema for runtime env/config validation
│   │   └── types.ts           # Config type (inferred from configSchema)
│   ├── proposals/
│   │   └── handler.ts         # HTTP handlers: handleProposal, handleTx, submitTransaction
│   ├── safe/
│   │   ├── schemas.ts         # Zod schemas for Safe events and API responses
│   │   ├── service.ts         # Fetches transaction details from api.safe.global
│   │   └── types.ts           # MetaTransaction, SafeTransaction, SafeTransactionWithDomain
│   └── utils/
│       ├── abis.ts            # Consensus contract ABI (proposeTransaction, etc.)
│       ├── errors.ts          # Unified error handler (Zod errors → 400, others → 500)
│       └── schemas.ts         # Shared primitives: checkedAddressSchema, hexDataSchema, bigintStringSchema
├── .dev.vars.sample           # Template for local secrets
├── biome.json                 # Linter/formatter config (Biome)
├── package.json               # Scripts and dependencies
├── tsconfig.json              # TypeScript config (ESNext, NodeNext, strict)
├── wrangler.jsonc             # Cloudflare Worker config (entry, env vars, secrets)
└── worker-configuration.d.ts  # Auto-generated Cloudflare bindings type (do not edit)
```

---

## Development Workflow

### Setup

```sh
npm install
cp .dev.vars.sample .dev.vars   # Fill in PRIVATE_KEY and RPC_URL
```

### Local Development

```sh
npm run dev          # Start local Wrangler dev server at http://localhost:8787
```

### Code Quality

```sh
npm run check        # Biome lint + TypeScript type-check (must pass before committing)
npm run fix          # Auto-fix Biome linting issues
```

Always run `npm run check` before committing. Both Biome and `tsc` must pass with zero errors.

### Deployment

```sh
# Set required secrets (one-time or on rotation):
echo "0x<private-key>" | npm exec -- wrangler secret put PRIVATE_KEY
echo "https://<rpc-url>" | npm exec -- wrangler secret put RPC_URL

npm run deploy       # Build + deploy to Cloudflare (minified)
```

### Type Generation

```sh
npm run cf-typegen   # Regenerate worker-configuration.d.ts from wrangler.jsonc
```

Run this after changing bindings in `wrangler.jsonc`. Do **not** manually edit the generated file.

---

## API Endpoints

| Method | Path       | Description |
|--------|------------|-------------|
| POST   | `/propose` | Receives a Safe webhook event (`EXECUTED_MULTISIG_TRANSACTION`), fetches tx details from Safe API, then submits to Consensus contract asynchronously. Always returns `202`. |
| POST   | `/sampled` | Same as `/propose` but randomly skips based on `SAMPLE_RATE` (%). |
| POST   | `/tx`      | Direct submission — accepts a complete `SafeTransactionWithChainId` object and submits it synchronously. Returns `202` on success. |

### Request Flow

```
POST /propose
  → validate body with transactionExecutedEventSchema
  → if sampled & random() > SAMPLE_RATE → skip (202)
  → executionCtx.waitUntil(processProposal(...))   ← async, non-blocking
  → return 202

processProposal
  → transactionDetails(chainId, safeTxHash)  ← Safe API call
  → submitTransaction(config, details)        ← viem writeContract

submitTransaction
  → createWalletClient with PRIVATE_KEY + RPC_URL
  → client.writeContract({ address: CONSENSUS_ADDRESS, fn: proposeTransaction, args: [tx] })
  → log transactionHash
```

Invalid/unrecognised webhook payloads are silently ignored (202) — this is intentional to handle Safe sending non-execution events.

---

## Environment & Configuration

### Variables (in `wrangler.jsonc`)

| Variable           | Default                                      | Description |
|--------------------|----------------------------------------------|-------------|
| `CONSENSUS_ADDRESS`| `0x49Db717Adec0D22235A73C3a9c2ea57AB0bC2353` | Consensus contract address |
| `CHAIN_ID`         | `11155111` (Sepolia)                         | Target chain for the Consensus contract |
| `SAMPLE_RATE`      | `50`                                         | Percentage of `/sampled` requests to process (0–100) |

### Secrets (set via `wrangler secret put`)

| Secret        | Description |
|---------------|-------------|
| `PRIVATE_KEY` | Ethereum private key (hex, `0x`-prefixed) used to sign Consensus transactions |
| `RPC_URL`     | JSON-RPC endpoint for the target chain |

Secrets are never committed. For local dev, put them in `.dev.vars` (gitignored).

### Supported Chains

The Safe API proxy (`src/safe/service.ts`) only supports:
- Chain `1` → `eth` (Ethereum mainnet)
- Chain `100` → `gno` (Gnosis)

The Consensus contract (`src/config/chains.ts`) supports: `gnosis`, `sepolia`, `anvil`.

> Requests for unsupported chains are silently dropped (returns `null` from `transactionDetails`).

---

## Key Conventions

### Module Boundaries

Each domain folder follows a consistent three-file pattern:
- `schemas.ts` — Zod schemas for input/output validation
- `types.ts` — TypeScript types inferred from schemas (`z.infer<...>`) or hand-written
- Service/handler files — business logic

### Zod Schemas

- **Always** use Zod for external input validation (HTTP bodies, env vars, API responses).
- Use `safeParse` for inputs that can be silently ignored on failure; use `parse` only when a failure should throw.
- Reuse shared primitives from `src/utils/schemas.ts`:
  - `checkedAddressSchema` — EIP-55 checksummed address
  - `hexDataSchema` — validated `0x`-prefixed hex string
  - `bigintStringSchema` — coerces numeric strings to `bigint` (min 0)

### TypeScript

- Strict mode is enabled (`"strict": true` in `tsconfig.json`). No `any` escapes.
- Prefer `import type` for type-only imports.
- Types derived from Zod schemas use `z.infer<typeof schema>` (see `Config` in `src/config/types.ts`).
- Module imports must use `.js` extensions (NodeNext resolution), e.g., `import { x } from "./foo.js"`.

### Error Handling

- HTTP handlers wrap logic in `try/catch` and delegate to `handleError` in `src/utils/errors.ts`.
- `ZodError` → 400 with validation issues.
- Generic `Error` → 500 with message.
- Unknown → 500 with `"Unknown error"`.
- Background async tasks (`processProposal`) catch internally and `console.error` — they never propagate to the HTTP response.

### Async / Background Work

- Use `c.executionCtx.waitUntil(promise)` for fire-and-forget async work (e.g., blockchain submission after acknowledging a webhook). This keeps the HTTP response fast while ensuring the Worker runtime waits for the task to finish before terminating.

### Naming

| Scope | Convention | Example |
|-------|------------|---------|
| Directories | kebab-case | `src/proposals/` |
| Files | camelCase | `handler.ts`, `schemas.ts` |
| Types / Interfaces | PascalCase | `SafeTransaction`, `Config` |
| Constants | UPPER_SNAKE_CASE | `CONSENSUS_FUNCTIONS`, `SHORT_NAMES` |
| Variables / Functions | camelCase | `handleProposal`, `transactionDetails` |

### Formatting (Biome)

- Max line width: **120 characters**
- No useless `else` after `return`/`throw`
- No inferrable type annotations (let TypeScript infer where obvious)
- Single variable declarations per `const`/`let` statement
- Run `npm run fix` to auto-correct style issues before committing

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `hono` | Lightweight HTTP framework for Cloudflare Workers |
| `viem` | Ethereum library — wallet client, contract interaction, type-safe ABI |
| `zod` | Schema validation and type inference |
| `dotenv` | Load env vars in non-Worker contexts (e.g., local scripts) |
| `wrangler` | Cloudflare Workers CLI, local dev server, deployment |
| `@biomejs/biome` | Linter and formatter (replaces ESLint + Prettier) |
| `typescript` | TypeScript compiler |
| `tsx` | Run TypeScript files directly (for ad-hoc scripts) |

---

## Testing

There are currently **no automated tests**. Manual testing can be done against the local dev server:

```sh
# Test /propose with a real Safe transaction
curl http://localhost:8787/propose \
  -H "Content-Type: application/json" \
  -d '{"type":"EXECUTED_MULTISIG_TRANSACTION","chainId":"1","address":"0x1280C3d641ad0517918e0E4C41F4AD25f6b39144","safeTxHash":"0x20e178f2ce590c235d30a6e99a78e799053f36bafe2d2022a642be03cb89058c"}'

# Test /tx with explicit transaction data
curl http://localhost:8787/tx \
  -H "Content-Type: application/json" \
  -d '{...}'
```

Expected response for all endpoints: `HTTP 202` (empty body on success).

---

## CI/CD

There is currently **no CI/CD pipeline**. Deployment is manual via `npm run deploy`.

When adding CI, the recommended checks are:
1. `npm run check` (lint + typecheck)
2. Any test suite added in the future

---

## Contract Interface (Consensus)

The `proposeTransaction` function on the Consensus contract takes a `SafeTransaction` struct:

```solidity
struct SafeTransaction {
    uint256 chainId;
    address safe;
    address to;
    uint256 value;
    bytes   data;
    uint8   operation;       // 0 = CALL, 1 = DELEGATECALL
    uint256 safeTxGas;
    uint256 baseGas;
    uint256 gasPrice;
    address gasToken;
    address refundReceiver;
    uint256 nonce;
}

function proposeTransaction(SafeTransaction transaction) external returns (bytes32 transactionHash);
```

The ABI is defined in `src/utils/abis.ts` via `viem`'s `parseAbi`.

---

## Important Notes for AI Assistants

1. **Never commit `.dev.vars` or any file containing `PRIVATE_KEY` / `RPC_URL` values.**
2. **Do not edit `worker-configuration.d.ts`** — it is auto-generated by `npm run cf-typegen`.
3. **Run `npm run check` after every change** — both Biome and `tsc` must pass.
4. **Invalid/unsupported payloads return `202`** intentionally — do not change this to `400` for webhook endpoints; it prevents Safe from retrying on unknown event types.
5. **Module imports require `.js` extensions** even for `.ts` source files (NodeNext resolution requirement).
6. **`bigintStringSchema` coerces numeric strings** — JSON fields like `"value": "1000000000000000000"` are automatically converted to `bigint`.
7. **The `SAMPLE_RATE` default in `configSchema` is `10`** (10%), not the `50` shown in `wrangler.jsonc` — `wrangler.jsonc` overrides the default at deploy time.
