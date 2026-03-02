import { z } from "zod";
import { serviceSafeTransactionWithChainIdSchema } from "../safe/schemas.js";

export const transactionQueueMessageSchema = z.object({
	type: z.literal("TRANSACTION"),
	timestamp: z.number(),
	data: serviceSafeTransactionWithChainIdSchema,
});

export const queueMessageSchema = transactionQueueMessageSchema;
