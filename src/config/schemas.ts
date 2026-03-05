import z from "zod";
import { checkedAddressSchema, hexDataSchema } from "../utils/schemas.js";
import { supportedChains } from "./chains.js";

export const supportedChainsSchema = z.coerce
	.number()
	.pipe(z.union(supportedChains.map((chain) => z.literal(chain.id))));

const jsonStringToRecord = <V extends z.ZodTypeAny>(valueSchema: V) =>
	z
		.string()
		.transform((s, ctx) => {
			try {
				return JSON.parse(s) as unknown;
			} catch {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid JSON string" });
				return z.NEVER;
			}
		})
		.pipe(z.record(z.string(), valueSchema));

export const configSchema = z
	.object({
		PRIVATE_KEY: hexDataSchema,
		RPC_URLS: jsonStringToRecord(z.url()),
		CONSENSUS_ADDRESSES: jsonStringToRecord(checkedAddressSchema),
		CHAIN_IDS: z
			.string()
			.default("11155111")
			.transform((s, ctx) => {
				const results: Array<(typeof supportedChains)[number]["id"]> = [];
				for (const raw of s.split(",")) {
					const result = supportedChainsSchema.safeParse(raw.trim());
					if (!result.success) {
						ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unsupported chain ID: ${raw.trim()}` });
						return z.NEVER;
					}
					results.push(result.data);
				}
				return results;
			}),
		SAMPLE_RATE: z.coerce.number().default(10),
	})
	.superRefine((config, ctx) => {
		for (const id of config.CHAIN_IDS) {
			if (config.RPC_URLS[String(id)] === undefined) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: `RPC_URLS missing entry for chain ${id}` });
			}
			if (config.CONSENSUS_ADDRESSES[String(id)] === undefined) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `CONSENSUS_ADDRESSES missing entry for chain ${id}`,
				});
			}
		}
	});
