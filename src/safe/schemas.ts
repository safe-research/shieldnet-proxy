import z from "zod";
import { bigintStringSchema, checkedAddressSchema, hexDataSchema } from "../utils/schemas.js";

export const safeTransactionSchema = z.object({
	to: checkedAddressSchema,
	value: bigintStringSchema,
	data: z.preprocess((v) => (typeof v !== "string" || v === "" ? "0x" : v), hexDataSchema),
	operation: z.union([z.literal(0), z.literal(1)]),
	safeTxGas: bigintStringSchema,
	baseGas: bigintStringSchema,
	gasPrice: bigintStringSchema,
	gasToken: checkedAddressSchema,
	refundReceiver: checkedAddressSchema,
	nonce: bigintStringSchema,
});

export const safeEventSchema = z.object({
	address: checkedAddressSchema,
	chainId: bigintStringSchema,
});

export const transactionProposedEventSchema = safeEventSchema.extend({
	type: z.literal("PENDING_MULTISIG_TRANSACTION"),
	safeTxHash: hexDataSchema,
});
