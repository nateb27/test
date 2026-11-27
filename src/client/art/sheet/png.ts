/**
 * Minimal decoder for the indexed (colour type 3) PNG sheets of the pre-rendered art. Returns the palette indices
 * themselves, not colours: the sheet layout gives index ranges a meaning (ground shadow, outline, player-colour ramp)
 * and the team indices are re-coloured per player. Decoding ourselves also keeps browser colour management out.
 * Uses the platform's DecompressionStream (browsers and Node 18+).
 */

export interface IndexedPng {
  readonly width: number;
  readonly height: number;
  /** One palette index per pixel, row-major. */
  readonly indices: Uint8Array;
  /** 256 x RGB. */
  readonly palette: Uint8Array;
  /** 256 alpha values (tRNS; 255 where absent). */
  readonly alpha: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export async function decodeIndexedPng(bytes: Uint8Array): Promise<IndexedPng> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  const palette = new Uint8Array(256 * 3);
  const alpha = new Uint8Array(256).fill(255);
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      const hv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = hv.getUint32(0);
      height = hv.getUint32(4);
      depth = body[8]!;
      if (body[9] !== 3) throw new Error('PNG is not indexed');
      if (body[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'PLTE') palette.set(body.subarray(0, Math.min(body.length, 768)));
    else if (type === 'tRNS') alpha.set(body.subarray(0, Math.min(body.length, 256)));
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (width <= 0 || height <= 0) throw new Error('PNG without IHDR');
  let n = 0;
  for (const c of idat) n += c.length;
  const z = new Uint8Array(n);
  let o = 0;
  for (const c of idat) {
    z.set(c, o);
    o += c.length;
  }
  const raw = await inflate(z);
  const stride = Math.ceil((width * depth) / 8);
  if (raw.length < (stride + 1) * height) throw new Error('PNG data truncated');
  const rows = new Uint8Array(stride * height);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const a = x > 0 ? rows[dst + x - 1]! : 0;
      const b = prev[x]!;
      const c = x > 0 ? (y > 0 ? rows[dst - stride + x - 1]! : 0) : 0;
      let r: number;
      switch (ft) {
        case 0:
          r = v;
          break;
        case 1:
          r = v + a;
          break;
        case 2:
          r = v + b;
          break;
        case 3:
          r = v + ((a + b) >> 1);
          break;
        case 4:
          r = v + paeth(a, b, c);
          break;
        default:
          throw new Error(`bad PNG filter ${ft}`);
      }
      rows[dst + x] = r & 255;
    }
    prev.set(rows.subarray(dst, dst + stride));
  }
  let indices = rows;
  if (depth !== 8) {
    indices = new Uint8Array(width * height);
    const per = 8 / depth;
    const mask = (1 << depth) - 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = rows[y * stride + Math.floor(x / per)]!;
        const shift = 8 - depth * ((x % per) + 1);
        indices[y * width + x] = (byte >> shift) & mask;
      }
    }
  }
  return { width, height, indices, palette, alpha };
}
