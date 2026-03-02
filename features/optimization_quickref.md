# Transaction Optimization Quick Reference

> 📖 Full details: [submission_optimization.md](./submission_optimization.md)

## 🎯 Top 2 Recommendations (Viem Best Practices)

### 1. 🔥 Batch-Level Gas Price
**Impact:** 🟢🟢🟢 High | **Effort:** 🔵 Low | **Risk:** 🟢 Low

Fetch gas price once per batch, reuse for all transactions.

```typescript
const gasPrice = await client.getGasPrice();
// Reuse for all transactions in batch
```

**Savings:** N-1 RPC calls per batch  
**Implementation Time:** 2-4 hours  
**RPC Reduction:** 33%

---

### 2. 🔥 Local Gas Estimation
**Impact:** 🟢🟢🟢 High | **Effort:** 🔵🔵 Medium | **Risk:** 🟡 Medium

Calculate gas limits locally based on calldata size instead of RPC calls.

```typescript
function estimateGasSimplified(calldataBytes: number): bigint {
  const baseGas = 60_000n;
  const perByteGas = 25n;
  const estimated = baseGas + BigInt(calldataBytes) * perByteGas;
  return (estimated * 120n) / 100n; // 20% buffer
}
```

**Savings:** N RPC calls per batch (no more eth_estimateGas)  
**Implementation Time:** 4-8 hours  
**Combined RPC Reduction:** 63%

---

## 📊 RPC Call Comparison

| Scenario | Batch Size | Current | After Phase 1 | After Phase 2 |
|----------|-----------|---------|---------------|---------------|
| Light | 10 tx | ~30 calls | ~20 calls | ~11 calls |
| Medium | 50 tx | ~150 calls | ~100 calls | ~51 calls |
| Heavy | 100 tx | ~300 calls | ~200 calls | ~101 calls |

**Phase 1** = Batch-level gas price (33% reduction)  
**Phase 2** = Phase 1 + Local gas estimation (63% reduction)

---

## 🚀 Implementation Phases

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Batch-Level Gas Price (2-4 hours)                      │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Fetch gas price once per batch                               │
│ ✅ Pass to all transactions                                     │
│ 📈 Result: 33% RPC reduction                                    │
│ 🎯 Production proven with viem                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Local Gas Estimation (4-8 hours + calibration)        │
├─────────────────────────────────────────────────────────────────┤
│ 🎯 Implement calldata-based gas formula                        │
│ 🎯 Add configuration parameters                                │
│ 🎯 Collect calibration data                                    │
│ 📈 Result: 63% total RPC reduction                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: Monitoring & Calibration (Ongoing)                     │
├─────────────────────────────────────────────────────────────────┤
│ ⚡ Weekly gas usage review                                      │
│ ⚡ Monthly parameter calibration                                │
│ ⚡ Quarterly cost analysis                                      │
│ 📈 Result: Optimal performance & cost                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💰 Expected Savings (Example: 1000 tx/day)

### Current State
- **RPC Calls:** 3,000/day (3 per tx)
- **RPC Cost:** ~$110/year (at $0.0001/call)
- **Gas Cost:** Varies by chain

### After Phase 1 (Batch Gas Price)
- **RPC Calls:** 2,000/day (-33%)
- **RPC Cost:** ~$73/year
- **Processing Time:** 50% faster

### After Phase 2 (+ Local Gas Estimation)
- **RPC Calls:** 1,100/day (-63%)
- **RPC Cost:** ~$40/year (-64%)
- **Processing Time:** 75% faster
- **Total Savings:** ~$300-700/year (including infrastructure)

---

## ⚠️ Risk Mitigation

| Risk | Mitigation |
|------|------------|
| **Local estimation too low (OOG)** | 20% safety buffer, monitor failures, auto-retry with RPC |
| **Local estimation too high** | Calibrate with real data, adjust parameters monthly |
| **Gas price stale** | Batch processing is fast (<5s), add 10% buffer if needed |
| **Contract behavior changes** | Monitor gas usage spikes, quarterly calibration |
| **Estimation accuracy drift** | Weekly metrics review, configurable parameters |

---

## 📋 Pre-Implementation Checklist

### Phase 1 Prep
- [ ] Gather current metrics (RPC calls per batch)
- [ ] Set up monitoring dashboard
- [ ] Test in staging environment
- [ ] Define rollback procedure

### Phase 2 Prep
- [ ] Analyze last 100-200 transactions for gas usage
- [ ] Calculate baseline: average gas + calldata size
- [ ] Determine initial formula parameters (base + per-byte)
- [ ] Set up gas usage alerts
- [ ] Plan calibration period (48 hours)

---

## 🔍 Monitoring Metrics

Track these after implementation:

```typescript
// Key metrics to monitor
{
  estimateGasCallsPerBatch: number,   // Target: 0 after Phase 2
  gasPriceCallsPerBatch: number,      // Target: 1 after Phase 1
  totalRpcCallsPerBatch: number,      // Target: -63% after Phase 2
  avgBatchProcessingTime: number,     // Target: -75% after Phase 2
  gasEstimationAccuracy: number,      // estimated/actual ~1.0-1.1
  transactionFailureRate: number,     // Target: <0.1%
  outOfGasFailures: number,           // Target: 0
  avgGasUsed: bigint,                 // Monitor for increases
}
```

---

## 📚 Additional Resources

- [Full Proposal](./submission_optimization.md) - Detailed analysis and options
- [Viem Documentation](https://viem.sh) - Transaction options
- [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559) - Gas pricing
- [Multicall3](https://www.multicall3.com/) - Batching pattern

---

## 🤔 Decision Tree

```
Ready to start optimization?
├─ YES → Begin with Phase 1 (Batch Gas Price)
│   │
│   ├─ Success? Monitor for 48 hours
│   │   ├─ NO issues → Proceed to Phase 2
│   │   └─ Issues → Rollback, investigate
│   │
│   └─ Phase 2 (Local Gas Estimation)
│       ├─ Collect historical gas data (100+ tx)
│       ├─ Calculate formula parameters
│       ├─ Deploy with conservative buffer
│       ├─ Monitor & calibrate for 1 week
│       └─ Adjust parameters based on data
│
└─ NO → Gather metrics first, then decide

Is accuracy critical? (finance, high-value)
├─ YES → Use higher safety buffer (25-30%)
└─ NO → Standard 20% buffer is fine

Transaction volume patterns?
├─ Consistent → Fixed parameters work well
└─ Variable → Consider configurable approach
```

---

## ✅ Success Criteria

**Phase 1:**
- [ ] RPC calls reduced by 33%
- [ ] No increase in failed transactions
- [ ] Batch processing 50% faster

**Phase 2:**
- [ ] RPC calls reduced by 63% total
- [ ] Transaction failure rate <0.1%
- [ ] Out-of-gas failures = 0
- [ ] Gas estimation accuracy 100-110%

---

**Last Updated:** 2024-03-02  
**Status:** Proposal - Ready for Implementation  
**Owner:** Engineering Team  
**Timeline:** 2-3 weeks
