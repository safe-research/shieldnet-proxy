import z from "zod";
import { checkedAddressSchema, hexDataSchema } from "../utils/schemas.js";
import { supportedChains } from "./chains.js";

export const supportedChainsSchema = z.coerce
	.number()
	.pipe(z.union(supportedChains.map((chain) => z.literal(chain.id))));

// Public fields stored in wrangler.jsonc vars (no secrets).
const publicNetworkConfigSchema = z.object({
	chainId: supportedChainsSchema,
	consensusAddress: checkedAddressSchema,
});

// Full per-network config after merging public fields with per-network secrets.
export const networkConfigSchema = publicNetworkConfigSchema.extend({
	rpcUrl: z.url(),
	privateKey: hexDataSchema,
});

// NETWORKS env var: JSON array of public network configs.
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
	.pipe(z.array(publicNetworkConfigSchema).min(1));

export const configSchema = z.object({
	NETWORKS: networksSchema,
	SAMPLE_RATE: z.coerce.number().default(10),
});
