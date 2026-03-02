import type { Context } from "hono";
import { createWalletClient, extractChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { supportedChains } from "../config/chains.js";
import { configSchema } from "../config/schemas.js";
import type { Config } from "../config/types.js";
import type { ProposalQueueMessage, TransactionQueueMessage } from "../queue/types.js";
import {
	serviceSafeTransactionWithChainIdSchema,
	type TransactionExecutedEvent,
	transactionExecutedEventSchema,
} from "../safe/schemas.js";
import { transactionDetails } from "../safe/service.js";
import type { SafeTransactionWithDomain } from "../safe/types.js";
import { CONSENSUS_FUNCTIONS } from "../utils/abis.js";
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

		const message: ProposalQueueMessage = {
			type: "PROPOSAL",
			sampled,
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

export const processProposal = async (config: Config, event: TransactionExecutedEvent) => {
	const details = await transactionDetails(event.chainId, event.safeTxHash);
	if (details === null) {
		throw new Error(`Transaction details not found for ${event.safeTxHash}`);
	}
	await submitTransaction(config, details);
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
			sampled,
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

export const submitTransaction = async (config: Config, details: SafeTransactionWithDomain) => {
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

	const transactionHash = await client.writeContract({
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
};
