/**
 * 스프라이트 34장(frame_000~033) — 4열 행우선 그리드
 *
 * 패턴(0~33을 겹침 없이 채움):
 *   통 p1~p9 → 프레임 8,7,…,0     공식: 9 - n
 *   삭 s1~s9 → 프레임 17,16,…,9   공식: 18 - n
 *   만 m1~m9 → 프레임 26,25,…,18  공식: 27 - n
 *   자 z1~z7 → 프레임 27~33       공식: 26 + n
 *
 * 각 숫자패는 해당 무늬 블록 안에서 「9→1」역순으로 배치된 전형적인 아틀라스입니다.
 * 다른 시트면 아래 OVERRIDES에만 코드→프레임을 적으면 됩니다.
 */
export const SPRITE_W = 122;
export const SPRITE_H = 174;
export const ATLAS_W = 488;
export const ATLAS_H = 1566;

/** 예외 덮어쓰기 (필요 시만). 예: { m3: 2, p7: 24 } */
const OVERRIDES = /** @type {Record<string, number>} */ ({});

export function tileCodeToIndex(code) {
  if (!code || code === 'back') return null;
  if (OVERRIDES[code] !== undefined) return OVERRIDES[code];

  const suit = code[0];
  const n = parseInt(code.slice(1), 10);
  if (!Number.isFinite(n) || n < 1) return null;

  if (suit === 'p') {
    if (n > 9) return null;
    return 9 - n;
  }
  if (suit === 's') {
    if (n > 9) return null;
    return 18 - n;
  }
  if (suit === 'm') {
    if (n > 9) return null;
    return 27 - n;
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
  if (suit === 'm') return `${num}만`;
  if (suit === 'p') return `${num}통`;
  if (suit === 's') return `${num}삭`;
  const z = ['동', '남', '서', '북', '백', '발', '중'][n - 1] || code;
  return z;
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
