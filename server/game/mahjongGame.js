import { buildWall, shuffle, tileLabelKo } from './tiles.js';
import { isWinningHandWithOpen } from './winCheck.js';
import { chiTilePairs, canPon as handCanPon } from './melds.js';

const SEATS = 4;

function sortTiles(arr) {
  return [...arr].sort((a, b) => {
    const [sa, na] = [a[0], parseInt(a.slice(1), 10)];
    const [sb, nb] = [b[0], parseInt(b.slice(1), 10)];
    const o = { m: 0, p: 1, s: 2, z: 3 };
    if (o[sa] !== o[sb]) return o[sa] - o[sb];
    return na - nb;
  });
}

export function createMahjongState() {
  return {
    phase: 'idle',
    wall: [],
    deadWall: [],
    hands: /** @type {string[][]} */ ([[], [], [], []]),
    /** @type {Array<Array<{ type: 'pon' | 'chi', tiles: string[] }>>} */
    melds: [[], [], [], []],
    discards: /** @type {string[][]} */ ([[], [], [], []]),
    current: 0,
    lastDiscard: /** @type {{ seat: number, tile: string } | null} */ (null),
    waitingRon: false,
    ronPasses: /** @type {number[]} */ ([]),
    nextDrawer: /** @type {number | null} */ (null),
    /** 후로 응답 (하가→…) */
    waitingNaki: false,
    nakiDiscarder: /** @type {number} */ (0),
    nakiTile: /** @type {string | null} */ (null),
    nakiStep: 0,
    nakiCurrentSeat: /** @type {number | null} */ (null),
    nakiCanChi: false,
    nakiCanPon: false,
    /** 펑/치 직후 11장에서 1장 버릴 차례 */
    awaitingDiscardAfterMeld: /** @type {number | null} */ (null),
    dealer: 0,
    winner: /** @type {number | null} */ (null),
    winType: /** @type {'tsumo' | 'ron' | null} */ (null),
    error: /** @type {string | null} */ (null),
  };
}

/** @param {ReturnType<typeof createMahjongState>} st @param {number} dealerSeat */
export function startGame(st, dealerSeat = 0) {
  st.error = null;
  st.winner = null;
  st.winType = null;
  st.lastDiscard = null;
  st.waitingRon = false;
  st.ronPasses = [];
  st.nextDrawer = null;
  st.waitingNaki = false;
  st.nakiCurrentSeat = null;
  st.nakiTile = null;
  st.awaitingDiscardAfterMeld = null;
  st.dealer = dealerSeat % SEATS;
  st.current = st.dealer;
  for (let i = 0; i < SEATS; i++) st.melds[i] = [];

  const wall = shuffle(buildWall());
  const hands = [[], [], [], []];
  let idx = 0;
  for (let r = 0; r < 3; r++) {
    for (let s = 0; s < SEATS; s++) {
      const seat = (st.dealer + s) % SEATS;
      for (let k = 0; k < 4; k++) hands[seat].push(wall[idx++]);
    }
  }
  for (let s = 0; s < SEATS; s++) {
    const seat = (st.dealer + s) % SEATS;
    hands[seat].push(wall[idx++]);
  }
  for (let i = 0; i < SEATS; i++) {
    st.hands[i] = sortTiles(hands[i]);
    st.discards[i] = [];
  }
  st.wall = wall.slice(idx);
  st.deadWall = [];
  st.phase = 'playing';

  const draw = st.wall.shift();
  if (draw) st.hands[st.dealer].push(draw);
  st.hands[st.dealer] = sortTiles(st.hands[st.dealer]);
}

function handSize(st, seat) {
  return st.hands[seat].length;
}

/** @param {ReturnType<typeof createMahjongState>} st */
function removeClaimedDiscard(st) {
  const ld = st.lastDiscard;
  if (!ld) return false;
  const pile = st.discards[ld.seat];
  if (!pile.length || pile[pile.length - 1] !== ld.tile) return false;
  pile.pop();
  st.lastDiscard = null;
  return true;
}

