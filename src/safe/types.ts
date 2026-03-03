import type z from "zod";
import type { safeTransactionWithDomain } from "./schemas.js";

export type SafeTransactionWithDomain = z.infer<typeof safeTransactionWithDomain>;
