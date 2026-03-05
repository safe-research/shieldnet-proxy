import {
	type Address,
	BaseError,
	createPublicClient,
	createWalletClient,
	encodeFunctionData,
	extractChain,
	type Hex,
	http,
	size,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { supportedChains } from "../config/chains.js";
import { configSchema } from "../config/schemas.js";
import type { SafeTransactionWithDomain } from "../safe/types.js";
import { CONSENSUS_FUNCTIONS } from "../utils/abis.js";
import { queueMessageSchema } from "./schemas.js";
import type { QueueMessage } from "./types.js";

interface QueueEnv {
	PRIVATE_KEY: string;
	RPC_URLS: string;
	CONSENSUS_ADDRESSES: string;
	CHAIN_IDS?: string;
	SAMPLE_RATE?: string;
}

interface ChainContext {
	chainId: number;
	chain: ReturnType<typeof extractChain>;
	account: ReturnType<typeof privateKeyToAccount>;
	walletClient: ReturnType<typeof createWalletClient>;
	consensusAddress: Address;
	bufferedMaxFeePerGas: bigint;
	maxPriorityFeePerGas: bigint;
	baseNonce: number;
}

export async function handleQueueBatch(batch: MessageBatch<QueueMessage>, env: QueueEnv): Promise<void> {
	const config = configSchema.parse(env);
	const account = privateKeyToAccount(config.PRIVATE_KEY);

	// Initialize per-chain clients and fetch fee/nonce data once per chain per batch
	const chainContexts = await Promise.all(
		config.CHAIN_IDS.map(async (chainId): Promise<ChainContext> => {
			const chain = extractChain({ chains: supportedChains, id: chainId });
			const rpcUrl = config.RPC_URLS[String(chainId)];
			const walletClient = createWalletClient({ chain, account, transport: http(rpcUrl) });
			const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

			// Fetch EIP-1559 fee data once per chain for the entire batch to avoid N redundant RPC calls
			const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas();

			// Fetch the current nonce once and manually increment per transaction.
			// Note: this could theoretically cause skipped transactions if a concurrent sender
			// submits between our getTransactionCount call and our sends, but it is less prone
			// to getting stuck than viem's nonceManager since there is currently no retry logic.
			const baseNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "latest" });

			return {
				chainId,
				chain,
				account,
				walletClient,
				consensusAddress: config.CONSENSUS_ADDRESSES[String(chainId)],
				// Double maxFeePerGas to guard against price movement during batch processing
				bufferedMaxFeePerGas: maxFeePerGas * 2n,
				maxPriorityFeePerGas,
				baseNonce,
			};
		}),
	);

	const results = await Promise.allSettled(
		batch.messages.map(async (message: Message<QueueMessage>, index: number) => {
			try {
				const parsedMessage = queueMessageSchema.parse(message.body);

				// Submit to all configured chains in parallel
				const chainResults = await Promise.allSettled(
					chainContexts.map((ctx) =>
						submitTransaction(
							ctx.walletClient,
							ctx.chain,
							ctx.account,
							ctx.consensusAddress,
							parsedMessage.data,
							ctx.bufferedMaxFeePerGas,
							ctx.maxPriorityFeePerGas,
							ctx.baseNonce + index,
							ctx.chainId,
						),
					),
				);

				for (const [i, result] of chainResults.entries()) {
					if (result.status === "rejected") {
						const errorMessage =
							result.reason instanceof BaseError ? result.reason.shortMessage : String(result.reason);
						console.error(
							`Error submitting message ${message.id} to chain ${chainContexts[i].chainId}: ${errorMessage}`,
						);
					}
				}

				// Acknowledge after attempting all chains
				message.ack();
			} catch (error) {
				// Log error but don't retry (as per requirements)
				const errorMessage = error instanceof BaseError ? error.shortMessage : String(error);
				console.error(`Error processing message ${message.id}: ${errorMessage}`);
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
	consensusAddress: Address,
	details: SafeTransactionWithDomain,
	maxFeePerGas: bigint,
	maxPriorityFeePerGas: bigint,
	nonce: number,
	chainId: number,
): Promise<void> {
	const { data, gas } = encodeTransaction(details);
	const transactionHash = await client.sendTransaction({
		chain,
		account,
		to: consensusAddress,
		data,
		gas,
		maxFeePerGas,
		maxPriorityFeePerGas,
		nonce,
	});
	console.info(`Transaction submitted to chain ${chainId}: ${transactionHash} (nonce: ${nonce})`);
}
