# Transaction Submission Optimization Proposal

## Executive Summary

This document outlines practical optimization strategies to reduce RPC usage when submitting transactions to the blockchain. Based on production experience with viem, we focus on two proven approaches:

1. **Batch-Level Gas Prices**: Fetch gas price once per batch, reuse for all transactions
2. **Local Gas Estimation**: Calculate gas limits locally based on calldata size, eliminating RPC calls

These optimizations will reduce RPC calls by **~50%** (eliminating N estimateGas and N-1 gasPrice calls per batch).

## Current State

**Current Implementation:**
- Each transaction submission triggers multiple RPC calls:
  - `eth_getTransactionCount` (nonce) - handled by viem's nonceManager
  - `eth_estimateGas` - automatic gas estimation ⚠️ **Target for elimination**
  - `eth_gasPrice` or `eth_feeHistory` - gas price fetching ⚠️ **Target for optimization**
  - `eth_sendRawTransaction` - transaction submission

**Current Bottlenecks:**
- **Gas estimation:** Called for every transaction individually (N RPC calls)
- **Gas price:** Fetched separately for each transaction (N RPC calls)
- Each RPC call adds network latency (~50-200ms per call)

**For a batch of 10 transactions:**
- Current: ~30 RPC calls (10 estimate + 10 gasPrice + 10 send)
- Target: ~11 RPC calls (1 gasPrice + 10 send)
- **Reduction: 63%**

---

## Optimization 1: Batch-Level Gas Prices

### Overview

Fetch gas price **once per batch** at the beginning, then reuse for all transactions in that batch. This is a proven pattern that works well with viem.

### Benefits

- ✅ **Eliminates N-1 RPC calls** per batch (from N gasPrice calls to 1)
- ✅ **Consistent pricing** across batch (no mid-batch price fluctuations)
- ✅ **Simple implementation** (2-4 hours)
- ✅ **Low risk** (easy rollback)
- ✅ **Production proven** with viem

### Implementation

```typescript
export async function handleQueueBatch(batch: MessageBatch<QueueMessage>, env: QueueEnv): Promise<void> {
  const config = configSchema.parse(env);
  
  const chain = extractChain({
    chains: supportedChains,
    id: config.CHAIN_ID,
  });
  const account = privateKeyToAccount(config.PRIVATE_KEY, {
    nonceManager,
  });
  const client = createWalletClient({
    chain,
    account,
    transport: http(config.RPC_URL),
  });

  // ✨ NEW: Fetch gas price once for entire batch
  const gasPrice = await client.getGasPrice();
  
  // For EIP-1559 chains, use:
  // const { maxFeePerGas, maxPriorityFeePerGas } = await client.estimateFeesPerGas();

  const results = await Promise.allSettled(
    batch.messages.map(async (message: Message<QueueMessage>) => {
      try {
        const parsedMessage = queueMessageSchema.parse(message.body);
        // ✨ Pass gas price to each transaction
        await submitTransaction(client, chain, account, config, parsedMessage.data, gasPrice);
        message.ack();
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error);
        message.ack();
      }
    }),
  );

  const successful = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  console.info(`Batch processed: ${successful} successful, ${failed} failed`);
}

async function submitTransaction(
  client: ReturnType<typeof createWalletClient>,
  chain: ReturnType<typeof extractChain>,
  account: ReturnType<typeof privateKeyToAccount>,
  config: Config,
  details: SafeTransactionWithDomain,
  gasPrice: bigint, // ✨ NEW parameter
): Promise<void> {
  const transactionHash = await client.writeContract({
    chain,
    account,
    address: config.CONSENSUS_ADDRESS,
    abi: CONSENSUS_FUNCTIONS,
    functionName: "proposeTransaction",
    args: [{ ...details }],
    gasPrice, // ✨ Use pre-fetched gas price
  });
  console.info(`Transaction submitted: ${transactionHash}`);
}
```

