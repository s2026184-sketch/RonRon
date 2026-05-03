import { normalizeTile, parseTile, tileKey } from './tiles.js';

/** @param {string[]} hand
 * @param {string} discard
 * @returns {Array<[string, string]>} 손패에서 낼 수 있는 순서쌍
 */
export function chiTilePairs(hand, discard) {
  const { suit, n } = parseTile(discard);
  if (suit === 'z') return [];
  const has = (t) => hand.filter((x) => normalizeTile(x) === normalizeTile(t)).length;
  const opts = [];

  if (n >= 3) {
    const a = tileKey(suit, n - 2);
    const b = tileKey(suit, n - 1);
    if (has(a) >= 1 && has(b) >= 1) opts.push([a, b]);
  }
  if (n >= 2 && n <= 8) {
    const a = tileKey(suit, n - 1);
    const b = tileKey(suit, n + 1);
    if (has(a) >= 1 && has(b) >= 1) opts.push([a, b]);
  }
  if (n <= 7) {
    const a = tileKey(suit, n + 1);
    const b = tileKey(suit, n + 2);
    if (has(a) >= 1 && has(b) >= 1) opts.push([a, b]);
  }
  const seen = new Set();
  return opts.filter(([a, b]) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** @param {string[]} hand @param {string} t */
export function canPon(hand, t) {
  return hand.filter((x) => normalizeTile(x) === normalizeTile(t)).length >= 2;
}
