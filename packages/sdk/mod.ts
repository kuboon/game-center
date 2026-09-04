/**
 * The game-center SDK: one file, no dependencies, meant to be pasted.
 *
 * Games that need this most are the ones that cannot install anything — a
 * Claude Artifact is a single HTML page that may not load an external script.
 * So staying small enough to paste is part of the specification, not a style
 * preference. Read it before you use it; it is short on purpose.
 *
 * ```ts
 * const gc = GameCenter.init({ gameId: "kuboon/my-puzzle" });
 * await gc.unlock("first_clear");
 * await gc.unlock("high_score", { score: 1200 });
 * gc.player; // { name } | null — only when launched from the hub
 * ```
 *
 * `unlock()` tries two ways of reaching the hub and takes the first that
 * works: calling the REST API with the launch token the hub put in the URL,
 * and otherwise handing back a claim URL. The second always works, including
 * from an Artifact, which is why it is the floor rather than an error.
 *
 * A claim URL is **not** opened for you. Popup blockers eat unprompted
 * `window.open`, and a player should see what they are about to record before
 * it is recorded. Use {@link GameCenter.claimLink} to put a link on the page.
 *
 * @module
 */

/** Who the hub says is playing. Known only when launched from the hub. */
export interface Player {
  readonly name: string;
}

export interface InitOptions {
  /** The game's full name: `{author}/{slug}`, as `gamecenter.json` declares it. */
  readonly gameId: string;
  /** Override for local development. */
  readonly hub?: string;
}

export interface UnlockOptions {
  /** Only the highest value ever reported is kept. */
  readonly score?: number;
}

export interface UnlockResult {
  /** Which of the two ways reached the hub. */
  readonly mode: "rest" | "claim";
  /** True when the hub has recorded it. False means `claimUrl` is the next step. */
  readonly recorded: boolean;
  /** Present when the player has to confirm this themselves. */
  readonly claimUrl?: string;
}

const DEFAULT_HUB = "https://ga-cen.kbn.one";
const TOKEN_KEY = "gc:token";

export class GameCenter {
  readonly gameId: string;
  readonly hub: string;
  /** Fills in shortly after {@link init} when a launch token was present. */
  player: Player | null = null;
  /** Resolves once the player has been looked up, or immediately without one. */
  readonly ready: Promise<void>;

  #token: string | null;
  #pending = 0;

  private constructor(options: InitOptions) {
    this.gameId = options.gameId;
    this.hub = (options.hub ?? DEFAULT_HUB).replace(/\/$/, "");
    this.#token = readLaunchToken();
    this.ready = this.#loadPlayer();
  }

  /** Read the launch token out of the URL and start looking up the player. */
  static init(options: InitOptions): GameCenter {
    return new GameCenter(options);
  }

  /**
   * Record an achievement.
   *
   * Never throws and never navigates. When it could not reach the hub, the
   * result carries a `claimUrl` for the player to confirm.
   */
  async unlock(
    key: string,
    options: UnlockOptions = {},
  ): Promise<UnlockResult> {
    const claimUrl = this.claimUrl(key, options);

    if (this.#token) {
      try {
        const response = await fetch(`${this.hub}/api/game/v1/unlock`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ achievement: key, ...options }),
        });
        if (response.ok) return { mode: "rest", recorded: true };
        // 401 means the token expired. Dropping it stops every later unlock
        // from waiting on a request that cannot succeed.
        if (response.status === 401) this.#forgetToken();
      } catch {
        // Offline, blocked, or the hub is down. The claim URL still works.
      }
    }

    return { mode: "claim", recorded: false, claimUrl };
  }

  /** Where a player confirms this achievement themselves. */
  claimUrl(key: string, options: UnlockOptions = {}): string {
    const query = options.score === undefined ? "" : `?score=${options.score}`;
    return `${this.hub}/claim/@${this.gameId}/${key}${query}`;
  }

  /**
   * An anchor that records the achievement when the player clicks it.
   *
   * Put it on the page rather than opening it: a link the player chose to
   * follow survives popup blockers and tells them what is about to happen.
   */
  claimLink(
    key: string,
    options: UnlockOptions & { text?: string } = {},
  ): HTMLAnchorElement {
    const a = document.createElement("a");
    a.href = this.claimUrl(key, options);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = options.text ?? "実績を記録する";
    return a;
  }

  async #loadPlayer(): Promise<void> {
    if (!this.#token) return;
    try {
      const response = await fetch(`${this.hub}/api/game/v1/me`, {
        headers: { authorization: `Bearer ${this.#token}` },
      });
      if (response.ok) this.player = (await response.json()).player ?? null;
      else if (response.status === 401) this.#forgetToken();
    } catch {
      // Knowing the player is a nicety; unlocking does not depend on it.
    }
  }

  #forgetToken(): void {
    this.#token = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch { /* storage may be unavailable */ }
  }
}

/**
 * Take the launch token out of the URL fragment and remember it.
 *
 * The hub puts it there rather than in the query string so it stays out of the
 * game host's access logs. Removing it from the address bar keeps it from being
 * copied into a chat window along with the URL.
 */
function readLaunchToken(): string | null {
  try {
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = hash.get("gctoken");
    if (token) {
      hash.delete("gctoken");
      const rest = hash.toString();
      history.replaceState(
        null,
        "",
        location.pathname + location.search + (rest ? `#${rest}` : ""),
      );
      localStorage.setItem(TOKEN_KEY, token);
      return token;
    }
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