### For EIP-1559 Chains

```typescript
// Fetch fee data once
const feeData = await client.estimateFeesPerGas();

// Pass to submitTransaction
await submitTransaction(
  client, chain, account, config, 
  parsedMessage.data, 
  feeData.maxFeePerGas,
  feeData.maxPriorityFeePerGas
);

// In submitTransaction
const transactionHash = await client.writeContract({
  // ...
  maxFeePerGas,
  maxPriorityFeePerGas,
});
```

### Risk Mitigation

**Risk:** Gas price becomes stale during batch processing (especially for large batches)

**Mitigation:**
- Batches are typically small (10-50 transactions)
- Processing time is fast (<5 seconds per batch)
- Can add buffer: `gasPrice = gasPrice * 110n / 100n` (10% increase)
- Monitor for stuck transactions, adjust if needed

---

## Optimization 2: Local Gas Estimation

### Overview

Calculate gas limits **locally** based on transaction calldata size instead of calling `eth_estimateGas` for each transaction. This eliminates N RPC calls per batch.

### Why Calldata Size Matters

The `proposeTransaction` function has gas costs that depend on calldata size:

```solidity
function proposeTransaction(SafeTransaction.T memory transaction) 
    public returns (bytes32 transactionHash) 
{
    Epochs memory epochs = _processRollover();
    transactionHash = transaction.hash();          // Keccak256 on transaction data
    bytes32 message = domainSeparator().transactionProposal(epochs.active, transactionHash);
    require($attestations[message].isZero(), AlreadyAttested());
    emit TransactionProposed(                      // Event with transaction data
        transactionHash, 
        transaction.chainId, 
        transaction.safe, 
        epochs.active, 
        transaction  // ⚠️ Full transaction emitted
    );
    _COORDINATOR.sign($groups[epochs.active], message);
}
```

**Variable Gas Costs:**
1. **Calldata:** 4 gas/zero byte, 16 gas/non-zero byte
2. **Hashing:** 30 gas + 6 gas/word for `keccak256(transaction)`
3. **Event emission:** LOG operation with transaction data
4. **Memory expansion:** Depends on transaction size

**Fixed Gas Costs:**
- Base transaction: 21,000 gas
- `_processRollover()`: ~5,000-50,000 gas (depends on state)
- Storage reads: 2,100 gas (cold) or 100 gas (warm)
- External call `_COORDINATOR.sign()`: ~10,000-30,000 gas

### Local Gas Estimation Formula

Based on the contract analysis and Ethereum gas pricing, we can estimate gas locally:

