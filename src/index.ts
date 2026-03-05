import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleProposal, handleTx } from "./proposals/handler.js";
import { handleQueueBatch } from "./queue/consumer.js";
import type { QueueMessage } from "./queue/types.js";

interface Bindings {
	PRIVATE_KEY: string;
	RPC_URLS: string;
	CONSENSUS_ADDRESSES: string;
	PROPOSAL_QUEUE: Queue<QueueMessage>;
	CHAIN_IDS?: string;
	SAMPLE_RATE?: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.use("/*", cors());

app.post("/tx", async (c) => {
	return handleTx(c);
});

app.post("/propose", async (c) => {
	return handleProposal(c);
});

app.post("/sampled", async (c) => {
	return handleProposal(c, true);
});

export default {
	fetch: app.fetch,
	queue: handleQueueBatch,
} satisfies ExportedHandler<Bindings, QueueMessage>;
