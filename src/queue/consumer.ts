import { type Hex, createPublicClient, createWalletClient, encodeFunctionData, extractChain, http, nonceManager, size } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { supportedChains } from "../config/chains.js";
import { configSchema } from "../config/schemas.js";
import type { Config } from "../config/types.js";
import type { SafeTransactionWithDomain } from "../safe/types.js";
import { CONSENSUS_FUNCTIONS } from "../utils/abis.js";
import { queueMessageSchema } from "./schemas.js";
import type { QueueMessage } from "./types.js";

interface QueueEnv {
	PRIVATE_KEY: string;
	RPC_URL: string;
	CONSENSUS_ADDRESS: string;
	CHAIN_ID?: string;
	SAMPLE_RATE?: string;
}

export async function handleQueueBatch(batch: MessageBatch<QueueMessage>, env: QueueEnv): Promise<void> {
	const config = configSchema.parse(env);

	// Initialize chain, account, and client once for the entire batch
	const chain = extractChain({
		chains: supportedChains,
		id: config.CHAIN_ID,
	});
	// Attach viem's built-in nonce manager to prevent nonce conflicts
	const account = privateKeyToAccount(config.PRIVATE_KEY, {
		nonceManager,
	});
	const client = createWalletClient({
		chain,
		account,
		transport: http(config.RPC_URL),
	});
	const publicClient = createPublicClient({
		chain,
		transport: http(config.RPC_URL),
	});

	// Fetch EIP-1559 fee data once for the entire batch to avoid N redundant RPC calls
	const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas();
	// Add 10% buffer to maxFeePerGas to guard against price movement during batch processing
	const bufferedMaxFeePerGas = (maxFeePerGas * 110n) / 100n;

	// Process messages in parallel with automatic nonce management
	const results = await Promise.allSettled(
		batch.messages.map(async (message: Message<QueueMessage>) => {
			try {
				const parsedMessage = queueMessageSchema.parse(message.body);
				await submitTransaction(client, chain, account, config, parsedMessage.data, bufferedMaxFeePerGas, maxPriorityFeePerGas);
				// Acknowledge successful processing
				message.ack();
			} catch (error) {
				// Log error but don't retry (as per requirements)
				console.error(`Error processing message ${message.id}:`, error);
				// Still acknowledge to prevent retry
				message.ack();
			}
		}),
	);

	// Log batch processing summary
	const successful = results.filter((r) => r.status === "fulfilled").length;
	const failed = results.filter((r) => r.status === "rejected").length;
	console.info(`Batch processed: ${successful} successful, ${failed} failed out of ${batch.messages.length} messages`);
}

function encodeTransaction(details: SafeTransactionWithDomain): { data: Hex; gas: bigint } {
	const data = encodeFunctionData({
		abi: CONSENSUS_FUNCTIONS,
		functionName: "proposeTransaction",
		args: [details],
	});
	// Base formula: 60,000 base + 25 gas/byte, with 20% safety buffer.
	// 25 gas/byte = 16 (non-zero calldata, post-Berlin) + 8 (ExecutionSuccess event) + 1 (overhead)
	const estimated = 60_000n + BigInt(size(data)) * 25n;
	return { data, gas: (estimated * 120n) / 100n };
}

async function submitTransaction(
	client: ReturnType<typeof createWalletClient>,
	chain: ReturnType<typeof extractChain>,
	account: ReturnType<typeof privateKeyToAccount>,
	config: Config,
	details: SafeTransactionWithDomain,
	maxFeePerGas: bigint,
	maxPriorityFeePerGas: bigint,
): Promise<void> {
	const { data, gas } = encodeTransaction(details);
	const transactionHash = await client.sendTransaction({
		chain,
		account,
		to: config.CONSENSUS_ADDRESS,
		data,
		gas,
		maxFeePerGas,
		maxPriorityFeePerGas,
	});
	console.info(`Transaction submitted: ${transactionHash}`);
}
