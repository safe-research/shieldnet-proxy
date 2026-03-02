import z from "zod";
import { checkedAddressSchema, hexDataSchema } from "../utils/schemas.js";
import { supportedChains } from "./chains.js";

export const supportedChainsSchema = z.coerce
	.number()
	.pipe(z.union(supportedChains.map((chain) => z.literal(chain.id))));

const parseJson = (label: string) => (s: string, ctx: z.RefinementCtx) => {
	try {
		return JSON.parse(s);
	} catch {
		ctx.addIssue({ code: "custom", message: `${label} must be valid JSON` });
		return z.NEVER;
	}
};

// Public per-network config stored in wrangler.jsonc vars, keyed by chainId.
const publicNetworkConfigSchema = z.object({
	consensusAddress: checkedAddressSchema,
});

// Secret per-network config stored as a single Cloudflare secret, keyed by chainId.
const privateNetworkConfigSchema = z.object({
	rpcUrl: z.url(),
	privateKey: hexDataSchema,
});

// Full per-network config after merging the two.
export const networkConfigSchema = z.object({
	chainId: supportedChainsSchema,
	consensusAddress: checkedAddressSchema,
	rpcUrl: z.url(),
	privateKey: hexDataSchema,
});

// NETWORKS var: JSON object keyed by chainId string -> public config.
// Example: {"11155111":{"consensusAddress":"0x..."},"100":{"consensusAddress":"0x..."}}
const networksSchema = z
	.string()
	.transform(parseJson("NETWORKS"))
	.pipe(
		z
			.record(z.string(), publicNetworkConfigSchema)
			.refine((r) => Object.keys(r).length > 0, "NETWORKS must not be empty"),
	);

// NETWORK_SECRETS secret: JSON object keyed by chainId string -> secret config.
// Example: {"11155111":{"rpcUrl":"https://...","privateKey":"0x..."},"100":{...}}
const networkSecretsSchema = z
	.string()
	.transform(parseJson("NETWORK_SECRETS"))
	.pipe(z.record(z.string(), privateNetworkConfigSchema));

export const configSchema = z.object({
	NETWORKS: networksSchema,
	NETWORK_SECRETS: networkSecretsSchema,
	SAMPLE_RATE: z.coerce.number().default(10),
});
