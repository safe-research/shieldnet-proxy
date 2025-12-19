import type { Context } from "hono";
import { createWalletClient, extractChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { supportedChains } from "../config/chains.js";
import { configSchema } from "../config/schemas.js";
import { transactionProposedEventSchema } from "../safe/schemas.js";
import { transactionDetails } from "../safe/service.js";
import { handleError } from "../utils/errors.js";

export const handleProposal = async (c: Context, sampled = false) => {
	try {
		const config = configSchema.parse(c.env);
		if (sampled && config.SAMPLE_RATE >= Math.random() * 100) {
			return c.body(null, 201);
		}
		const request = transactionProposedEventSchema.safeParse(await c.req.json());
		if (!request.success) {
			return c.body(null, 201);
		}

		const details = await transactionDetails(request.data.chainId, request.data.safeTxHash);
		if (details === null) {
			return c.body(null, 201);
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

		return c.json({ transactionHash }, 200);
	} catch (e) {
		const { response, code } = handleError(e);
		return c.json(response, code);
	}
};
