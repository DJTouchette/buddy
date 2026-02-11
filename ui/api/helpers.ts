/**
 * API route handler utilities for consistent error handling and response formatting.
 */

type HandlerFn = (req: Request) => Promise<Response> | Response;

/**
 * Wraps a route handler with consistent error handling.
 * Catches any thrown errors and returns a 500 JSON response.
 */
export function handler(fn: HandlerFn): HandlerFn {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (error) {
      return errorResponse(String(error));
    }
  };
}

/**
 * Create a JSON error response.
 */
export function errorResponse(message: string, status = 500): Response {
  return Response.json({ error: message }, { status });
}
