/**
 * The picture a link to this hub carries: the cabinet, at card size.
 *
 * Until now a shared URL went out with no picture at all, because nothing was
 * generated to stand in for a game's icon or a player's avatar. That still
 * holds — this is not a placeholder for either. It is the hub's own card, the
 * same drawing the launcher icon is, for the pages whose subject *is* the hub
 * and for the ones whose subject brought no picture of its own.
 *
 * **It carries no page-specific text.** Everything this hub writes is
 * Japanese, and drawing Japanese means shipping a CJK font — for a line the
 * card already states next to the image, in selectable text, as `og:title`.
 * So the card says what a marquee says, which is the name, and the alphabet
 * below is small enough to keep in source.
 *
 * Drawn from rectangles for the same reason the icon is drawn rather than
 * photographed: it stays sharp, it costs nothing to change, and there is no
 * binary in the repository that nobody can diff. Flat blocks also mean the
 * encoder needs no anti-aliasing and deflate finds whole repeated rows.
 */

import { encodePng } from "./png.ts";

const WIDTH = 1200;
/** 1200×630 is 1.91:1 — the shape X and Facebook crop a large card to. */
const HEIGHT = 630;

/** The landing page's palette (`assets/style.css`). */
const SCREEN = "#06081a";
const SHELL = "#161a35";
const EDGE = "#2b3160";
const AMBER = "#ffd93d";
const CYAN = "#7ee7ff";
const PINK = "#ff5d8f";
const DIM = "#a7b0e0";

/**
 * A 5×7 dot alphabet, written as strips so the letters are legible here.
 *
 * Thirteen glyphs to a strip keeps a line inside a normal editor. Hostnames
 * and the marquee are all this has to spell, so the set is letters, digits,
 * the dot and the hyphen.
 */
const GLYPH_STRIPS: readonly (readonly [string, string])[] = [
  [
    "ABCDEFGHIJKLM",
    `
.###. ####. .###. ####. ##### ##### .###. #...# ##### ..### #...# #.... #...#
#...# #...# #...# #...# #.... #.... #...# #...# ..#.. ...#. #..#. #.... ##.##
#...# #...# #.... #...# #.... #.... #.... #...# ..#.. ...#. #.#.. #.... #.#.#
##### ####. #.... #...# ####. ####. #.### ##### ..#.. ...#. ##... #.... #...#
#...# #...# #.... #...# #.... #.... #...# #...# ..#.. ...#. #.#.. #.... #...#
#...# #...# #...# #...# #.... #.... #...# #...# ..#.. #..#. #..#. #.... #...#
#...# ####. .###. ####. ##### #.... .###. #...# ##### .##.. #...# ##### #...#`,
  ],
  [
    "NOPQRSTUVWXYZ",
    `
#...# .###. ####. .###. ####. .#### ##### #...# #...# #...# #...# #...# #####
##..# #...# #...# #...# #...# #.... ..#.. #...# #...# #...# #...# #...# ....#
#.#.# #...# #...# #...# #...# #.... ..#.. #...# #...# #...# .#.#. .#.#. ...#.
#..## #...# ####. #...# ####. .###. ..#.. #...# #...# #...# ..#.. ..#.. ..#..
#...# #...# #.... #.#.# #.#.. ....# ..#.. #...# #...# #.#.# .#.#. ..#.. .#...
#...# #...# #.... #..#. #..#. ....# ..#.. #...# .#.#. ##.## #...# ..#.. #....
#...# .###. #.... .##.# #...# ####. ..#.. .###. ..#.. #...# #...# ..#.. #####`,
  ],
  [
    "0123456789.-",
    `
.###. ..#.. .###. ##### ...#. ##### ..##. ##### .###. .###. ..... .....
#...# .##.. #...# ...#. ..##. #.... .#... ....# #...# #...# ..... .....
#..## ..#.. ....# ..#.. .#.#. ####. #.... ...#. #...# #...# ..... .....
#.#.# ..#.. ...#. ...#. #..#. ....# ####. ..#.. .###. .#### ..... #####
##..# ..#.. ..#.. ....# ##### ....# #...# .#... #...# ....# ..... .....
#...# ..#.. .#... #...# ...#. #...# #...# .#... #...# ...#. .##.. .....
.###. .###. ##### .###. ...#. .###. .###. .#... .###. .##.. .##.. .....`,
  ],
];

/** Each glyph as its seven rows of five dots. */
const GLYPHS: ReadonlyMap<string, readonly string[]> = (() => {
  const glyphs = new Map<string, string[]>();
  for (const [letters, strip] of GLYPH_STRIPS) {
    const rows = strip.trim().split("\n");
    for (let i = 0; i < letters.length; i++) {
      glyphs.set(letters[i], rows.map((row) => row.slice(i * 6, i * 6 + 5)));
    }
  }
  return glyphs;
})();

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

