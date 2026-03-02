import { z } from "zod";
import { serviceSafeTransactionWithChainIdSchema, transactionExecutedEventSchema } from "../safe/schemas.js";

export const baseQueueMessageSchema = z.object({
	type: z.enum(["PROPOSAL", "TRANSACTION"]),
	sampled: z.boolean(),
	timestamp: z.number(),
});

export const proposalQueueMessageSchema = baseQueueMessageSchema.extend({
	type: z.literal("PROPOSAL"),
	data: transactionExecutedEventSchema,
});

export const transactionQueueMessageSchema = baseQueueMessageSchema.extend({
	type: z.literal("TRANSACTION"),
	data: serviceSafeTransactionWithChainIdSchema,
});

export const queueMessageSchema = z.discriminatedUnion("type", [
	proposalQueueMessageSchema,
	transactionQueueMessageSchema,
]);
