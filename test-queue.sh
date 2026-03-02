#!/bin/bash

# Test script to verify the queue implementation

echo "Testing Cloudflare Queue implementation..."
echo ""

# Test 1: Proposal endpoint
echo "1. Testing /propose endpoint with valid data:"
curl -X POST http://localhost:8787/propose \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -d '{
        "type": "EXECUTED_MULTISIG_TRANSACTION",
        "chainId": "1",
        "address": "0x1280C3d641ad0517918e0E4C41F4AD25f6b39144",
        "safeTxHash": "0x20e178f2ce590c235d30a6e99a78e799053f36bafe2d2022a642be03cb89058c"
    }' \
    -w "\nStatus: %{http_code}\n"

echo ""

# Test 2: Transaction endpoint
echo "2. Testing /tx endpoint with valid data:"
curl -X POST http://localhost:8787/tx \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -d '{
        "chainId": 11155111,
        "safe": "0x1280C3d641ad0517918e0E4C41F4AD25f6b39144",
        "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA49",
        "value": "0",
        "data": "0x",
        "operation": 0,
        "gasToken": "0x0000000000000000000000000000000000000000",
        "safeTxGas": 0,
        "baseGas": 0,
        "gasPrice": "0",
        "refundReceiver": "0x0000000000000000000000000000000000000000",
        "nonce": 1,
        "executionDate": "2024-01-01T00:00:00Z",
        "submissionDate": "2024-01-01T00:00:00Z",
        "modified": "2024-01-01T00:00:00Z",
        "blockNumber": 1000000,
        "transactionHash": "0x123",
        "safeTxHash": "0x20e178f2ce590c235d30a6e99a78e799053f36bafe2d2022a642be03cb89058c",
        "proposer": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA49",
        "executor": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA49",
        "isExecuted": true,
        "isSuccessful": true,
        "ethGasPrice": "1000000000",
        "maxFeePerGas": "2000000000",
        "maxPriorityFeePerGas": "1000000000",
        "gasUsed": 21000,
        "fee": "21000000000000",
        "origin": "https://app.safe.global",
        "dataDecoded": null,
        "confirmationsRequired": 1,
        "confirmations": [],
        "trusted": true,
        "signatures": "0x"
    }' \
    -w "\nStatus: %{http_code}\n"

echo ""

# Test 3: Sampled endpoint
echo "3. Testing /sampled endpoint (may be skipped based on SAMPLE_RATE):"
curl -X POST http://localhost:8787/sampled \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -d '{
        "type": "EXECUTED_MULTISIG_TRANSACTION",
        "chainId": "1",
        "address": "0x1280C3d641ad0517918e0E4C41F4AD25f6b39144",
        "safeTxHash": "0x20e178f2ce590c235d30a6e99a78e799053f36bafe2d2022a642be03cb89058c"
    }' \
    -w "\nStatus: %{http_code}\n"

echo ""
echo "All endpoints should return status 202 (Accepted)"