function parseColor(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Blend towards `onto`, for glows and drop shadows. `amount` is how much stays. */
function mix(
  hex: string,
  onto: string,
  amount: number,
): [number, number, number] {
  const [r, g, b] = parseColor(hex);
  const [br, bg, bb] = parseColor(onto);
  return [
    Math.round(br + (r - br) * amount),
    Math.round(bg + (g - bg) * amount),
    Math.round(bb + (b - bb) * amount),
  ];
}

/** A grid of RGB pixels with the two operations this drawing needs. */
class Bitmap {
  readonly pixels: Uint8Array<ArrayBuffer>;

  constructor(
    readonly width: number,
    readonly height: number,
    background: [number, number, number],
  ) {
    this.pixels = new Uint8Array(width * height * 3);
    this.fill(0, 0, width, height, background);
  }

  /** Paint a rectangle, clipped to the image. */
  fill(
    x: number,
    y: number,
    w: number,
    h: number,
    [r, g, b]: [number, number, number],
  ): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let py = y0; py < y1; py++) {
      let at = (py * this.width + x0) * 3;
      for (let px = x0; px < x1; px++) {
        this.pixels[at++] = r;
        this.pixels[at++] = g;
        this.pixels[at++] = b;
      }
    }
  }

  /** Write text in the dot alphabet, one `dot`-sized square per lit cell. */
  text(
    text: string,
    x: number,
    y: number,
    dot: number,
    color: [number, number, number],
  ): void {
    let cursor = x;
    for (const char of text.toUpperCase()) {
      const glyph = GLYPHS.get(char);
      if (glyph) {
        for (let row = 0; row < GLYPH_HEIGHT; row++) {
          for (let col = 0; col < GLYPH_WIDTH; col++) {
            if (glyph[row][col] !== "#") continue;
            this.fill(cursor + col * dot, y + row * dot, dot, dot, color);
          }
        }
      }
      // An unknown character still takes its place, so nothing shifts.
      cursor += (GLYPH_WIDTH + 1) * dot;
    }
  }
}

/** How wide `text` will be at this dot size, for centring it. */
function textWidth(text: string, dot: number): number {
  return text.length * (GLYPH_WIDTH + 1) * dot - dot;
}

/**
 * A rectangle with stepped corners.
 *
 * The cabinet's corners are round; at this resolution a two-step stair reads
 * as a curve and stays honest about being drawn from blocks.
 */
function bevel(
  bitmap: Bitmap,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
  step: number,
): void {
  bitmap.fill(x + step * 2, y, w - step * 4, h, color);
  bitmap.fill(x + step, y + step, w - step * 2, h - step * 2, color);
  bitmap.fill(x, y + step * 2, w, h - step * 4, color);
}

/** Draw text centred on the image, with the arcade's own drop shadow. */
function centered(
  bitmap: Bitmap,
  text: string,
  y: number,
  dot: number,
  hex: string,
): void {
  const x = Math.round((WIDTH - textWidth(text, dot)) / 2);
  bitmap.text(text, x + dot, y + dot, dot, mix(hex, SCREEN, 0.22));
  bitmap.text(text, x, y, dot, parseColor(hex));
}

/**
 * Draw the card.
 *
 * @param host The hostname on the bottom line, so a copy of this hub says
 *   which one it is rather than naming the original
 */
function draw(host: string): Bitmap {
  const bitmap = new Bitmap(WIDTH, HEIGHT, parseColor(SHELL));

  // The screen: an outer bevel in the cabinet's edge, filled with the dark.
  bevel(bitmap, 36, 36, WIDTH - 72, HEIGHT - 72, parseColor(EDGE), 10);
  bevel(bitmap, 44, 44, WIDTH - 88, HEIGHT - 88, parseColor(SCREEN), 8);

  // Scanlines, drawn before the lettering so they sit behind it.
  for (let y = 52; y < HEIGHT - 52; y += 6) {
    bitmap.fill(52, y, WIDTH - 104, 2, mix(CYAN, SCREEN, 0.06));
  }

  // The marquee bulbs, in the landing page's order.
  const bulbs = [AMBER, PINK, PINK, AMBER];
  const spacing = 72;
  const first = (WIDTH - spacing * (bulbs.length - 1)) / 2;
  bulbs.forEach((hex, index) => {
    const cx = first + index * spacing;
    bitmap.fill(cx - 15, 86, 30, 30, mix(hex, SCREEN, 0.22));
    bitmap.fill(cx - 9, 92, 18, 18, parseColor(hex));
  });

  // The name, split across two lines: the amber and cyan of the app icon, and
  // narrow enough to survive a square crop.
  centered(bitmap, "GAME", 152, 16, AMBER);
  centered(bitmap, "CENTER", 290, 16, CYAN);

  centered(bitmap, "PRESS START", 448, 7, PINK);
  centered(bitmap, host, 528, 4, DIM);

  return bitmap;
}

let cached:
  | { host: string; png: Promise<Uint8Array<ArrayBuffer>> }
  | null = null;

/**
 * The card as PNG bytes, drawn once per process.
 *
 * Crawlers ask rarely and the drawing never changes within a deployment, so
 * the first request pays for it and the rest are handed the same bytes.
 */
export function shareCardPng(host: string): Promise<Uint8Array<ArrayBuffer>> {
  if (cached?.host !== host) {
    const bitmap = draw(host);
    cached = { host, png: encodePng(WIDTH, HEIGHT, bitmap.pixels) };
  }
  return cached.png;
}

export const shareCardSize = { width: WIDTH, height: HEIGHT } as const;
