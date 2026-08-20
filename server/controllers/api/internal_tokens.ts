/**
 * /api/internal/tokens — issuing and revoking the registry's API tokens.
 *
 * Only reachable with a DPoP session: a token can mint nothing, so possessing
 * one never lets a caller widen its own access. The plaintext appears in the
 * response to the POST that created it and nowhere else, which is why the
 * dashboard makes a point of showing it once.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { issueToken, listTokens, revokeToken } from "../../db/api_tokens.ts";
import { authenticateSession } from "../../lib/auth.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

const MAX_NAME = 100;

export const internalTokensAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    return apiJson({ tokens: await listTokens(requireDb(), auth.user.id) });
  },
} satisfies Action<typeof routes.internalTokens>;

export const internalTokensCreateAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    let name: unknown;
    try {
      ({ name } = await context.request.json() as { name?: unknown });
    } catch {
      return apiError("Body must be JSON", 400);
    }
    if (typeof name !== "string" || !name.trim()) {
      return apiError("name is required", 400);
    }
    if (name.length > MAX_NAME) {
      return apiError(`name must be at most ${MAX_NAME} characters`, 400);
    }

    const issued = await issueToken(requireDb(), auth.user.id, name.trim());
    return apiJson(issued, { status: 201 });
  },
} satisfies Action<typeof routes.internalTokensCreate>;

export const internalTokensDeleteAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const id = Number(context.params.id);
    if (!Number.isInteger(id)) return apiError("Unknown token", 404);

    const revoked = await revokeToken(requireDb(), auth.user.id, id);
    if (!revoked) return apiError("Unknown token", 404);
    return apiJson({ revoked: true });
  },
} satisfies Action<typeof routes.internalTokensDelete>;
