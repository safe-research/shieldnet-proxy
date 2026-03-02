import { type Chain, createWalletClient, extractChain, http } from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
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
	const account = privateKeyToAccount(config.PRIVATE_KEY);
	const client = createWalletClient({
		chain,
		account,
		transport: http(config.RPC_URL),
	});

	// Process messages in parallel, but collect results
	const results = await Promise.allSettled(
		batch.messages.map(async (message: Message<QueueMessage>) => {
			try {
				const parsedMessage = queueMessageSchema.parse(message.body);
				await submitTransaction(client, chain, account, config, parsedMessage.data);
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

async function submitTransaction(
	client: ReturnType<typeof createWalletClient>,
	chain: Chain,
	account: PrivateKeyAccount,
	config: Config,
	details: SafeTransactionWithDomain,
): Promise<void> {
	const transactionHash = await client.writeContract({
		chain,
		account,
		address: config.CONSENSUS_ADDRESS,
		abi: CONSENSUS_FUNCTIONS,
		functionName: "proposeTransaction",
		args: [
			{
				...details,
			},
		],
	});
	console.info(`Transaction submitted: ${transactionHash}`);
}