```typescript
/**
 * Estimates gas limit for proposeTransaction based on calldata size
 */
function estimateGasLocally(calldataBytes: number): bigint {
  // 1. Base transaction cost
  const BASE_GAS = 21_000n;
  
  // 2. Calldata cost
  // Approximate: assume 20% zero bytes, 80% non-zero bytes (conservative)
  const zeroBytesEstimate = Math.floor(calldataBytes * 0.2);
  const nonZeroBytesEstimate = calldataBytes - zeroBytesEstimate;
  const CALLDATA_GAS = 
    BigInt(zeroBytesEstimate * 4) + 
    BigInt(nonZeroBytesEstimate * 16);
  
  // 3. Function selector (4 bytes, typically non-zero)
  const FUNCTION_SELECTOR_GAS = 4n * 16n;
  
  // 4. Contract execution overhead
  // - _processRollover(): 5,000-50,000 (use conservative estimate)
  // - transaction.hash(): keccak256 ~30 + 6*words gas
  // - domainSeparator + transactionProposal: ~1,000 gas
  // - Storage read ($attestations): 2,100 gas (cold SLOAD)
  // - Event emission (LOG4): 375 base + 375*4 topics + 8*data_bytes
  // - _COORDINATOR.sign(): ~20,000 gas (external call + crypto)
  
  const ROLLOVER_GAS = 10_000n; // Conservative average
  const HASH_GAS = BigInt(30 + 6 * Math.ceil(calldataBytes / 32)); // Keccak256
  const DOMAIN_GAS = 1_000n;
  const STORAGE_READ_GAS = 2_100n;
  
  // Event emission: LOG4 (4 indexed topics) + event data
  // LOG4: 375 + 375*4 = 1,875 base
  // Plus 8 gas per byte of event data (transaction struct)
  const EVENT_BASE_GAS = 1_875n;
  const EVENT_DATA_GAS = BigInt(calldataBytes * 8);
  
  const COORDINATOR_SIGN_GAS = 20_000n;
  
  const CONTRACT_EXECUTION_GAS = 
    ROLLOVER_GAS +
    HASH_GAS +
    DOMAIN_GAS +
    STORAGE_READ_GAS +
    EVENT_BASE_GAS +
    EVENT_DATA_GAS +
    COORDINATOR_SIGN_GAS;
  
  // 5. Memory expansion (conservative estimate)
  // ~3 gas per word for memory expansion
  const memoryWords = Math.ceil(calldataBytes / 32);
  const MEMORY_EXPANSION_GAS = BigInt(memoryWords * 3);
  
  // Total
  const ESTIMATED_GAS = 
    BASE_GAS +
    FUNCTION_SELECTOR_GAS +
    CALLDATA_GAS +
    CONTRACT_EXECUTION_GAS +
    MEMORY_EXPANSION_GAS;
  
  // Add 20% safety buffer to account for:
  // - State-dependent costs (warm/cold storage)
  // - Network conditions
  // - Edge cases
  const SAFETY_BUFFER = 120n; // 20% = multiply by 1.2
  const FINAL_GAS = (ESTIMATED_GAS * SAFETY_BUFFER) / 100n;
  
  return FINAL_GAS;
}

/**
 * Calculates calldata size for a transaction
 */
function getCalldataSize(transaction: SafeTransactionWithDomain): number {
  // Encode the transaction to get actual calldata size
  // This is a local operation, no RPC call
  const encodedTransaction = encodeAbiParameters(
    [{ type: 'tuple', components: SAFE_TRANSACTION_ABI }],
    [transaction]
  );
  
  // Add 4 bytes for function selector
  return encodedTransaction.length + 4;
}
```

### Simplified Gas Estimation (Rule of Thumb)

For quick implementation without detailed calculation:

```typescript
function estimateGasSimplified(calldataBytes: number): bigint {
  // Base formula: 60,000 base + 25 * calldataBytes
  // This accounts for all overhead with conservative estimates
  const baseGas = 60_000n;
  const perByteGas = 25n; // Covers calldata (16) + event (8) + overhead
  const estimated = baseGas + BigInt(calldataBytes) * perByteGas;
  
  // Add 20% safety buffer
  return (estimated * 120n) / 100n;
}
```

### Implementation (Optimized with Raw Transaction)

Since we're already encoding the transaction data for gas estimation, we can **reuse the encoded data** and submit as a raw transaction instead of using `writeContract` (which would re-encode it):

