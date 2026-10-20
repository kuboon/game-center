/**
 * GET /api/internal/games/@{handle}/{slug}/progress — where the viewer stands
 * in one game, and the people they follow next to them.
 *
 * The game page is server-rendered and reads the same for everybody. This is
 * the half it cannot render: your own unlocks, and who you follow. The page's
 * `AchievementBoard` lays both over the public list.
 *
 * `mine` carries the wording of hidden achievements, because they are yours:
 * you earned the right to read them, and nobody else's unlocks are in it.
 * `peers` carries no wording at all — the page already has what it may show.
 *
 * Never reaches past the caller's follows. There is no game-wide leaderboard
 * behind this endpoint and no parameter that would widen it into one — see
 * docs/grand_design.md, "偽装は防がない、代わりに誰を見るかを選ばせる".
 */

import type { Action } from "@remix-run/fetch-router";

import { gameRef } from "@game-center/protocol";

import { requireDb } from "../../db/client.ts";
import { findGame } from "../../db/games.ts";
import {
  listUnlocksAmongFollowed,
  listUnlocksForGame,
  type PeerUnlock,
} from "../../db/unlocks.ts";
import { authenticateSession } from "../../lib/auth.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

/** One achievement, and everyone you follow who has unlocked it. */
interface PeerAchievement {
  readonly key: string;
  readonly entries: ReadonlyArray<{
    readonly handle: string;
    readonly displayName: string;
    readonly score: number | null;
    readonly unlockedAt: string;
  }>;
}

export const internalGameProgressAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const { handle, slug } = context.params;
    const client = requireDb();
    const game = await findGame(client, gameRef(handle, slug));
    if (!game) return apiError("No such game", 404);

    const [mine, around] = await Promise.all([
      listUnlocksForGame(client, auth.user.id, game.id),
      listUnlocksAmongFollowed(client, auth.user.id, game.id),
    ]);
    return apiJson({
      mine: mine.map((unlock) => ({
        key: unlock.key,
        title: unlock.title,
        description: unlock.description,
        score: unlock.score,
        unlockedAt: unlock.unlockedAt,
      })),
      // Your own rows are `mine`; here they would only say it twice.
      peers: group(around.filter((unlock) => !unlock.self)),
    });
  },
} satisfies Action<typeof routes.internalGameProgress>;

/**
 * Fold the flat rows into one entry per achievement.
 *
 * The query already returns them in the order they should be read — best score
 * first — so this only has to keep that order rather than re-derive it.
 */
function group(unlocks: readonly PeerUnlock[]): PeerAchievement[] {
  const byKey = new Map<string, PeerAchievement>();
  for (const unlock of unlocks) {
    let achievement = byKey.get(unlock.key);
    if (!achievement) {
      achievement = { key: unlock.key, entries: [] };
      byKey.set(unlock.key, achievement);
    }
    (achievement.entries as Array<PeerAchievement["entries"][number]>).push({
      handle: unlock.handle,
      displayName: unlock.displayName,
      score: unlock.score,
      unlockedAt: unlock.unlockedAt,
    });
  }
  return [...byKey.values()];
}
