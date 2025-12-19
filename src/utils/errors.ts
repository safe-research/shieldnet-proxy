import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

export const handleError = (error: unknown) => {
	if (error instanceof ZodError) {
		return {
			response: {
				success: false,
				message: "Validation failed",
				issues: error.issues,
			},
			code: 400 as ContentfulStatusCode,
		};
	}
	if (error instanceof Error) {
		return {
			response: {
				success: false,
				message: error.message,
			},
			code: 500 as ContentfulStatusCode,
		};
	}
	return {
		response: {
			success: false,
			message: "Unknown error",
		},
		code: 500 as ContentfulStatusCode,
	};
};
