/**
 * GET /api/internal/games/@{handle}/{slug}/peers — the viewer's records in one
 * game, next to the records of the people they follow.
 *
 * The game page itself is server-rendered and reads the same for everybody.
 * This does not and cannot: who you follow is not knowable during SSR, and it
 * is the only thing this answers.
 *
 * The response never reaches past the caller's follows. There is no
 * game-wide leaderboard behind this endpoint and no parameter that would widen
 * it into one — see docs/grand_design.md, "偽装は防がない、代わりに誰を見るか
 * を選ばせる".
 */

import type { Action } from "@remix-run/fetch-router";

import { gameRef } from "@game-center/protocol";

import { requireDb } from "../../db/client.ts";
import { findGame } from "../../db/games.ts";
import { listUnlocksAmongFollowed, type PeerUnlock } from "../../db/unlocks.ts";
import { authenticateSession } from "../../lib/auth.ts";
import { publicTitle } from "../../lib/spoilers.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

/** One achievement, and everyone in view who has unlocked it. */
interface PeerAchievement {
  readonly key: string;
  readonly title: string;
  readonly hidden: boolean;
  readonly entries: ReadonlyArray<{
    readonly handle: string;
    readonly displayName: string;
    readonly score: number | null;
    readonly unlockedAt: string;
    readonly self: boolean;
  }>;
}

export const internalGamePeersAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const { handle, slug } = context.params;
    const client = requireDb();
    const game = await findGame(client, gameRef(handle, slug));
    if (!game) return apiError("No such game", 404);

    const unlocks = await listUnlocksAmongFollowed(
      client,
      auth.user.id,
      game.id,
    );
    return apiJson({ achievements: group(unlocks) });
  },
} satisfies Action<typeof routes.internalGamePeers>;

/**
 * Fold the flat rows into one entry per achievement.
 *
 * The query already returns them in the order they should be read, so this
 * only has to keep that order rather than re-derive it.
 */
function group(unlocks: readonly PeerUnlock[]): PeerAchievement[] {
  const byKey = new Map<string, PeerAchievement>();
  for (const unlock of unlocks) {
    let achievement = byKey.get(unlock.key);
    if (!achievement) {
      achievement = {
        key: unlock.key,
        // Masked here rather than in the browser: a title the client never
        // receives is one it cannot leak, whatever it does with the response.
        title: publicTitle(unlock),
        hidden: unlock.hidden,
        entries: [],
      };
      byKey.set(unlock.key, achievement);
    }
    (achievement.entries as Array<PeerAchievement["entries"][number]>).push({
      handle: unlock.handle,
      displayName: unlock.displayName,
      score: unlock.score,
      unlockedAt: unlock.unlockedAt,
      self: unlock.self,
    });
  }
  return [...byKey.values()];
}
