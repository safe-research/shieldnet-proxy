# Cloudflare Queues Migration

This document describes the changes made to migrate the Shieldnet Proxy from synchronous processing to Cloudflare Queues.

## Overview

The implementation has been updated to use Cloudflare Queues for asynchronous transaction processing. This provides better scalability and reliability by decoupling HTTP request handling from blockchain transaction submission.

## Key Changes

### 1. Queue Configuration (`wrangler.jsonc`)
- Added queue producer binding: `PROPOSAL_QUEUE`
- Added queue consumer configuration with:
  - Max batch size: 10 messages
  - Max batch timeout: 5 seconds

### 2. Queue Types and Schemas
- Created `src/queue/types.ts` with transaction message type
- Created `src/queue/schemas.ts` with Zod validation schemas
- Only queues transaction data (SafeTransactionWithDomain)

### 3. Updated HTTP Handlers (`src/proposals/handler.ts`)
- `/propose` endpoint:
  - Fetches transaction details from Safe API using `c.executionCtx.waitUntil()`
  - Queues the complete transaction data
  - Returns 202 immediately
- `/tx` endpoint:
  - Directly queues the transaction data
  - Returns 202 immediately
- `/sampled` endpoint works the same with sample rate logic
- Sample rate logic is preserved for all endpoints

### 4. Queue Consumer Implementation (`src/queue/consumer.ts`)
- Contains all transaction processing logic (submitTransaction)
- Processes messages in parallel within each batch
- Errors are logged but don't cause retries
- Provides batch processing summary in logs

### 5. Updated Worker Export
- Modified `src/index.ts` to export both HTTP handler and queue handler
- Added proper TypeScript types for Cloudflare Workers

## Architecture

```
Proposal Request → Fetch Transaction Details → Queue Transaction → Submit to Blockchain
Transaction Request → Queue Transaction → Submit to Blockchain
```

### Message Flow:
1. **For Proposals (`/propose`, `/sampled`):**
   - Receive proposal event
   - Check sample rate
   - Fetch transaction details from Safe API (synchronously with waitUntil)
   - Queue complete transaction data
   - Return 202 immediately

2. **For Transactions (`/tx`):**
   - Receive transaction data
   - Check sample rate
   - Queue transaction data directly
   - Return 202 immediately

3. **Queue Processing:**
   - Consumer processes batches every 5 seconds or 10 messages
   - Each transaction is submitted to blockchain in parallel
   - Successful submissions are logged
   - Failed submissions are logged but not retried

## Testing

Use the provided `test-queue.sh` script to test the endpoints:

```bash
./test-queue.sh
```

All endpoints should return HTTP 202 status.

## Deployment

Deploy using the standard Wrangler command:

```bash
npm run deploy
```

The queue will be automatically created if it doesn't exist.

## Monitoring

- Queue metrics are available in the Cloudflare dashboard
- Application logs include batch processing summaries
- Failed messages are logged with error details

## Code Organization

The implementation follows a clear separation of concerns:
- **API Handlers** (`src/proposals/handler.ts`): Handle HTTP requests, validation, and queuing
- **Queue Consumer** (`src/queue/consumer.ts`): Contains all blockchain interaction logic
- **Queue Types** (`src/queue/types.ts`, `src/queue/schemas.ts`): Define message structure

This separation makes it clear what runs in the HTTP context vs the queue context.

## Configuration

Environment variables remain the same:
- `PRIVATE_KEY`: Wallet private key
- `RPC_URL`: Blockchain RPC endpoint
- `CONSENSUS_ADDRESS`: Consensus contract address
- `CHAIN_ID`: Target chain ID (default: 11155111)
- `SAMPLE_RATE`: Sampling percentage (default: 50)