import type { Context } from "hono";
import { configSchema } from "../config/schemas.js";
import type { TransactionQueueMessage } from "../queue/types.js";
import {
	serviceSafeTransactionWithChainIdSchema,
	transactionExecutedEventSchema,
	type TransactionExecutedEvent,
} from "../safe/schemas.js";
import { transactionDetails } from "../safe/service.js";
import { handleError } from "../utils/errors.js";

export const handleProposal = async (
	c: Context<{
		Bindings: {
			PROPOSAL_QUEUE: Queue;
			PRIVATE_KEY: string;
			RPC_URL: string;
			CONSENSUS_ADDRESS: string;
			CHAIN_ID?: string;
			SAMPLE_RATE?: string;
		};
	}>,
	sampled = false,
) => {
	try {
		const config = configSchema.parse(c.env);
		if (sampled && config.SAMPLE_RATE >= Math.random() * 100) {
			return c.body(null, 202);
		}

		const request = transactionExecutedEventSchema.safeParse(await c.req.json());
		if (!request.success) {
			return c.body(null, 202);
		}

		// Fetch transaction details synchronously
		c.executionCtx.waitUntil(
			processProposalAsync(c.env.PROPOSAL_QUEUE, request.data),
		);

		return c.body(null, 202);
	} catch (e: unknown) {
		const { response, code } = handleError(e);
		return c.json(response, code);
	}
};

export const handleTx = async (
	c: Context<{
		Bindings: {
			PROPOSAL_QUEUE: Queue;
			PRIVATE_KEY: string;
			RPC_URL: string;
			CONSENSUS_ADDRESS: string;
			CHAIN_ID?: string;
			SAMPLE_RATE?: string;
		};
	}>,
	sampled = false,
) => {
	try {
		const config = configSchema.parse(c.env);
		if (sampled && config.SAMPLE_RATE >= Math.random() * 100) {
			return c.body(null, 202);
		}

		const request = serviceSafeTransactionWithChainIdSchema.safeParse(await c.req.json());
		if (!request.success) {
			return c.body(null, 202);
		}

		const message: TransactionQueueMessage = {
			type: "TRANSACTION",
			timestamp: Date.now(),
			data: request.data,
		};

		await c.env.PROPOSAL_QUEUE.send(message);

		return c.body(null, 202);
	} catch (e: unknown) {
		const { response, code } = handleError(e);
		return c.json(response, code);
	}
};

async function processProposalAsync(
	queue: Queue<TransactionQueueMessage>,
	event: TransactionExecutedEvent,
): Promise<void> {
	try {
		const details = await transactionDetails(event.chainId, event.safeTxHash);
		if (details === null) {
			console.error(`Transaction details not found for ${event.safeTxHash}`);
			return;
		}

		// Queue the transaction
		const message: TransactionQueueMessage = {
			type: "TRANSACTION",
			timestamp: Date.now(),
			data: details,
		};

		await queue.send(message);
	} catch (error) {
		console.error("Error processing proposal:", error);
	}
}