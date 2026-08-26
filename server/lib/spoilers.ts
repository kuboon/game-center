/**
 * What a page may say about an achievement whose name is a secret.
 *
 * A manifest marks an achievement `hidden` when knowing it exists would spoil
 * the game. The hub honours that everywhere it renders one, which sounds
 * obvious until a page starts showing *other people's* records: a player's
 * profile is public, is meant to be posted on social media, and lists what
 * they have unlocked. Rendering the title there would leak every secret in
 * every game to anyone who follows a link.
 *
 * So the rule lives here rather than in a ternary inside each page. It is one
 * line, and it is the line that decides whether a game's surprises survive.
 */

/** The stand-in shown where a hidden achievement's name would go. */
export const MASKED_TITLE = "??????";

/** Just enough of an achievement to decide what to call it. */
export interface Nameable {
  readonly title: string;
  readonly hidden: boolean;
}

/**
 * The title as a public page may show it.
 *
 * @param achievement The achievement or unlock being rendered
 * @returns The real title, or {@link MASKED_TITLE} when it is a secret
 */
export function publicTitle(achievement: Nameable): string {
  return achievement.hidden ? MASKED_TITLE : achievement.title;
}
