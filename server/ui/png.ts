/**
 * A minimal PNG writer, for the one image this hub draws itself.
 *
 * Social crawlers do not render SVG — X, Facebook, Slack and LINE all want a
 * raster — so the share card cannot be the same drawing the launcher icon is.
 * Rather than commit a binary blob nobody can diff, or pull in an image
 * library for a picture made of rectangles, the card is drawn in code and
 * encoded here.
 *
 * There is no compressor to write: `CompressionStream("deflate")` produces
 * exactly the zlib stream PNG's `IDAT` asks for. What is left is the chunk
 * framing and CRC-32, which is the short half.
 */

/** `\x89PNG\r\n\x1a\n` — the signature every PNG starts with. */
const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array<ArrayBuffer>): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, payload, CRC of the type and payload. */
function chunk(
  type: string,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encode 8-bit RGB pixels as a PNG.
 *
 * Every scanline is written with filter 0 (none). Filters exist to make a
 * photograph compress; this image is flat blocks of colour, where whole rows
 * repeat and deflate finds them on its own.
 *
 * @param width Image width in pixels
 * @param height Image height in pixels
 * @param pixels `width * height * 3` bytes, red-green-blue, row by row
 */
export async function encodePng(
  width: number,
  height: number,
  pixels: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const stride = width * 3;
  if (pixels.length !== stride * height) {
    throw new RangeError(
      `expected ${stride * height} bytes of RGB, got ${pixels.length}`,
    );
  }

  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(
      pixels.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour, no alpha

  const parts = [
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", await deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
