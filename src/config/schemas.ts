import z from "zod";
import { checkedAddressSchema, hexDataSchema } from "../utils/schemas.js";
import { supportedChains } from "./chains.js";

export const supportedChainsSchema = z.coerce
	.number()
	.pipe(z.union(supportedChains.map((chain) => z.literal(chain.id))));

export const networkConfigSchema = z.object({
	chainId: supportedChainsSchema,
	rpcUrl: z.url(),
	consensusAddress: checkedAddressSchema,
	privateKey: hexDataSchema,
});

const networksSchema = z
	.string()
	.transform((s, ctx) => {
		try {
			return JSON.parse(s);
		} catch {
			ctx.addIssue({ code: "custom", message: "NETWORKS must be a valid JSON array" });
			return z.NEVER;
		}
	})
	.pipe(z.array(networkConfigSchema).min(1));

export const configSchema = z.object({
	NETWORKS: networksSchema,
	SAMPLE_RATE: z.coerce.number().default(10),
});
