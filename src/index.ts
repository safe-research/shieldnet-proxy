import { Hono } from "hono";
import { cors } from "hono/cors";
import { createWalletClient, extractChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { supportedChains } from "./config/chains.js";
import { configSchema } from "./config/schemas.js";
import { transactionProposedEventSchema } from "./safe/schemas.js";
import { transactionDetails } from "./safe/service.js";
import { handleError } from "./utils/errors.js";

type Bindings = {
	PRIVATE_KEY: string;
	RPC_URL: string;
	CONSENSUS_ADDRESS: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/*", cors());

app.post("/propose", async (c) => {
	try {
		const config = configSchema.parse(c.env);
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
});

export default app;
