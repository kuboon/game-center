/**
 * Fetching a game's manifest from its own URL.
 *
 * This is what replaces the API token: the hub reads the document instead of
 * being handed it, so the caller proves nothing and needs no credential. What
 * vouches for a registration is that the manifest was served from the URL it
 * claims — and only whoever controls that URL can arrange that.
 *
 * The hub is a public service fetching URLs strangers name, so the request is
 * fenced in: https only, no private hosts, a small number of redirects each
 * checked in turn, a size cap, and a timeout. Nothing of the response reaches
 * the caller except validation messages, which name fields rather than values,
 * so a redirect into somewhere private leaks nothing back.
 */

import {
  extractManifestScript,
  type GameManifest,
  MANIFEST_FILENAME,
  type ManifestIssue,
  parseManifestText,
} from "@game-center/protocol";

/** Enough for a large single-file game with its assets inlined. */
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** Hostnames that never name something on the public internet. */
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|\[?::1\]?)$/i;
const PRIVATE_IPV4 =
  /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;

/** Raised when a URL cannot be fetched, or holds no manifest. */
export class ManifestFetchError extends Error {
  override readonly name = "ManifestFetchError";
  /** Field-level problems, when the document was found but did not validate. */
  readonly issues: readonly ManifestIssue[];

  constructor(message: string, issues: readonly ManifestIssue[] = []) {
    super(message);
    this.issues = issues;
  }
}

/** Seam for the tests, which exercise discovery without a network. */
export interface FetchOptions {
  readonly fetch?: typeof globalThis.fetch;
}

export interface FetchedManifest {
  readonly manifest: GameManifest;
  /** Where the game is, after redirects. This is what the hub records. */
  readonly gameUrl: string;
  /** Where the manifest itself was found. */
  readonly manifestUrl: string;
  /** Which of the two conventions the game used. */
  readonly source: "embedded" | "file";
}

/**
 * Read the manifest for the game at `url`.
 *
 * Looks in the page first and the sibling `gamecenter.json` second. The page
 * comes first because it is what the URL actually names: a game that embeds
 * its manifest cannot have the two disagree, and one that does not embed it
 * costs one extra request.
 *
 * @param url The game's page URL, as given by whoever is registering it
 * @returns The manifest and where it was found
 * @throws {ManifestFetchError} when nothing usable is there
 */
export async function fetchManifest(
  url: string,
  { fetch = globalThis.fetch }: FetchOptions = {},
): Promise<FetchedManifest> {
  const pageUrl = requirePublicHttpsUrl(url);

  const page = await get(pageUrl, fetch);
  const embedded = extractManifestScript(page.body);
  if (embedded !== null) {
    return {
      ...parseOrThrow(embedded, page.url),
      gameUrl: page.url,
      manifestUrl: page.url,
      source: "embedded",
    };
  }

  const fileUrl = new URL(MANIFEST_FILENAME, page.url);
  let file;
  try {
    file = await get(fileUrl, fetch);
  } catch (cause) {
    // Reported against the page, because that is the URL the registrant gave
    // and the embedded form is the one they most likely meant to use.
    throw new ManifestFetchError(
      `No manifest at ${page.url}: the page carries no <script type="application/gamecenter+json">, and ${fileUrl.href} could not be read (${
        (cause as Error).message
      })`,
    );
  }

  return {
    ...parseOrThrow(file.body, file.url),
    gameUrl: page.url,
    manifestUrl: file.url,
    source: "file",
  };
}

function parseOrThrow(
  text: string,
  where: string,
): { manifest: GameManifest } {
  const parsed = parseManifestText(text);
  if (!parsed.ok) {
    throw new ManifestFetchError(
      `The manifest at ${where} is not valid`,
      parsed.issues,
    );
  }
  return { manifest: parsed.manifest };
}

/**
 * A GET that follows redirects itself, so every hop can be checked.
 *
 * `fetch` would follow them for us, but then only the first URL would have
 * been vetted and a redirect could walk the request into a private network.
 */
async function get(
  url: URL,
  fetch: typeof globalThis.fetch,
): Promise<{ url: string; body: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { accept: "text/html, application/json;q=0.9, */*;q=0.1" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      current = requirePublicHttpsUrl(new URL(location, current).href);
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new ManifestFetchError(
        `${current.href} answered ${response.status}`,
      );
    }
    return { url: current.href, body: await readCapped(response, current) };
  }
  throw new ManifestFetchError(`${url.href} redirects too many times`);
}

/**
 * Read the body, giving up past {@link MAX_BYTES}.
 *
 * `content-length` is a hint the server controls, so the cap is enforced while
 * reading rather than trusted up front.
 */
async function readCapped(response: Response, url: URL): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new ManifestFetchError(
        `${url.href} is larger than ${MAX_BYTES} bytes`,
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/**
 * Vet a URL before the hub goes anywhere near it.
 *
 * Hostname-level checks only: resolving the name here and connecting to the
 * resolved address is not something `fetch` lets us do, so a hostname that
 * resolves into a private range still gets through. The exposure that leaves
 * is blind — no part of a response is ever returned to the caller — which is
 * why this is a reasonable place to stop.
 */
function requirePublicHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ManifestFetchError(`${value} is not a URL`);
  }
  if (url.protocol !== "https:") {
    throw new ManifestFetchError("A game's URL must be https");
  }
  const host = url.hostname;
  if (
    PRIVATE_HOST.test(host) || PRIVATE_IPV4.test(host) || !host.includes(".")
  ) {
    throw new ManifestFetchError(`${host} is not a public host`);
  }
  return url;
}
