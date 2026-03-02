import type z from "zod";
import type { configSchema, networkConfigSchema } from "./schemas.js";

export type Config = z.infer<typeof configSchema>;
export type NetworkConfig = z.infer<typeof networkConfigSchema>;