```typescript
import { 
  encodeAbiParameters, 
  encodeFunctionData,
  type Hex,
  parseAbiParameters,
} from 'viem';

interface EncodedTransactionData {
  data: Hex;           // Encoded transaction data
  calldataSize: number; // Size in bytes
  gasLimit: bigint;    // Estimated gas
}

// Encode and estimate in one step
function encodeAndEstimateGas(
  transaction: SafeTransactionWithDomain
): EncodedTransactionData {
  // Encode the function call data
  const data = encodeFunctionData({
    abi: CONSENSUS_FUNCTIONS,
    functionName: 'proposeTransaction',
    args: [transaction],
  });
  
  // Calculate calldata size (already encoded)
  const calldataSize = (data.length - 2) / 2; // Subtract '0x', divide by 2
  
  // Estimate gas locally
  const gasLimit = estimateGasSimplified(calldataSize);
  
  return { data, calldataSize, gasLimit };
}

function estimateGasSimplified(calldataBytes: number): bigint {
  const baseGas = 60_000n;
  const perByteGas = 25n;
  const estimated = baseGas + BigInt(calldataBytes) * perByteGas;
  return (estimated * 120n) / 100n;
}

// Update submitTransaction to use raw transaction
async function submitTransaction(
  client: ReturnType<typeof createWalletClient>,
  chain: ReturnType<typeof extractChain>,
  account: ReturnType<typeof privateKeyToAccount>,
  config: Config,
  details: SafeTransactionWithDomain,
  gasPrice: bigint,
): Promise<void> {
  // ✨ Encode once and estimate gas (no RPC call!)
  const { data, calldataSize, gasLimit } = encodeAndEstimateGas(details);
  
  console.info(`Estimated gas: ${gasLimit} for calldata size: ${calldataSize} bytes`);
  
  // ✨ Submit raw transaction (reuse encoded data, no re-encoding!)
  const hash = await client.sendTransaction({
    chain,
    account,
    to: config.CONSENSUS_ADDRESS,
    data,
    gas: gasLimit,
    gasPrice,
  });
  
  console.info(`Transaction submitted: ${hash}`);
}
```

**Benefits of Raw Transaction Approach:**
- ✅ **No duplicate encoding** - encode once, use for both estimation and submission
- ✅ **More efficient** - saves CPU cycles from re-encoding
- ✅ **Full control** - explicit control over all transaction parameters
- ✅ **Debugging friendly** - can log/inspect the exact calldata being sent

**Alternative: Keep writeContract (if preferred)**

If you prefer to keep using `writeContract` for its convenience:

```typescript
function estimateGasForTransaction(transaction: SafeTransactionWithDomain): bigint {
  // Encode to get size
  const data = encodeFunctionData({
    abi: CONSENSUS_FUNCTIONS,
    functionName: 'proposeTransaction',
    args: [transaction],
  });
  
  const calldataSize = (data.length - 2) / 2;
  return estimateGasSimplified(calldataSize);
}

async function submitTransaction(
  client: ReturnType<typeof createWalletClient>,
  chain: ReturnType<typeof extractChain>,
  account: ReturnType<typeof privateKeyToAccount>,
  config: Config,
  details: SafeTransactionWithDomain,
  gasPrice: bigint,
): Promise<void> {
  const gasLimit = estimateGasForTransaction(details);
  
  const transactionHash = await client.writeContract({
    chain,
    account,
    address: config.CONSENSUS_ADDRESS,
    abi: CONSENSUS_FUNCTIONS,
    functionName: "proposeTransaction",
    args: [{ ...details }],
    gasPrice,
    gas: gasLimit,
  });
  
  console.info(`Transaction submitted: ${transactionHash}`);
}
```

This trades a small amount of redundant encoding for better code maintainability (writeContract handles edge cases automatically).

### Calibration Process

To calibrate the estimation formula for your specific contract:

1. **Collect Historical Data** (one-time setup):
```typescript
// Enable detailed logging temporarily
async function calibrateGasEstimation() {
  const recentTransactions = await getRecentTransactions(100);
  
  for (const tx of recentTransactions) {
    const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
    const calldataSize = (tx.input.length - 2) / 2;
    
    console.log({
      calldataSize,
      gasUsed: receipt.gasUsed,
      gasPerByte: Number(receipt.gasUsed) / calldataSize,
    });
  }
}
```

2. **Analyze the data**:
   - Calculate average gas used
   - Calculate gas per byte of calldata
   - Identify P95 (95th percentile) for safety buffer

