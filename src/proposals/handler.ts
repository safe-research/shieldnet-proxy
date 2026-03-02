import type { Context } from "hono";
import { createWalletClient, extractChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { supportedChains } from "../config/chains.js";
import { configSchema } from "../config/schemas.js";
import type { Config, NetworkConfig } from "../config/types.js";
import {
	serviceSafeTransactionWithChainIdSchema,
	type TransactionExecutedEvent,
	transactionExecutedEventSchema,
} from "../safe/schemas.js";
import { transactionDetails } from "../safe/service.js";
import type { SafeTransactionWithDomain } from "../safe/types.js";
import { CONSENSUS_FUNCTIONS } from "../utils/abis.js";
import { handleError } from "../utils/errors.js";

export const handleProposal = async (c: Context, sampled = false) => {
	try {
		const config = configSchema.parse(c.env);
		if (sampled && config.SAMPLE_RATE >= Math.random() * 100) {
			return c.body(null, 202);
		}

		const request = transactionExecutedEventSchema.safeParse(await c.req.json());
		if (!request.success) {
			return c.body(null, 202);
		}

		c.executionCtx.waitUntil(processProposal(config, request.data));

		return c.body(null, 202);
	} catch (e: unknown) {
		const { response, code } = handleError(e);
		return c.json(response, code);
	}
};

const processProposal = async (config: Config, event: TransactionExecutedEvent) => {
	try {
		const details = await transactionDetails(event.chainId, event.safeTxHash);
		if (details === null) {
			return;
		}
		await submitToAllNetworks(config, details);
	} catch (e) {
		console.error(e);
	}
};

export const handleTx = async (c: Context, sampled = false) => {
	try {
		const config = configSchema.parse(c.env);
		if (sampled && config.SAMPLE_RATE >= Math.random() * 100) {
			return c.body(null, 202);
		}

		const request = serviceSafeTransactionWithChainIdSchema.safeParse(await c.req.json());
		if (!request.success) {
			return c.body(null, 202);
		}

		await submitToAllNetworks(config, request.data);

		return c.body(null, 202);
	} catch (e: unknown) {
		const { response, code } = handleError(e);
		return c.json(response, code);
	}
};

const submitToAllNetworks = async (config: Config, details: SafeTransactionWithDomain) => {
	const results = await Promise.allSettled(config.NETWORKS.map((network) => submitTransaction(network, details)));
	for (const [i, result] of results.entries()) {
		if (result.status === "rejected") {
			console.error(`Failed to submit to chain ${config.NETWORKS[i]?.chainId}:`, result.reason);
		}
	}
};

const submitTransaction = async (network: NetworkConfig, details: SafeTransactionWithDomain) => {
	const chain = extractChain({
		chains: supportedChains,
		id: network.chainId,
	});
	const account = privateKeyToAccount(network.privateKey);
	const client = createWalletClient({
		chain,
		account,
		transport: http(network.rpcUrl),
	});

	const transactionHash = await client.writeContract({
		address: network.consensusAddress,
		abi: CONSENSUS_FUNCTIONS,
		functionName: "proposeTransaction",
		args: [
			{
				...details,
			},
		],
	});
	console.info(`Transaction submitted to chain ${network.chainId}: ${transactionHash}`);
};
