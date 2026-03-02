import type { TransactionExecutedEvent } from "../safe/schemas.js";
import type { SafeTransactionWithDomain } from "../safe/types.js";

export type QueueMessageType = "PROPOSAL" | "TRANSACTION";

export interface BaseQueueMessage {
	type: QueueMessageType;
	sampled: boolean;
	timestamp: number;
}

export interface ProposalQueueMessage extends BaseQueueMessage {
	type: "PROPOSAL";
	data: TransactionExecutedEvent;
}

export interface TransactionQueueMessage extends BaseQueueMessage {
	type: "TRANSACTION";
	data: SafeTransactionWithDomain;
}

export type QueueMessage = ProposalQueueMessage | TransactionQueueMessage;