3. **Adjust formula**:
```typescript
// Example calibrated values
const CALIBRATED_BASE_GAS = 58_000n;      // From analysis
const CALIBRATED_PER_BYTE_GAS = 24n;      // From analysis
const CALIBRATED_BUFFER = 115n;           // 15% buffer (from P95 analysis)

function estimateGasCalibrated(calldataBytes: number): bigint {
  const estimated = CALIBRATED_BASE_GAS + BigInt(calldataBytes) * CALIBRATED_PER_BYTE_GAS;
  return (estimated * CALIBRATED_BUFFER) / 100n;
}
```

4. **Configuration-based approach** (recommended):
```typescript
interface QueueEnv {
  PRIVATE_KEY: string;
  RPC_URL: string;
  CONSENSUS_ADDRESS: string;
  CHAIN_ID?: string;
  SAMPLE_RATE?: string;
  // Gas estimation parameters
  GAS_BASE?: string;              // Default: "60000"
  GAS_PER_BYTE?: string;          // Default: "25"
  GAS_BUFFER_PERCENT?: string;    // Default: "20" (20%)
}

function estimateGasFromConfig(
  calldataBytes: number, 
  config: Config
): bigint {
  const baseGas = config.GAS_BASE ? BigInt(config.GAS_BASE) : 60_000n;
  const perByteGas = config.GAS_PER_BYTE ? BigInt(config.GAS_PER_BYTE) : 25n;
  const bufferPercent = config.GAS_BUFFER_PERCENT ? BigInt(config.GAS_BUFFER_PERCENT) : 20n;
  
  const estimated = baseGas + BigInt(calldataBytes) * perByteGas;
  return (estimated * (100n + bufferPercent)) / 100n;
}
```

### Benefits

- ✅ **Eliminates N RPC calls** per batch (no more `eth_estimateGas`)
- ✅ **Faster submission** (~100ms saved per transaction)
- ✅ **Predictable costs** (no surprises from estimation errors)
- ✅ **Configurable** (can tune parameters based on observed usage)
- ✅ **Works offline** (no network dependency for estimation)

### Risk Mitigation

**Risk:** Local estimation is inaccurate, causing out-of-gas failures

**Mitigation:**
- Start with conservative 20% buffer
- Monitor transaction failure rate
- Adjust parameters based on real-world data
- Fallback mechanism: if transaction fails with OOG, retry with `eth_estimateGas`

**Risk:** Contract behavior changes (e.g., `_processRollover` becomes more expensive)

**Mitigation:**
- Monitor gas usage in production
- Set up alerts for gas usage spikes
- Periodic calibration (monthly review of formula)
- Configurable parameters (can adjust without code changes)

---

## Combined Implementation Plan

### Phase 1: Batch-Level Gas Price (2-4 hours)

**Goal:** Reduce RPC calls by ~33% with minimal effort

**Tasks:**
1. Update `handleQueueBatch` to fetch gas price once
2. Pass gas price parameter to `submitTransaction`
3. Use pre-fetched gas price in `writeContract` calls
4. Test in staging environment
5. Deploy to production
6. Monitor for 48 hours

**Success Criteria:**
- No increase in failed transactions
- Measurable reduction in RPC calls
- No performance degradation

---

### Phase 2: Local Gas Estimation (4-8 hours)

**Goal:** Eliminate all `eth_estimateGas` calls

**Tasks:**
1. Implement `estimateGasSimplified` function
2. Implement `getCalldataSize` function
3. Update `submitTransaction` to use local estimation
4. Add configuration parameters (GAS_BASE, GAS_PER_BYTE, GAS_BUFFER_PERCENT)
5. Test with various transaction sizes
6. Deploy to staging with monitoring
7. Collect calibration data (48 hours)
8. Adjust parameters based on data
9. Deploy to production
10. Monitor gas usage and failure rates

**Success Criteria:**
- Transaction failure rate <0.1%
- Zero `eth_estimateGas` RPC calls
- Gas usage within 5% of historical average

---

### Phase 3: Calibration & Monitoring (Ongoing)

