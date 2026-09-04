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
 *
 * // Whatever could not be sent is waiting. One link records all of it.
 * const link = gc.claimLink();
 * if (link) document.body.appendChild(link);
 *
 * // For a game that draws its own achievement screen.
 * const list = await gc.achievements(); // null without a launch token
 * ```
 *
 * There are two ways to the hub. A player who arrived through the hub carries
 * a **launch token**, and `unlock()` records over REST there and then. Anyone
 * else — someone who opened the game's own URL, or was offline, or came back
 * after the token expired — has nothing to authenticate with, so the unlock
 * goes into a **queue** in `localStorage` and waits.
 *
 * The queue empties two ways. If a token turns up later, {@link GameCenter}
 * sends the whole queue at once. Otherwise the player follows one claim link
 * that names everything at once, and confirms it on the hub. Either way the
 * player is not asked to do anything per achievement.
 *
 * A claim link is **not** opened for you. Popup blockers eat unprompted
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

/** One unlock the hub has not been told about yet. */
export interface PendingUnlock {
  readonly key: string;
  readonly score: number | null;
}

/**
 * One of the game's achievements, with this player's progress.
 *
 * `pending` is the queue showing through: the player earned it, and the hub
 * has not been told yet. A game drawing its own achievement screen should show
 * it as earned — the player did the thing — and can use `pending` to say the
 * record is still waiting.
 */
export interface Achievement {
  readonly key: string;
  /** Null while the hub keeps a hidden achievement's wording secret. */
  readonly title: string | null;
  readonly description: string | null;
  readonly points: number;
  readonly hidden: boolean;
  /** True when the hub has it, or it is waiting in the queue. */
  readonly unlocked: boolean;
  /** True when it is earned but the hub has not recorded it. */
  readonly pending: boolean;
  /** When the hub recorded it. Null while it is only in the queue. */
  readonly unlockedAt: string | null;
  readonly score: number | null;
}

export interface UnlockResult {
  /** True when the hub has recorded it. */
  readonly recorded: boolean;
  /**
   * How many unlocks are waiting to be claimed, this one included.
   *
   * Zero means there is nothing to offer the player. Anything else is the
   * number {@link GameCenter.claimLink} would record in one press.
   */
  readonly pending: number;
}

const DEFAULT_HUB = "https://ga-cen.kbn.one";
const TOKEN_KEY = "gc:token";
/**
 * How many unlocks the queue keeps.
 *
 * The same as the hub's per-request ceiling, so a queue that filled up can
 * always be sent in one call. Past it the oldest go, because the newest are
 * the ones the player just earned and remembers.
 */
const MAX_PENDING = 50;

export class GameCenter {
  readonly gameId: string;
  readonly hub: string;
  /** Fills in shortly after {@link init} when a launch token was present. */
  player: Player | null = null;
  /** Resolves once the player has been looked up and the queue has been sent. */
  readonly ready: Promise<void>;

  #token: string | null;
  #pending: PendingUnlock[];
  /** The hub's answer to `/achievements`, before the queue is folded in. */
  #defined: Omit<Achievement, "pending">[] | null = null;

  private constructor(options: InitOptions) {
    this.gameId = options.gameId;
    this.hub = (options.hub ?? DEFAULT_HUB).replace(/\/$/, "");
    this.#token = readLaunchToken();
    this.#pending = readPending(this.#queueKey());
    this.#forgetClaimed();
    this.ready = this.#start();
  }

  /** Read the launch token out of the URL and start looking up the player. */
  static init(options: InitOptions): GameCenter {
    return new GameCenter(options);
  }

  /** What is waiting to be claimed, oldest first. */
  get pending(): readonly PendingUnlock[] {
    return this.#pending;
  }

  /**
   * Record an achievement.
   *
   * Never throws and never navigates. When the hub could not be reached the
   * unlock is queued, and `pending` says how many are waiting.
   */
  async unlock(
    key: string,
    options: UnlockOptions = {},
  ): Promise<UnlockResult> {
    const score = options.score ?? null;

    if (this.#token) {
      const sent = await this.#post({ achievement: key, ...options });
      if (sent) {
        // The hub's list now says something this one does not.
        this.#defined = null;
        return { recorded: true, pending: this.#pending.length };
      }
    }

    this.#remember({ key, score });
    return { recorded: false, pending: this.#pending.length };
  }

  /**
   * Send everything queued, if there is anything and anyone to send it to.
   *
   * Called for you when the SDK starts. Worth calling again after a long
   * session, since a token can be present the whole time and the network not.
   *
   * @returns True when the queue is now empty
   */
  async flush(): Promise<boolean> {
    if (this.#pending.length === 0) return true;
    if (!this.#token) return false;

    const sent = await this.#post({
      unlocks: this.#pending.map(({ key, score }) => ({ key, score })),
    });
    if (!sent) return false;

    // Only what the hub said it recorded. A key it does not know stays, so a
    // manifest that later declares it can still take the unlock.
    const kept = new Set(
      (sent.results ?? []).filter((r) => r.ok).map((r) => r.key),
    );
    this.#keep(this.#pending.filter((item) => !kept.has(item.key)));
    if (kept.size > 0) this.#defined = null;
    return this.#pending.length === 0;
  }

  /**
   * The game's achievements, with what this player has done to them.
   *
   * For a game that wants to draw its own achievement screen. The hub is the
   * one place that knows what a *hidden* achievement is called before it is
   * earned — which is to say, that it must not be told — so `title` comes back
   * null until the player has it.
   *
   * Whatever is still queued is folded in, so an unlock earned while offline
   * shows as earned rather than missing. It carries `pending: true`, because
   * the difference between "earned" and "recorded" is the player's to see.
   *
   * The hub's half is fetched once and kept; the queue is folded in on every
   * call, so a fresh unlock shows up without asking again.
   *
   * @param options `refresh` asks the hub again rather than using what is kept
   * @returns The list, or null without a launch token to ask with
   */
  async achievements(
    options: { refresh?: boolean } = {},
  ): Promise<Achievement[] | null> {
    if (!this.#token) return null;
    if (options.refresh) this.#defined = null;

    if (!this.#defined) {
      try {
        const response = await fetch(`${this.hub}/api/game/v1/achievements`, {
          headers: { authorization: `Bearer ${this.#token}` },
        });
        if (!response.ok) {
          if (response.status === 401) this.#forgetToken();
          return null;
        }
        const body = await response.json() as {
          achievements?: Omit<Achievement, "pending">[];
        };
        this.#defined = body.achievements ?? [];
      } catch {
        return null;
      }
    }

    const queued = new Map(this.#pending.map((item) => [item.key, item.score]));
    return this.#defined.map((achievement) => {
      const waiting = queued.get(achievement.key);
      if (waiting === undefined) return { ...achievement, pending: false };
      const score = waiting !== null &&
          (achievement.score === null || waiting > achievement.score)
        ? waiting
        : achievement.score;
      return { ...achievement, unlocked: true, pending: true, score };
    });
  }

  /**
   * Where the player confirms everything that is waiting.
   *
   * The list rides in the URL fragment, so it never reaches the hub's server
   * until the player presses the button there.
   *
   * @returns The URL, or null when nothing is waiting
   */
  claimUrl(): string | null {
    if (this.#pending.length === 0) return null;
    const list = this.#pending
      .map(({ key, score }) => (score === null ? key : `${key}:${score}`))
      .join(",");
    return `${this.hub}/claim/@${this.gameId}#gc=${list}`;
  }

  /**
   * An anchor that records everything waiting when the player clicks it.
   *
   * Put it on the page rather than opening it: a link the player chose to
   * follow survives popup blockers and tells them what is about to happen.
   *
   * @returns The anchor, or null when nothing is waiting
   */
  claimLink(options: { text?: string } = {}): HTMLAnchorElement | null {
    const href = this.claimUrl();
    if (!href) return null;

    const a = document.createElement("a");
    a.href = href;
    a.textContent = options.text ??
      `実績を記録する(${this.#pending.length}件)`;
    return a;
  }

  /** Look up the player, drop what the hub already has, send what is left. */
  async #start(): Promise<void> {
    await this.#loadPlayer();
    await this.flush();
  }

  /**
   * POST to the game API with the launch token.
   *
   * @returns The parsed answer, or null when the hub did not take it
   */
  async #post(
    body: Record<string, unknown>,
  ): Promise<{ results?: { key: string; ok: boolean }[] } | null> {
    try {
      const response = await fetch(`${this.hub}/api/game/v1/unlock`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (response.ok) return await response.json().catch(() => ({}));
      // 401 means the token expired. Dropping it stops every later unlock from
      // waiting on a request that cannot succeed.
      if (response.status === 401) this.#forgetToken();
    } catch {
      // Offline, blocked, or the hub is down. The queue holds it.
    }
    return null;
  }

  async #loadPlayer(): Promise<void> {
    if (!this.#token) return;
    try {
      const response = await fetch(`${this.hub}/api/game/v1/me`, {
        headers: { authorization: `Bearer ${this.#token}` },
      });
      if (!response.ok) {
        if (response.status === 401) this.#forgetToken();
        return;
      }
      const body = await response.json() as {
        player?: Player;
        achievements?: { key: string; score: number | null }[];
      };
      this.player = body.player ?? null;

      // The hub is the record. Anything queued that it already has, with a
      // score no lower, is nothing to ask the player about.
      const have = new Map(
        (body.achievements ?? []).map((a) => [a.key, a.score]),
      );
      this.#keep(this.#pending.filter(({ key, score }) => {
        if (!have.has(key)) return true;
        const kept = have.get(key) ?? null;
        return score !== null && (kept === null || score > kept);
      }));
    } catch {
      // Knowing the player is a nicety; unlocking does not depend on it.
    }
  }

  /** Add to the queue, keeping the best score and the newest entries. */
  #remember(item: PendingUnlock): void {
    const previous = this.#pending.find((held) => held.key === item.key);
    const rest = this.#pending.filter((held) => held.key !== item.key);
    const score = previous && previous.score !== null &&
        (item.score === null || previous.score > item.score)
      ? previous.score
      : item.score;
    this.#keep([...rest, { key: item.key, score }].slice(-MAX_PENDING));
  }

  #keep(pending: PendingUnlock[]): void {
    this.#pending = pending;
    try {
      if (pending.length === 0) localStorage.removeItem(this.#queueKey());
      else localStorage.setItem(this.#queueKey(), JSON.stringify(pending));
    } catch { /* storage may be unavailable */ }
  }

  /**
   * Drop what the hub says it recorded, from the fragment it sends back.
   *
   * The hub cannot reach into this game's storage, so the claim page ends with
   * a link back here naming what it wrote. Missing it costs nothing: the same
   * keys are dropped on the next launch that carries a token, and claiming
   * twice records the same thing.
   */
  #forgetClaimed(): void {
    try {
      const hash = new URLSearchParams(location.hash.slice(1));
      const claimed = hash.get("gcclaimed");
      if (!claimed) return;
      const done = new Set(claimed.split(","));
      this.#keep(this.#pending.filter((item) => !done.has(item.key)));
      hash.delete("gcclaimed");
      const rest = hash.toString();
      history.replaceState(
        null,
        "",
        location.pathname + location.search + (rest ? `#${rest}` : ""),
      );
    } catch { /* storage or history may be unavailable */ }
  }

  #queueKey(): string {
    return `gc:pending:${this.gameId}`;
  }

  #forgetToken(): void {
    this.#token = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch { /* storage may be unavailable */ }
  }
}

/** Read the queue, treating anything unreadable as an empty one. */
function readPending(key: string): PendingUnlock[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingUnlock[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.key === "string")
      .map(({ key, score }) => ({
        key,
        score: typeof score === "number" ? score : null,
      }));
  } catch {
    return [];
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
