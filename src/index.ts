import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleProposal } from "./proposals/handler.js";

type Bindings = {
	PRIVATE_KEY: string;
	RPC_URL: string;
	CONSENSUS_ADDRESS: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/*", cors());

app.post("/propose", async (c) => {
	return handleProposal(c);
});

app.post("/sampled", async (c) => {
	return handleProposal(c, true);
});

export default app;
