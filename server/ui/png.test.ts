import { assertEquals, assertRejects } from "@std/assert";

import { encodePng } from "./png.ts";

/** Pull one chunk's payload out of a PNG, by type. */
function chunkOf(png: Uint8Array, type: string): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8; // past the signature
  while (at < png.length) {
    const length = view.getUint32(at);
    const name = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    if (name === type) return png.subarray(at + 8, at + 8 + length);
    at += 12 + length;
  }
  throw new Error(`no ${type} chunk`);
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// deno-fmt-ignore
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

Deno.test("writes a PNG a decoder can read back", async () => {
  // Two pixels wide, two tall: red, green / blue, white.
  // deno-fmt-ignore
  const pixels = new Uint8Array([
    255, 0, 0,    0, 255, 0,
    0, 0, 255,    255, 255, 255,
  ]);
  const png = await encodePng(2, 2, pixels);

  assertEquals(Array.from(png.subarray(0, 8)), SIGNATURE);

  const header = chunkOf(png, "IHDR");
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  assertEquals(view.getUint32(0), 2);
  assertEquals(view.getUint32(4), 2);
  assertEquals(header[8], 8); // eight bits a channel
  assertEquals(header[9], 2); // truecolour, no alpha

  // Every scanline is written unfiltered, so what comes back out of the zlib
  // stream is a filter byte and then the row, verbatim.
  // deno-fmt-ignore
  const scanlines = [
    0,  255, 0, 0,    0, 255, 0,
    0,  0, 0, 255,    255, 255, 255,
  ];
  assertEquals(Array.from(await inflate(chunkOf(png, "IDAT"))), scanlines);
});

Deno.test("refuses pixels that are not the size claimed", async () => {
  await assertRejects(
    () => encodePng(2, 2, new Uint8Array(11)),
    RangeError,
  );
});
