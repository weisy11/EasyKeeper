/** MD5 hex digest of raw bytes. */
export function md5(bytes: Uint8Array): string {
  const words = new Uint32Array(16);
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 8) >>> 6 << 6) + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 0x100000000), true);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, true);
    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;
    for (let i = 0; i < 64; i += 1) {
      const round = i >>> 4;
      const f = round === 0 ? (bb & cc) | (~bb & dd) : round === 1 ? (bb & dd) | (cc & ~dd) : round === 2 ? bb ^ cc ^ dd : cc ^ (bb | ~dd);
      const g = round === 0 ? i : round === 1 ? (i * 5 + 1) % 16 : round === 2 ? (i * 3 + 5) % 16 : (i * 7) % 16;
      const next = dd;
      dd = cc;
      cc = bb;
      const sum = (aa + f + K[i] + words[g]) >>> 0;
      bb = (bb + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
      aa = next;
    }
    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
  }
  return [a, b, c, d].map(hexWord).join("");
}

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);

function hexWord(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