**Goal:** Maintain optimal gas estimation accuracy

**Tasks:**
1. Weekly review of gas usage metrics
2. Monthly calibration of parameters
3. Quarterly analysis of cost savings
4. Alert setup for anomalies

---

## Expected Impact

### RPC Call Reduction

| Batch Size | Current RPC Calls | After Phase 1 | After Phase 2 | Reduction |
|------------|-------------------|---------------|---------------|-----------|
| 10 tx | ~30 | ~20 | ~11 | **63%** |
| 50 tx | ~150 | ~100 | ~51 | **66%** |
| 100 tx | ~300 | ~200 | ~101 | **66%** |

**Breakdown per transaction:**
- Current: 3 RPC calls (estimateGas, gasPrice, sendTx)
- After Phase 1: 2.1 RPC calls (estimateGas, 0.1 gasPrice, sendTx)
- After Phase 2: 1.1 RPC calls (0.1 gasPrice, sendTx)

---

### Performance Improvement

**Latency per transaction:**
- Current: ~200ms network latency (2 RPC calls × 100ms)
- After Phase 1: ~100ms network latency (1 RPC call × 100ms)
- After Phase 2: ~50ms network latency (0.5 RPC calls × 100ms average)

**Batch processing time (10 tx):**
- Current: ~2 seconds (200ms × 10)
- After Phase 1: ~1 second (100ms × 10)
- After Phase 2: ~0.5 seconds (50ms × 10)

**Improvement: 75% faster batch processing**

---

### Cost Savings

**Example: 1,000 transactions/day**

**RPC Costs** (at $0.0001 per call):
- Current: 3,000 calls/day × $0.0001 = $0.30/day = **$110/year**
- After Phase 2: 1,100 calls/day × $0.0001 = $0.11/day = **$40/year**
- **Savings: $70/year** (64% reduction)

**Gas Costs:**
- Potentially 2-5% savings from more accurate estimation
- Reduced overpayment from conservative estimates
- **Impact varies by gas price and transaction volume**

**Infrastructure Costs:**
- Reduced RPC provider tier (lower call volume)
- Potential downgrade from premium to standard tier
- **Estimated savings: $20-50/month**

**Total Estimated Savings: $300-700/year**

---

## Monitoring & Metrics

### Key Metrics to Track

```typescript
interface GasMetrics {
  // RPC metrics
  estimateGasCallsPerBatch: number;    // Target: 0
  gasPriceCallsPerBatch: number;       // Target: 1
  totalRpcCallsPerBatch: number;       // Target: N+1
  
  // Gas usage metrics
  avgGasUsed: bigint;                  // Monitor for increases
  avgGasEstimated: bigint;             // Should be close to avgGasUsed
  gasEstimationAccuracy: number;       // (estimated/actual) - should be 1.0-1.1
  
  // Performance metrics
  avgBatchProcessingTime: number;      // Target: -75%
  transactionFailureRate: number;      // Target: <0.1%
  outOfGasFailures: number;            // Target: 0
  
  // Cost metrics
  totalGasCost: bigint;                // Monitor for trends
  avgGasCostPerTx: bigint;             // Compare to baseline
}
```

### Dashboards

Create monitoring dashboards with:

1. **RPC Call Volume**
   - Calls per hour/day
   - Breakdown by type (estimateGas, gasPrice, sendTx, nonce)
   - Cost tracking

2. **Gas Usage**
   - Gas used per transaction (histogram)
   - Estimation accuracy (estimated vs actual)
   - Out-of-gas failures

3. **Performance**
   - Batch processing time (P50, P95, P99)
   - Transaction submission latency
   - Success/failure rates

4. **Alerts**
   - Transaction failure rate >0.5%
   - Out-of-gas failures detected
   - Gas usage spike >20% from baseline
   - RPC call volume increase >10%

---

## Rollback Plan

### If Issues Arise

**Scenario 1: High transaction failure rate**

