import { normalizeTile, parseTile, tileKey } from './tiles.js';

/**
 * 멘탄: (n-2)가 3의 배수일 때, n장에서 대기 1쌍 + 나머지 멘쯔.
 * @param {string[]} tiles sorted
 */
export function isWinningHandGeneral(tiles) {
  const n = tiles.length;
  if (n < 2 || (n - 2) % 3 !== 0) return false;
  const counts = {};
  for (const t of tiles) {
    const normalized = normalizeTile(t);
    counts[normalized] = (counts[normalized] || 0) + 1;
  }
  const keys = Object.keys(counts).sort(compareTiles);
  for (const pairTile of keys) {
    if (counts[pairTile] < 2) continue;
    const c = { ...counts };
    c[pairTile] -= 2;
    if (c[pairTile] === 0) delete c[pairTile];
    if (canFormAllMelds(c)) return true;
  }
  return false;
}

/**
 * Standard 4 멘쯔 + 1 대기(머리), 14장. 자패는 순자 불가.
 * @param {string[]} tiles14 sorted length 14
 */
export function isWinningHand(tiles14) {
  return tiles14.length === 14 && isWinningHandGeneral(tiles14);
}

/**
 * 오픈 후로 m개(각 3장) + 손패가 멘탄이면 화료.
 * @param {string[]} concealedSorted
 * @param {number} openGroupCount 후로로 이미 고정된 멘쯔 개수
 */
export function isWinningHandWithOpen(concealedSorted, openGroupCount) {
  const needGroups = 4 - openGroupCount;
  const needLen = 3 * needGroups + 2;
  if (concealedSorted.length !== needLen) return false;
  return isWinningHandGeneral(concealedSorted);
}

/** @param {Record<string, number>} counts */
function canFormAllMelds(counts) {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0).sort(compareTiles);
  if (keys.length === 0) return true;
  const first = keys[0];
  const n = counts[first];

  // triplet
  if (n >= 3) {
    const c = { ...counts };
    c[first] -= 3;
    if (c[first] === 0) delete c[first];
    if (canFormAllMelds(c)) return true;
  }

  // sequence (only numbered suits)
  const { suit, n: v } = parseTile(first);
  if (suit !== 'z' && v <= 7) {
    const t2 = tileKey(suit, v + 1);
    const t3 = tileKey(suit, v + 2);
    if ((counts[t2] || 0) >= 1 && (counts[t3] || 0) >= 1) {
      const c = { ...counts };
      c[first]--;
      c[t2]--;
      c[t3]--;
      for (const k of [first, t2, t3]) {
        if (c[k] === 0) delete c[k];
      }
      if (canFormAllMelds(c)) return true;
    }
  }

  return false;
}

/** @param {string} a @param {string} b */
function compareTiles(a, b) {
  const pa = parseTile(a);
  const pb = parseTile(b);
  const order = { m: 0, p: 1, s: 2, z: 3 };
  if (order[pa.suit] !== order[pb.suit]) return order[pa.suit] - order[pb.suit];
  return pa.n - pb.n;
}
