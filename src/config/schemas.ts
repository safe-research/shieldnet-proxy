import z from "zod";
import { checkedAddressSchema, hexDataSchema } from "../utils/schemas.js";
import { supportedChains } from "./chains.js";

export const supportedChainsSchema = z.coerce
	.number()
	.pipe(z.union(supportedChains.map((chain) => z.literal(chain.id))));

export const configSchema = z.object({
	PRIVATE_KEY: hexDataSchema,
	RPC_URL: z.url(),
	CONSENSUS_ADDRESS: checkedAddressSchema,
	CHAIN_ID: supportedChainsSchema.default(11155111),
});