```typescript
// Quick rollback: Re-enable gas estimation
const USE_GAS_ESTIMATION = process.env.USE_GAS_ESTIMATION === 'true';

async function submitTransaction(...) {
  const gasLimit = USE_GAS_ESTIMATION
    ? await client.estimateContractGas({...})  // Fallback
    : estimateGasForTransaction(details);      // Local
  
  // ...
}
```

**Scenario 2: Out-of-gas failures**

```typescript
// Automatic retry with RPC estimation
async function submitTransactionWithRetry(...) {
  try {
    const gasLimit = estimateGasForTransaction(details);
    await client.writeContract({ gas: gasLimit, ... });
  } catch (error) {
    if (error.message.includes('out of gas')) {
      console.warn('OOG detected, retrying with RPC estimation');
      const gasLimit = await client.estimateContractGas({...});
      await client.writeContract({ gas: gasLimit, ... });
    } else {
      throw error;
    }
  }
}
```

**Scenario 3: Gas price issues**

```typescript
// Fallback to per-transaction gas price
const USE_BATCH_GAS_PRICE = process.env.USE_BATCH_GAS_PRICE !== 'false';

const gasPrice = USE_BATCH_GAS_PRICE
  ? batchGasPrice
  : await client.getGasPrice();  // Per-transaction fallback
```

---

## Testing Strategy

### Before Deployment

1. **Unit Tests**
```typescript
describe('Gas Estimation', () => {
  it('should estimate gas for typical transaction', () => {
    const tx = createMockTransaction(500); // 500 byte calldata
    const estimate = estimateGasSimplified(500);
    expect(estimate).toBeGreaterThan(60_000n);
    expect(estimate).toBeLessThan(100_000n);
  });

  it('should scale with calldata size', () => {
    const estimate1 = estimateGasSimplified(100);
    const estimate2 = estimateGasSimplified(200);
    expect(estimate2).toBeGreaterThan(estimate1);
  });
});
```

2. **Integration Tests**
- Submit test transactions in staging
- Verify gas usage matches estimates
- Test edge cases (max calldata size, min calldata size)

3. **Load Tests**
- Process batch of 100 transactions
- Measure RPC call count
- Verify all transactions succeed

### During Deployment

1. **Canary Deployment**
- Deploy to 10% of traffic
- Monitor for 24 hours
- Gradually increase to 100%

2. **A/B Testing**
- Run both old and new approaches in parallel
- Compare success rates and gas usage
- Switch fully after validation

---

## Conclusion

These two optimizations provide significant benefits with manageable risk:

### Batch-Level Gas Prices ✅
- **Impact:** High (33% RPC reduction)
- **Effort:** Low (2-4 hours)
- **Risk:** Low (production proven)
- **Recommendation:** ✅ **Implement immediately**

### Local Gas Estimation ✅
- **Impact:** High (63% total RPC reduction)
- **Effort:** Medium (4-8 hours + calibration)
- **Risk:** Medium (requires monitoring)
- **Recommendation:** ✅ **Implement after Phase 1 validation**

### Combined Benefits
- **63% fewer RPC calls** (from 3N to 1.1N)
- **75% faster batch processing**
- **$300-700/year cost savings**
- **Better predictability and control**

### Next Steps

1. ✅ Review and approve this proposal
2. ✅ Schedule Phase 1 implementation (1 sprint)
3. ✅ Set up monitoring dashboards
4. ✅ Begin Phase 1 development
5. ✅ Monitor results for 1 week
6. ✅ Begin Phase 2 implementation (1 sprint)
7. ✅ Collect calibration data
8. ✅ Fine-tune parameters
9. ✅ Document final configuration

---

**Document Version:** 1.0  
**Last Updated:** 2024-03-02  
**Status:** Proposal - Ready for Implementation  
**Owner:** Engineering Team  
**Estimated Timeline:** 2-3 weeks total

