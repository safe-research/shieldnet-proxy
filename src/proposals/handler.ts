import type { Context } from "hono";
import { createWalletClient, extractChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { supportedChains } from "../config/chains.js";
import { configSchema } from "../config/schemas.js";
import type { Config } from "../config/types.js";
import { type TransactionProposedEvent, transactionProposedEventSchema } from "../safe/schemas.js";
import { transactionDetails } from "../safe/service.js";
import { handleError } from "../utils/errors.js";

export const handleProposal = async (c: Context, sampled = false) => {
	try {
		const config = configSchema.parse(c.env);
		if (sampled && config.SAMPLE_RATE >= Math.random() * 100) {
			return c.body(null, 202);
		}

		const request = transactionProposedEventSchema.safeParse(await c.req.json());
		if (!request.success) {
			return c.body(null, 202);
		}

		c.executionCtx.waitUntil(processProposal(config, request.data, sampled));

		return c.body(null, 202);
	} catch (e: unknown) {
		const { response, code } = handleError(e);
		return c.json(response, code);
	}
};

const processProposal = async (config: Config, event: TransactionProposedEvent, _sampled: boolean) => {
	try {
		const details = await transactionDetails(event.chainId, event.safeTxHash);
		if (details === null) {
			return;
		}

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
			abi: parseAbi([
				"function proposeTransaction((uint256 chainId, address account, address to, uint256 value, uint8 operation, bytes data, uint256 nonce) transaction) external",
			]),
			functionName: "proposeTransaction",
			args: [
				{
					account: details.safe,
					...details,
				},
			],
		});
		console.info(`Transaction submitted: ${transactionHash}`);
	} catch (e) {
		console.error(e);
	}
};