/** @param {ReturnType<typeof createMahjongState>} st */
function drawForSeat(st, seat) {
  const d = st.wall.shift();
  if (!d) {
    st.phase = 'finished';
    st.winner = null;
    st.winType = null;
    st.current = -1;
    st.error = '유국(패 산) — 무승부';
    return false;
  }
  st.hands[seat].push(d);
  st.hands[seat] = sortTiles(st.hands[seat]);
  st.current = seat;
  return true;
}

/** @param {ReturnType<typeof createMahjongState>} st */
function finishNakiDraw(st) {
  const drawer = st.nextDrawer;
  st.nextDrawer = null;
  if (drawer === null) return;
  drawForSeat(st, drawer);
}

/** @param {ReturnType<typeof createMahjongState>} st */
function advanceNaki(st) {
  const D = st.nakiDiscarder;
  const order = [(D + 1) % SEATS, (D + 2) % SEATS, (D + 3) % SEATS];
  while (st.nakiStep < 3) {
    const seat = order[st.nakiStep];
    const tile = st.nakiTile;
    if (!tile) break;
    const canChi = seat === (D + 1) % SEATS && chiTilePairs(st.hands[seat], tile).length > 0;
    const canPon = handCanPon(st.hands[seat], tile);
    if (canChi || canPon) {
      st.nakiCurrentSeat = seat;
      st.nakiCanChi = canChi;
      st.nakiCanPon = canPon;
      return;
    }
    st.nakiStep++;
  }
  st.waitingNaki = false;
  st.nakiCurrentSeat = null;
  st.nakiCanChi = false;
  st.nakiCanPon = false;
  finishNakiDraw(st);
}

/** @param {ReturnType<typeof createMahjongState>} st */
function beginNakiPhase(st) {
  if (!st.lastDiscard) {
    finishNakiDraw(st);
    return;
  }
  st.waitingNaki = true;
  st.nakiDiscarder = st.lastDiscard.seat;
  st.nakiTile = st.lastDiscard.tile;
  st.nakiStep = 0;
  advanceNaki(st);
}

/**
 * @param {ReturnType<typeof createMahjongState>} st
 * @param {number} seat
 * @param {string} tile
 */
export function discardTile(st, seat, tile) {
  st.error = null;
  if (st.phase !== 'playing') {
    st.error = '게임 진행 중이 아닙니다.';
    return false;
  }
  if (seat !== st.current) {
    st.error = '당신 차례가 아닙니다.';
    return false;
  }
  const n = handSize(st, seat);
  const m = st.melds[seat].length;
  /** 오픈 멘쯔마다 손패 3장이 줄어듦 → 뽑은 직후·펑/치 직후 모두 (14 - 3m)장일 때만 버림 가능 */
  const expected = 14 - 3 * m;
  if (n !== expected) {
    st.error =
      n < expected
        ? '먼저 패를 뽑은 뒤 버려야 합니다.'
        : '손패 장수가 맞지 않습니다.';
    return false;
  }
  const h = st.hands[seat];
  const i = h.indexOf(tile);
  if (i === -1) {
    st.error = '손에 없는 패입니다.';
    return false;
  }
  h.splice(i, 1);
  st.discards[seat].push(tile);
  st.lastDiscard = { seat, tile };
  st.awaitingDiscardAfterMeld = null;
  st.waitingRon = true;
  st.ronPasses = [];
  st.nextDrawer = (seat + 1) % SEATS;
  st.current = -1;
  return true;
}

/** @param {ReturnType<typeof createMahjongState>} st @param {number} seat */
export function passRon(st, seat) {
  st.error = null;
  if (st.phase !== 'playing' || !st.waitingRon || !st.lastDiscard) {
    st.error = '론 대기 상태가 아닙니다.';
    return false;
  }
  const { seat: from } = st.lastDiscard;
  if (seat === from) {
    st.error = '본인 버림패에는 론할 수 없습니다.';
    return false;
  }
  if (st.ronPasses.includes(seat)) {
    st.error = '이미 패스했습니다.';
    return false;
  }
  st.ronPasses.push(seat);
  const need = SEATS - 1;
  if (st.ronPasses.length < need) return true;

  st.waitingRon = false;
  st.ronPasses = [];
  beginNakiPhase(st);
  return true;
}

