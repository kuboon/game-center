/**
 * POST /api/internal/handle — choose the name manifests will use.
 *
 * A player picks this once. It goes into `gamecenter.json` files the hub does
 * not control and into author pages people link to, so renaming would silently
 * break every game whose `author` still said the old one.
 */

import type { Action } from "@remix-run/fetch-router";
import { HANDLE_PATTERN } from "@game-center/protocol";

import { requireDb } from "../../db/client.ts";
import { claimHandle, HandleError } from "../../db/users.ts";
import { authenticateSession } from "../../lib/auth.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

export const internalHandleAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    let handle: unknown;
    try {
      ({ handle } = await context.request.json() as { handle?: unknown });
    } catch {
      return apiError("Body must be JSON", 400);
    }
    if (typeof handle !== "string" || !handle) {
      return apiError("handle is required", 400);
    }
    if (!HANDLE_PATTERN.test(handle.toLowerCase())) {
      return apiError(
        "A handle is 3-32 characters of lowercase letters, digits, and hyphens",
        400,
      );
    }

    try {
      const user = await claimHandle(requireDb(), auth.user.id, handle);
      return apiJson({ handle: user.handle });
    } catch (error) {
      if (error instanceof HandleError) return apiError(error.message, 409);
      throw error;
    }
  },
} satisfies Action<typeof routes.internalHandle>;
