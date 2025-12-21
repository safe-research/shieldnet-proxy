import type { Hex } from "viem";
import { serviceSafeTransactionSchema } from "./schemas.js";
import type { SafeTransactionWithDomain } from "./types.js";

const SHORT_NAMES: Record<string, string> = {
	"1": "eth",
	"100": "gno",
};

export const transactionDetails = async (
	chainId: bigint,
	safeTxHash: Hex,
): Promise<SafeTransactionWithDomain | null> => {
	const shortName = SHORT_NAMES[chainId.toString()];
	if (shortName === undefined) return null;
	const response = await fetch(
		`https://api.safe.global/tx-service/${shortName}/api/v2/multisig-transactions/${safeTxHash}/`,
	);
	const parsed = serviceSafeTransactionSchema.safeParse(await response.json());
	if (!parsed.success) return null;
	return {
		chainId,
		...parsed.data,
	};
};
