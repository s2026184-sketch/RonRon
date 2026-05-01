/**
/**
 * 스프라이트 37장(frame_000~036) — 4열 행우선 그리드
 *
 * 새로운 패 순서(코드 매칭 기준):
 *   만 m1~m9 → 인덱스 0~8
 *   통 p1~p9 → 인덱스 9~17
 *   삭 s1~s9 → 인덱스 18~26
 *   자 z1~z7 → 인덱스 27~33
 *   홍5 m5r/p5r/s5r → 인덱스 34~36
 *
 * 즉 `만→통→삭→동남서북→백발중→적(만통삭)` 순서입니다.
 */
export const SPRITE_W = 122;
export const SPRITE_H = 174;
export const ATLAS_W = 488;
export const ATLAS_H = 1740;

/** 예외 덮어쓰기 (필요 시만). 예: { m3: 2, p7: 24 } */
const OVERRIDES = /** @type {Record<string, number>} */ ({
  'm5r': 34,
  'p5r': 35,
  's5r': 36,
});

export function tileCodeToIndex(code) {
  if (!code || code === 'back') return null;
  if (OVERRIDES[code] !== undefined) return OVERRIDES[code];

  const suit = code[0];
  const n = parseInt(code.slice(1), 10);
  if (!Number.isFinite(n) || n < 1) return null;

  if (suit === 'm') {
    if (n > 9) return null;
    return n - 1;
  }
  if (suit === 'p') {
    if (n > 9) return null;
    return 9 + (n - 1);
  }
  if (suit === 's') {
    if (n > 9) return null;
    return 18 + (n - 1);
  }
  if (suit === 'z') {
    if (n > 7) return null;
    return 26 + n;
  }

  return null;
}

export function tileTitleKo(code) {
  if (code === 'back') return '뒷면';
  const suit = code[0];
  const n = parseInt(code.slice(1), 10);
  const num = '일이삼사오육칠팔구'.split('')[n - 1] || String(n);
  if (code === 'm5r') return '홍5만';
  if (code === 'p5r') return '홍5통';
  if (code === 's5r') return '홍5삭';
  if (suit === 'm') return `${num}만`;
  if (suit === 'p') return `${num}통`;
  if (suit === 's') return `${num}삭`;
  const z = ['동', '남', '서', '북', '백', '발', '중'][n - 1] || code;
  return z;
}
/** @param {string} tile - Get the next tile in sequence (for dora) */
export function nextTile(tile) {
  const suit = tile[0];
  const n = parseInt(tile.slice(1), 10);
  if (suit === 'z') {
    if (n === 7) return 'z1'; // 중 -> 동
    return `z${n + 1}`;
  }
  if (n === 9) {
    const nextSuit = suit === 'm' ? 'p' : suit === 'p' ? 's' : 'z';
    return `${nextSuit}1`;
  }
  return `${suit}${n + 1}`;
}
/**
 * @param {string} code
 * @param {{ size?: number, clickable?: boolean, onClick?: () => void, highlight?: boolean, className?: string }} opts
 */
export function createTileElement(code, opts = {}) {
  const { size = 40, clickable = false, onClick, highlight = false, className = '' } = opts;
  const idx = tileCodeToIndex(code);
  const isBack = code === 'back' || idx === null;
  const el = document.createElement(clickable ? 'button' : 'span');
  if (clickable) el.type = 'button';
  el.className =
    'tile-sprite' +
    (isBack ? ' tile-sprite--back' : '') +
    (highlight ? ' tile-sprite--last' : '') +
    (clickable ? ' tile-sprite--click' : '') +
    (className ? ` ${className}` : '');
  el.title = tileTitleKo(isBack ? 'back' : code);
  el.setAttribute('aria-label', el.title);

  const h = Math.round((size * SPRITE_H) / SPRITE_W);
  el.style.width = `${size}px`;
  el.style.height = `${h}px`;

  if (isBack) return el;

  const col = idx % 4;
  const row = (idx / 4) | 0;
  const f = size / SPRITE_W;
  el.style.backgroundImage = 'url(/game-assets/spritesheet.png)';
  el.style.backgroundSize = `${ATLAS_W * f}px ${ATLAS_H * f}px`;
  el.style.backgroundPosition = `${-col * SPRITE_W * f}px ${-row * SPRITE_H * f}px`;

  if (clickable && onClick) el.addEventListener('click', onClick);
  return el;
}
