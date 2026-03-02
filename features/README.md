# Features & Proposals

This directory contains feature proposals, optimization plans, and architectural enhancement documents for the shieldnet-proxy project.

## Documents

### [Transaction Submission Optimization](./submission_optimization.md)
**Status:** Proposal  
**Priority:** High  
**Effort:** Phase 1 (Low) → Phase 2 (High)

Comprehensive optimization proposal for reducing RPC usage and improving transaction throughput.

📋 **Quick Reference:** [optimization_quickref.md](./optimization_quickref.md) - 1-page summary of key recommendations

#### Quick Summary

**Current State:**
- ~4 RPC calls per transaction (estimateGas, gasPrice, nonce, sendTx)
- Individual transaction submission (no batching)

**Phase 1 Quick Wins (1-2 days):**
- ✅ Batch-level gas price fetching → 50% fewer RPC calls
- ✅ Fixed gas limits → Eliminate N estimateGas calls
- **Impact:** 50-70% reduction in RPC calls

**Phase 2 Smart Contract Enhancement (1-2 weeks):**
- 🎯 On-chain transaction batching
- **Impact:** 95% reduction in RPC calls, 15-20% gas savings

**Phase 3 Advanced (2-4 weeks):**
- WebSocket transport (if high throughput needed)
- Dynamic gas pricing strategies

---

## How to Use This Directory

1. **Proposals** - New features or significant changes start as proposals here
2. **Review** - Team reviews and provides feedback via comments/PRs
3. **Approval** - Approved proposals are marked and scheduled
4. **Implementation** - Code changes reference the proposal document
5. **Archive** - Completed features are marked with status and link to implementation PR

---

## Proposal Template

When creating new proposals, include:

```markdown
# Feature Name

## Executive Summary
Brief description and value proposition

## Current State
What exists today and its limitations

## Proposed Solution
Detailed description of the proposed change

## Implementation Plan
Phased approach with milestones

## Metrics & Success Criteria
How to measure success

## Risk Analysis
What could go wrong and mitigation strategies

## Cost-Benefit Analysis
Effort vs. impact quantification
```

---

## Contributing

To propose a new feature:

1. Create a new `.md` file in this directory
2. Use the template above
3. Submit a PR for review
4. Update this README with a summary
