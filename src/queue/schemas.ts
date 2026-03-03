import { z } from "zod";
import { safeTransactionWithDomain } from "../safe/schemas.js";

export const queueMessageSchema = z.object({
	type: z.literal("TRANSACTION"),
	timestamp: z.number(),
	data: safeTransactionWithDomain,
});
