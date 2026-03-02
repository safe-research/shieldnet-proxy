# Cloudflare Queues Migration

This document describes the changes made to migrate the Shieldnet Proxy from synchronous processing to Cloudflare Queues.

## Overview

The implementation has been updated to use Cloudflare Queues for asynchronous message processing. This provides better scalability and reliability by decoupling HTTP request handling from transaction processing.

## Key Changes

### 1. Queue Configuration (`wrangler.jsonc`)
- Added queue producer binding: `PROPOSAL_QUEUE`
- Added queue consumer configuration with:
  - Max batch size: 10 messages
  - Max batch timeout: 5 seconds

### 2. New Queue Types and Schemas
- Created `src/queue/types.ts` with message type definitions
- Created `src/queue/schemas.ts` with Zod validation schemas
- Supports two message types: `PROPOSAL` and `TRANSACTION`

### 3. Updated HTTP Handlers
- `/propose`, `/tx`, and `/sampled` endpoints now send messages to the queue
- Endpoints return immediately with 202 (Accepted) status
- Sample rate logic is preserved

### 4. Queue Consumer Implementation
- Created `src/queue/consumer.ts` with batch processing logic
- Processes messages in parallel within each batch
- Errors are logged but don't cause retries (as requested)
- Provides batch processing summary in logs

### 5. Updated Worker Export
- Modified `src/index.ts` to export both HTTP handler and queue handler
- Added proper TypeScript types for Cloudflare Workers

## Architecture

```
HTTP Request → Handler → Queue Message → Queue Consumer → Blockchain Transaction
```

### Message Flow:
1. HTTP endpoints receive requests
2. Validate input and check sample rate
3. Create typed queue messages
4. Send to `PROPOSAL_QUEUE`
5. Return 202 immediately
6. Queue consumer processes batches every 5 seconds or 10 messages
7. Each message is processed in parallel
8. Successful transactions are logged
9. Failed transactions are logged but not retried

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

## Configuration

Environment variables remain the same:
- `PRIVATE_KEY`: Wallet private key
- `RPC_URL`: Blockchain RPC endpoint
- `CONSENSUS_ADDRESS`: Consensus contract address
- `CHAIN_ID`: Target chain ID (default: 11155111)
- `SAMPLE_RATE`: Sampling percentage (default: 50)