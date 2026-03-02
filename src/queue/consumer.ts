import { configSchema } from "../config/schemas.js";
import type { Config } from "../config/types.js";
import { processProposal, submitTransaction } from "../proposals/handler.js";
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

	// Process messages in parallel, but collect results
	const results = await Promise.allSettled(
		batch.messages.map(async (message: Message<QueueMessage>) => {
			try {
				const parsedMessage = queueMessageSchema.parse(message.body);
				await processMessage(config, parsedMessage);
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

async function processMessage(config: Config, message: QueueMessage): Promise<void> {
	switch (message.type) {
		case "PROPOSAL":
			await processProposal(config, message.data);
			break;
		case "TRANSACTION":
			await submitTransaction(config, message.data);
			break;
		default: {
			// This should never happen due to discriminated union
			const _exhaustiveCheck: never = message;
			throw new Error("Unknown message type");
		}
	}
}