/** @param {ReturnType<typeof createMahjongState>} st @param {number} seat */
export function passNaki(st, seat) {
  st.error = null;
  if (st.phase !== 'playing' || !st.waitingNaki || st.nakiCurrentSeat !== seat) {
    st.error = '후로 응답 차례가 아닙니다.';
    return false;
  }
  st.nakiStep++;
  advanceNaki(st);
  return true;
}

/** @param {ReturnType<typeof createMahjongState>} st @param {number} seat */
export function declarePon(st, seat) {
  st.error = null;
  if (st.phase !== 'playing' || !st.waitingNaki || st.nakiCurrentSeat !== seat || !st.nakiCanPon) {
    st.error = '펑을 할 수 없습니다.';
    return false;
  }
  const t = st.nakiTile;
  if (!t || !handCanPon(st.hands[seat], t)) {
    st.error = '펑 불가 패입니다.';
    return false;
  }
  if (!removeClaimedDiscard(st)) {
    st.error = '버림패를 가져올 수 없습니다.';
    return false;
  }
  const h = st.hands[seat];
  let removed = 0;
  for (let i = h.length - 1; i >= 0 && removed < 2; i--) {
    if (h[i] === t) {
      h.splice(i, 1);
      removed++;
    }
  }
  if (removed !== 2) {
    st.error = '손패 오류';
    return false;
  }
  st.melds[seat].push({ type: 'pon', tiles: sortTiles([t, t, t]) });
  st.hands[seat] = sortTiles(h);
  st.waitingNaki = false;
  st.nakiCurrentSeat = null;
  st.nakiCanChi = false;
  st.nakiCanPon = false;
  st.awaitingDiscardAfterMeld = seat;
  st.current = seat;
  st.nakiTile = null;
  return true;
}

/**
 * @param {ReturnType<typeof createMahjongState>} st
 * @param {number} seat
 * @param {string} tileA
 * @param {string} tileB
 */
export function declareChi(st, seat, tileA, tileB) {
  st.error = null;
  if (st.phase !== 'playing' || !st.waitingNaki || st.nakiCurrentSeat !== seat || !st.nakiCanChi) {
    st.error = '치를 할 수 없습니다.';
    return false;
  }
  const t = st.nakiTile;
  if (!t) return false;
  const pairs = chiTilePairs(st.hands[seat], t);
  const ok = pairs.some(
    ([a, b]) => (a === tileA && b === tileB) || (a === tileB && b === tileA)
  );
  if (!ok) {
    st.error = '선택한 치 조합이 맞지 않습니다.';
    return false;
  }
  if (!removeClaimedDiscard(st)) {
    st.error = '버림패를 가져올 수 없습니다.';
    return false;
  }
  const h = st.hands[seat];
  for (const rm of [tileA, tileB]) {
    const ix = h.indexOf(rm);
    if (ix === -1) {
      st.error = '손에 없는 패입니다.';
      return false;
    }
    h.splice(ix, 1);
  }
  st.melds[seat].push({ type: 'chi', tiles: sortTiles([tileA, tileB, t]) });
  st.hands[seat] = sortTiles(h);
  st.waitingNaki = false;
  st.nakiCurrentSeat = null;
  st.nakiCanChi = false;
  st.nakiCanPon = false;
  st.awaitingDiscardAfterMeld = seat;
  st.current = seat;
  st.nakiTile = null;
  return true;
}

/**
 * @param {ReturnType<typeof createMahjongState>} st
 * @param {number} seat
 */
