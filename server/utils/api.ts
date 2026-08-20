/**
 * Shared response shape for the JSON surfaces.
 *
 * Everything under `/api` answers with `cache-control: no-store`: these
 * responses are per-player or per-token, and a shared cache holding on to one
 * would hand it to the wrong caller.
 */

/** A JSON response that no cache may keep. */
export function apiJson(body: unknown, init?: ResponseInit): Response {
  const response = Response.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

/** An error body in the one shape every API surface uses. */
export function apiError(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return apiJson({ error: message, ...extra }, { status });
}
