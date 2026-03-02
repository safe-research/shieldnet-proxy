import type { SafeTransactionWithDomain } from "../safe/types.js";

export interface TransactionQueueMessage {
	type: "TRANSACTION";
	timestamp: number;
	data: SafeTransactionWithDomain;
}

export type QueueMessage = TransactionQueueMessage;