export function declareTsumo(st, seat) {
  st.error = null;
  if (seat < 0 || seat >= SEATS) {
    st.error = '잘못된 좌석입니다.';
    return false;
  }
  if (st.phase !== 'playing') {
    st.error = '게임 진행 중이 아닙니다.';
    return false;
  }
  if (seat !== st.current) {
    st.error = '쯔모는 자기 차례에만 가능합니다.';
    return false;
  }
  const m = st.melds[seat].length;
  if (handSize(st, seat) !== 14 - 3 * m) {
    st.error = '패 장수가 맞지 않습니다.';
    return false;
  }
  const sorted = sortTiles(st.hands[seat]);
  const open = m;
  if (!isWinningHandWithOpen(sorted, open)) {
    st.error = '화료 패가 아닙니다.';
    return false;
  }
  st.waitingRon = false;
  st.ronPasses = [];
  st.nextDrawer = null;
  st.waitingNaki = false;
  st.nakiCurrentSeat = null;
  st.nakiCanChi = false;
  st.nakiCanPon = false;
  st.awaitingDiscardAfterMeld = null;
  st.lastDiscard = null;
  st.nakiTile = null;
  st.current = -1;
  st.phase = 'finished';
  st.winner = seat;
  st.winType = 'tsumo';
  return true;
}

/**
 * @param {ReturnType<typeof createMahjongState>} st
 * @param {number} seat
 */
export function declareRon(st, seat) {
  st.error = null;
  if (seat < 0 || seat >= SEATS) {
    st.error = '잘못된 좌석입니다.';
    return false;
  }
  if (st.phase !== 'playing') {
    st.error = '게임 진행 중이 아닙니다.';
    return false;
  }
  if (!st.waitingRon || !st.lastDiscard || st.lastDiscard.seat === seat) {
    st.error = '론할 수 있는 버림패가 없습니다.';
    return false;
  }
  const m = st.melds[seat].length;
  if (handSize(st, seat) !== 13 - 3 * m) {
    st.error = '론은 올바른 손패 장수일 때만 가능합니다.';
    return false;
  }
  const tile = st.lastDiscard.tile;
  const trial = sortTiles([...st.hands[seat], tile]);
  const open = m;
  if (!isWinningHandWithOpen(trial, open)) {
    st.error = '론 불가 패입니다.';
    return false;
  }
  st.waitingRon = false;
  st.ronPasses = [];
  st.nextDrawer = null;
  st.waitingNaki = false;
  st.nakiCurrentSeat = null;
  st.nakiCanChi = false;
  st.nakiCanPon = false;
  st.awaitingDiscardAfterMeld = null;
  st.lastDiscard = null;
  st.nakiTile = null;
  st.current = -1;
  st.phase = 'finished';
  st.winner = seat;
  st.winType = 'ron';
  return true;
}

/** Public snapshot for clients (hide others' tiles; 종료 후 전원 공개). */
export function publicSnapshot(st, viewerSeat) {
  const reveal = st.phase === 'finished';
  const hands = st.hands.map((h, i) =>
    reveal || i === viewerSeat ? sortTiles(h) : h.map(() => 'back')
  );
  const melds = st.melds.map((m) => m.map((x) => ({ type: x.type, tiles: [...x.tiles] })));

  let nakiChiPairs = /** @type {Array<[string, string]>} */ ([]);
  if (
    st.waitingNaki &&
    st.nakiCurrentSeat === viewerSeat &&
    st.nakiCanChi &&
    st.nakiTile
  ) {
    nakiChiPairs = chiTilePairs(st.hands[viewerSeat], st.nakiTile);
  }

  return {
    phase: st.phase,
    current: st.current,
    dealer: st.dealer,
    discards: st.discards,
    melds,
    hands,
    wallLeft: st.wall.length,
    lastDiscard: st.lastDiscard,
    waitingRon: st.waitingRon,
    nextDrawer: st.nextDrawer,
    ronPasses: [...st.ronPasses],
    waitingNaki: st.waitingNaki,
    nakiCurrentSeat: st.nakiCurrentSeat,
    nakiCanChi: st.nakiCanChi && st.nakiCurrentSeat === viewerSeat,
    nakiCanPon: st.nakiCanPon && st.nakiCurrentSeat === viewerSeat,
    nakiChiPairs,
    awaitingDiscardAfterMeld: st.awaitingDiscardAfterMeld,
    winner: st.winner,
    winType: st.winType,
    error: st.error,
    reveal,
  };
}

export function handSnapshotForSeat(st, seat) {
  return {
    tiles: sortTiles(st.hands[seat]),
    labels: sortTiles(st.hands[seat]).map(tileLabelKo),
  };
}

export { SEATS, sortTiles, tileLabelKo };
