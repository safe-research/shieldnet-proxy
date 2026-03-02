import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleProposal, handleTx } from "./proposals/handler.js";

type Bindings = {
	NETWORKS: string;
	NETWORK_SECRETS: string;
};

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

export default app;
