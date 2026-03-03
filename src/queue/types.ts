import type z from "zod";
import type { queueMessageSchema } from "./schemas.js";

export type QueueMessage = z.output<typeof queueMessageSchema>;
