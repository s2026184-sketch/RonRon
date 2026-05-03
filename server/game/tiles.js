/** @typedef {{ suit: 'm'|'p'|'s'|'z', n: number }} ParsedTile */

/** @param {string} t */
export function parseTile(t) {
  const suit = /** @type {'m'|'p'|'s'|'z'} */ (t[0]);
  const n = parseInt(t.slice(1), 10);
  return { suit, n };
}

export function normalizeTile(t) {
  return t.endsWith('r') ? t.slice(0, -1) : t;
}

export function tileKey(suit, n) {
  return `${suit}${n}`;
}

/** Full 136-tile set (Riichi-style, no flowers). */
export function buildWall() {
  const tiles = [];
  for (const suit of ['m', 'p', 's']) {
    for (let n = 1; n <= 9; n++) {
      const k = tileKey(suit, n);
      for (let i = 0; i < 4; i++) tiles.push(k);
    }
  }
  for (let n = 1; n <= 7; n++) {
    const k = tileKey('z', n);
    for (let i = 0; i < 4; i++) tiles.push(k);
  }
  return tiles;
}

/** Fisher–Yates shuffle in place */
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** @param {string} t */
export function tileLabelKo(t) {
  const { suit, n } = parseTile(t);
  const num = '일이삼사오육칠팔구'.split('')[n - 1] || String(n);
  if (suit === 'm') return `${num}만`;
  if (suit === 'p') return `${num}통`;
  if (suit === 's') return `${num}삭`;
  const z = ['동', '남', '서', '북', '백', '발', '중'][n - 1] || `z${n}`;
  return z;
}
