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
    /** @type {Array<Array<{ type: 'pon' | 'chi' | 'kan', subType?: 'ankan' | 'daiminkan' | 'kakan', tiles: string[] }>>} */
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
    /** 점수 시스템 */
    scores: /** @type {number[]} */ ([25000, 25000, 25000, 25000]), // 초기 점수
    prevalentWind: 0, // 장풍 (0:동, 1:남, 2:서, 3:북)
    gameMode: 'normal', // 'normal' or 'tonpufu' (동풍전)
    round: 1, // 동풍전 판 번호 (1-4)
    honba: 0, // 본장
    riichi: /** @type {boolean[]} */ ([false, false, false, false]), // 리치 상태
    yaku: /** @type {Array<{ name: string, han: number }[]>} */ ([], [], [], []), // 역패 목록
    fu: /** @type {number[]} */ ([0, 0, 0, 0]), // 부수
    han: /** @type {number[]} */ ([0, 0, 0, 0]), // 합
    points: /** @type {number[]} */ ([0, 0, 0, 0]), // 최종 점수
    doraIndicators: /** @type {string[]} */ ([]), // 도라 표시패
    uraDoraIndicators: /** @type {string[]} */ ([]), // 우라도라 표시패 (리치 시 공개)
    kanCount: 0,
    pendingKanRon: false,
    lastDraw: /** @type {{ seat: number, tile: string } | null} */ (null),
  };
}

/** @param {ReturnType<typeof createMahjongState>} st @param {number} dealerSeat @param {string} gameMode */
export function startGame(st, dealerSeat = 0, gameMode = 'normal', round = 1, honba = 0) {
  st.error = null;
  st.winner = null;
  st.winType = null;
  st.gameMode = gameMode;
  st.round = round;
  st.honba = honba;
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
  st.deadWall = st.wall.slice(0, 14);
  st.wall = st.wall.slice(14);
  st.phase = 'playing';

  // 도라 표시패 초기화
  st.doraIndicators = [];
  st.uraDoraIndicators = [];
  addDoraIndicator(st);

  const draw = st.wall.shift();
  if (draw) {
    st.hands[st.dealer].push(draw);
    st.lastDraw = { seat: st.dealer, tile: draw };
  } else {
    st.lastDraw = null;
  }
  st.hands[st.dealer] = sortTiles(st.hands[st.dealer]);

  // 점수 및 역패 초기화
  st.riichi = [false, false, false, false];
  st.yaku = [[], [], [], []];
  st.fu = [0, 0, 0, 0];
  st.han = [0, 0, 0, 0];
  st.points = [0, 0, 0, 0];
  st.kanCount = 0;
  st.pendingKanRon = false;
}

function handSize(st, seat) {
  return st.hands[seat].length;
}

function countTile(hand, tile) {
  return hand.filter((t) => t === tile).length;
}

function handCanKan(hand, tile) {
  return countTile(hand, tile) >= 3;
}

function hasOpenPon(melds, tile) {
  return melds.some(
    (m) => m.type === 'pon' && m.tiles.length === 3 && m.tiles.every((x) => x === tile)
  );
}

function findOpenPonKanTile(hand, melds) {
  for (const meld of melds) {
    if (meld.type === 'pon' && meld.tiles.length === 3) {
      const tile = meld.tiles[0];
      if (countTile(hand, tile) >= 1) return tile;
    }
  }
  return null;
}

function findAnkanTile(hand) {
  const counts = {};
  for (const tile of hand) {
    counts[tile] = (counts[tile] || 0) + 1;
    if (counts[tile] >= 4) return tile;
  }
  return null;
}

function drawRinshan(st) {
  const draw = st.deadWall.shift() || st.wall.shift();
  if (!draw) return null;
  st.hands[st.current].push(draw);
  st.hands[st.current] = sortTiles(st.hands[st.current]);
  st.lastDraw = { seat: st.current, tile: draw };
  return draw;
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
  st.lastDraw = { seat, tile: d };
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
  if (st.riichi[seat] && st.lastDraw?.seat === seat && tile !== st.lastDraw.tile) {
    st.error = '리치 후에는 뽑은 패만 버릴 수 있습니다.';
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
  st.lastDraw = null;
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

  if (st.pendingKanRon) {
    st.waitingRon = false;
    st.pendingKanRon = false;
    st.ronPasses = [];
    st.lastDiscard = null;
    if (st.kanCount >= 4) {
      st.phase = 'finished';
      st.current = -1;
      st.error = '사깡유국 — 깡 4회로 유국';
      return true;
    }
    drawRinshan(st);
    return true;
  }

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
 * @param {string | null} tile
 */
export function declareKan(st, seat, tile = null) {
  st.error = null;
  const isCurrentTurn = st.phase === 'playing' && st.current === seat;
  const isWaitingNakiKan =
    st.phase === 'playing' &&
    st.waitingNaki &&
    st.nakiCurrentSeat === seat &&
    Boolean(st.nakiTile) &&
    handCanKan(st.hands[seat], st.nakiTile);

  if (!isCurrentTurn && !isWaitingNakiKan) {
    st.error = '깡을 할 수 있는 상태가 아닙니다.';
    return false;
  }

  if (isWaitingNakiKan) {
    const t = st.nakiTile;
    if (!t) {
      st.error = '깡할 패가 없습니다.';
      return false;
    }
    if (!removeClaimedDiscard(st)) {
      st.error = '버림패를 가져올 수 없습니다.';
      return false;
    }
    const h = st.hands[seat];
    let removed = 0;
    for (let i = h.length - 1; i >= 0 && removed < 3; i--) {
      if (h[i] === t) {
        h.splice(i, 1);
        removed++;
      }
    }
    if (removed !== 3) {
      st.error = '손패 오류';
      return false;
    }
    st.melds[seat].push({ type: 'kan', subType: 'daiminkan', tiles: sortTiles([t, t, t, t]) });
    st.hands[seat] = sortTiles(h);
    st.kanCount += 1;
    addKanDoraIndicator(st);
    st.waitingNaki = false;
    st.nakiCurrentSeat = null;
    st.nakiCanChi = false;
    st.nakiCanPon = false;
    st.awaitingDiscardAfterMeld = seat;
    st.nakiTile = null;
    st.current = seat;
    if (st.kanCount >= 4) {
      st.phase = 'finished';
      st.current = -1;
      st.error = '사깡유국 — 깡 4회로 유국';
      return true;
    }
    drawRinshan(st);
    return true;
  }

  if (st.waitingRon || st.waitingNaki) {
    st.error = '현재 깡을 선언할 수 없습니다.';
    return false;
  }

  const hand = st.hands[seat];
  const openKanTile = findOpenPonKanTile(hand, st.melds[seat]);
  const ankanTile = findAnkanTile(hand);
  let chosenTile = tile;
  if (!chosenTile) {
    chosenTile = openKanTile || ankanTile;
  }
  if (!chosenTile) {
    st.error = '깡할 수 있는 패가 없습니다.';
    return false;
  }

  let isKakan = false;
  if (openKanTile === chosenTile && hasOpenPon(st.melds[seat], chosenTile)) {
    const meldIndex = st.melds[seat].findIndex(
      (m) => m.type === 'pon' && m.tiles.length === 3 && m.tiles.every((x) => x === chosenTile)
    );
    if (meldIndex === -1) {
      st.error = '가캉 불가';
      return false;
    }
    const h = st.hands[seat];
    const ix = h.lastIndexOf(chosenTile);
    if (ix === -1) {
      st.error = '손패 오류';
      return false;
    }
    h.splice(ix, 1);
    st.melds[seat][meldIndex] = {
      type: 'kan',
      subType: 'kakan',
      tiles: sortTiles([chosenTile, chosenTile, chosenTile, chosenTile]),
    };
    st.hands[seat] = sortTiles(h);
    isKakan = true;
  } else if (ankanTile === chosenTile && countTile(hand, chosenTile) >= 4) {
    const h = st.hands[seat];
    let removed = 0;
    for (let i = h.length - 1; i >= 0 && removed < 4; i--) {
      if (h[i] === chosenTile) {
        h.splice(i, 1);
        removed++;
      }
    }
    if (removed !== 4) {
      st.error = '손패 오류';
      return false;
    }
    st.melds[seat].push({ type: 'kan', subType: 'ankan', tiles: sortTiles([chosenTile, chosenTile, chosenTile, chosenTile]) });
    st.hands[seat] = sortTiles(h);
  } else {
    st.error = '깡 선언 방식이 맞지 않습니다.';
    return false;
  }

  st.kanCount += 1;
  addKanDoraIndicator(st);
  st.lastDraw = null;
  if (isKakan) {
    st.pendingKanRon = true;
    st.waitingRon = true;
    st.ronPasses = [];
    st.lastDiscard = { seat, tile: chosenTile };
    st.nextDrawer = null;
    st.current = -1;
    return true;
  }

  st.awaitingDiscardAfterMeld = seat;
  st.current = seat;
  if (st.kanCount >= 4) {
    st.phase = 'finished';
    st.current = -1;
    st.error = '사깡유국 — 깡 4회로 유국';
    return true;
  }
  drawRinshan(st);
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
export function declareRiichi(st, seat) {
  st.error = null;
  if (st.phase !== 'playing') {
    st.error = '게임 진행 중이 아닙니다.';
    return false;
  }
  if (seat !== st.current) {
    st.error = '리치는 자기 차례에만 가능합니다.';
    return false;
  }
  if (st.riichi[seat]) {
    st.error = '이미 리치했습니다.';
    return false;
  }
  if (st.melds[seat].length > 0) {
    st.error = '멘젠 상태에서만 리치할 수 있습니다.';
    return false;
  }
  if (!st.lastDraw || st.lastDraw.seat !== seat) {
    st.error = '리치는 뽑은 직후에만 선언할 수 있습니다.';
    return false;
  }
  if (st.scores[seat] < 1000) {
    st.error = '리치하려면 1000점 이상이 필요합니다.';
    return false;
  }
  if (!isTenpai(st, seat)) {
    st.error = '텐파이 상태에서만 리치할 수 있습니다.';
    return false;
  }

  st.riichi[seat] = true;
  st.scores[seat] -= 1000;
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
  
  // 점수 계산
  st.yaku[seat] = calculateYaku(st, seat, true, st.hands[seat]);
  st.fu[seat] = calculateFu(st, seat, st.yaku[seat], true, st.hands[seat]);
  st.han[seat] = st.yaku[seat].reduce((sum, y) => sum + y.han, 0);
  if (st.han[seat] <= 0) {
    st.error = '역패가 없어 쯔모할 수 없습니다.';
    return false;
  }
  const score = calculatePointValues(st.fu[seat], st.han[seat], seat === st.dealer, true);
  st.points[seat] = score.total;
  const prevScores = [...st.scores];
  applyScoreSettlement(st, seat, true, score);
  st.scoreChanges = st.scores.map((s, i) => s - prevScores[i]);
  
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
  
  // 점수 계산
  st.yaku[seat] = calculateYaku(st, seat, false, trial);
  st.fu[seat] = calculateFu(st, seat, st.yaku[seat], false, trial);
  st.han[seat] = st.yaku[seat].reduce((sum, y) => sum + y.han, 0);
  if (st.han[seat] <= 0) {
    st.error = '역패가 없어 론할 수 없습니다.';
    return false;
  }
  const score = calculatePointValues(st.fu[seat], st.han[seat], seat === st.dealer, false);
  st.points[seat] = score.total;
  const prevScores = [...st.scores];
  applyScoreSettlement(st, seat, false, score);
  st.scoreChanges = st.scores.map((s, i) => s - prevScores[i]);
  
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

  let canRon = false;
  if (
    st.waitingRon &&
    st.lastDiscard &&
    st.lastDiscard.seat !== viewerSeat &&
    viewerSeat >= 0 &&
    viewerSeat < SEATS
  ) {
    const m = st.melds[viewerSeat].length;
    if (handSize(st, viewerSeat) === 13 - 3 * m) {
      const trial = sortTiles([...st.hands[viewerSeat], st.lastDiscard.tile]);
      canRon = isWinningHandWithOpen(trial, m);
    }
  }

  let canTsumo = false;
  if (
    st.phase === 'playing' &&
    !st.waitingRon &&
    !st.waitingNaki &&
    st.current === viewerSeat &&
    viewerSeat >= 0 &&
    viewerSeat < SEATS
  ) {
    const m = st.melds[viewerSeat].length;
    if (handSize(st, viewerSeat) === 14 - 3 * m) {
      const sorted = sortTiles(st.hands[viewerSeat]);
      canTsumo = isWinningHandWithOpen(sorted, m);
    }
  }

  let canKan = false;
  if (viewerSeat >= 0 && viewerSeat < SEATS) {
    if (st.waitingNaki && st.nakiCurrentSeat === viewerSeat && st.nakiTile) {
      canKan = handCanKan(st.hands[viewerSeat], st.nakiTile);
    } else if (
      st.phase === 'playing' &&
      !st.waitingRon &&
      !st.waitingNaki &&
      st.current === viewerSeat
    ) {
      const hand = st.hands[viewerSeat];
      if (findAnkanTile(hand)) {
        canKan = true;
      } else if (findOpenPonKanTile(hand, st.melds[viewerSeat])) {
        canKan = true;
      }
    }
  }

  let canRiichi = false;
  if (
    st.phase === 'playing' &&
    !st.waitingRon &&
    !st.waitingNaki &&
    st.current === viewerSeat &&
    viewerSeat >= 0 &&
    viewerSeat < SEATS &&
    !st.riichi[viewerSeat] &&
    st.scores[viewerSeat] >= 1000 &&
    st.melds[viewerSeat].length === 0 &&
    st.lastDraw?.seat === viewerSeat &&
    isTenpai(st, viewerSeat)
  ) {
    canRiichi = true;
  }

  let canChi = false;
  let canPon = false;
  let canPassNaki = false;
  if (st.waitingNaki && st.nakiCurrentSeat === viewerSeat) {
    canChi = st.nakiCanChi;
    canPon = st.nakiCanPon;
    canPassNaki = true;
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
    canRon,
    canTsumo,
    canChi,
    canPon,
    canKan,
    canPassNaki,
    awaitingDiscardAfterMeld: st.awaitingDiscardAfterMeld,
    winner: st.winner,
    winType: st.winType,
    error: st.error,
    reveal,
    gameMode: st.gameMode,
    round: st.round,
    honba: st.honba,
    // 리치/장풍 정보
    riichi: [...st.riichi],
    prevalentWind: st.prevalentWind,
    // 도라 정보
    doraIndicators: [...st.doraIndicators],
    uraDoraIndicators: reveal && st.winner != null && st.riichi[st.winner] ? [...st.uraDoraIndicators] : [],
    // 점수 정보
    scores: [...st.scores],
    yaku: st.yaku.map(y => [...y]),
    fu: [...st.fu],
    han: [...st.han],
    points: [...st.points],
    canRiichi,
  };
}

export function handSnapshotForSeat(st, seat) {
  return {
    tiles: sortTiles(st.hands[seat]),
    labels: sortTiles(st.hands[seat]).map(tileLabelKo),
  };
}

// 역패 계산 함수들
function isTanyao(tiles) {
  // 탕야오추: 2-8만/통/삭만 사용
  return tiles.every(tile => {
    if (tile[0] === 'z') return false; // 자패 제외
    const num = parseInt(tile.slice(1));
    return num >= 2 && num <= 8;
  });
}

function isPinfu(hand, melds, seatWind, prevalentWind) {
  if (melds.length > 0) return false;
  if (hand.length !== 14) return false;
  const sorted = sortTiles(hand);
  if (!isWinningHandWithOpen(sorted, 0)) return false;

  const counts = {};
  for (const tile of sorted) counts[tile] = (counts[tile] || 0) + 1;

  for (const tile of Object.keys(counts)) {
    if (counts[tile] < 2) continue;
    const pairTiles = [tile, tile];
    if (hasSeatWind(pairTiles, seatWind) || hasPrevalentWind(pairTiles, prevalentWind) || hasDragons(pairTiles)) {
      continue;
    }
    const remaining = { ...counts };
    remaining[tile] -= 2;
    if (remaining[tile] === 0) delete remaining[tile];
    if (canFormSequenceMelds(remaining)) {
      return true;
    }
  }
  return false;
}

function canFormSequenceMelds(counts) {
  const tiles = Object.keys(counts).sort((a, b) => {
    const [sa, na] = [a[0], parseInt(a.slice(1), 10)];
    const [sb, nb] = [b[0], parseInt(b.slice(1), 10)];
    const o = { m: 0, p: 1, s: 2, z: 3 };
    if (o[sa] !== o[sb]) return o[sa] - o[sb];
    return na - nb;
  });
  if (tiles.length === 0) return true;
  const tile = tiles[0];
  const count = counts[tile];
  if (count === 0) {
    delete counts[tile];
    return canFormSequenceMelds(counts);
  }
  const suit = tile[0];
  const rank = parseInt(tile.slice(1), 10);
  if (suit === 'z' || rank > 7) return false;
  const t2 = `${suit}${rank + 1}`;
  const t3 = `${suit}${rank + 2}`;
  if ((counts[t2] || 0) <= 0 || (counts[t3] || 0) <= 0) return false;
  const nextCounts = { ...counts };
  nextCounts[tile] -= 1;
  nextCounts[t2] -= 1;
  nextCounts[t3] -= 1;
  if (nextCounts[tile] === 0) delete nextCounts[tile];
  if (nextCounts[t2] === 0) delete nextCounts[t2];
  if (nextCounts[t3] === 0) delete nextCounts[t3];
  return canFormSequenceMelds(nextCounts);
}

function hasSeatWind(tiles, seat) {
  // 자풍: 자신의 바람패 머리
  const windTile = ['z1', 'z2', 'z3', 'z4'][seat];
  return tiles.filter(t => t === windTile).length >= 2;
}

function hasPrevalentWind(tiles, prevalentWind) {
  // 장풍: 장풍 머리
  const windTile = ['z1', 'z2', 'z3', 'z4'][prevalentWind];
  return tiles.filter(t => t === windTile).length >= 2;
}

function hasDragons(tiles) {
  // 삼원패: 백/발/중
  return tiles.some(tile => ['z5', 'z6', 'z7'].includes(tile));
}

function hasRiichi(riichi, seat) {
  // 리치
  return riichi[seat];
}

function calculateYaku(st, seat, isTsumo, hand = st.hands[seat]) {
  const melds = st.melds[seat];
  const allTiles = [...hand, ...melds.flatMap(m => m.tiles)];
  const yaku = [];
  
  // 탕야오추
  if (isTanyao(allTiles)) {
    yaku.push({ name: '탕야오추', han: 1 });
  }
  
  // 핑후 (쯔모만)
  if (isTsumo && isPinfu(hand, melds, seat, st.prevalentWind)) {
    yaku.push({ name: '핑후', han: 1 });
  }
  
  // 자풍
  if (hasSeatWind(allTiles, seat)) {
    yaku.push({ name: '자풍', han: 1 });
  }
  
  // 장풍
  if (hasPrevalentWind(allTiles, st.prevalentWind)) {
    yaku.push({ name: '장풍', han: 1 });
  }
  
  // 삼원패
  if (hasDragons(allTiles)) {
    yaku.push({ name: '삼원패', han: 1 });
  }
  
  // 리치
  if (hasRiichi(st.riichi, seat)) {
    yaku.push({ name: '리치', han: 1 });
  }

  const doraCount = countDora(allTiles, st.doraIndicators);
  if (doraCount > 0) {
    yaku.push({ name: `도라 x${doraCount}`, han: doraCount });
  }
  if (hasRiichi(st.riichi, seat)) {
    const uraCount = countDora(allTiles, st.uraDoraIndicators);
    if (uraCount > 0) {
      yaku.push({ name: `우라도라 x${uraCount}`, han: uraCount });
    }
  }
  
  return yaku;
}

function isTerminalOrHonor(tile) {
  if (tile[0] === 'z') return true;
  const n = parseInt(tile.slice(1), 10);
  return n === 1 || n === 9;
}

function calculateFu(st, seat, yaku, isTsumo, hand = st.hands[seat]) {
  let fu = 20;
  const melds = st.melds[seat];

  // 오야쯔모 보너스
  if (isTsumo) {
    fu += 2;
  }

  // 쌍의 2부
  const counts = {};
  for (const tile of hand) counts[tile] = (counts[tile] || 0) + 1;
  let pairFu = 0;
  for (const tile of Object.keys(counts)) {
    if (counts[tile] >= 2) {
      const pairTiles = [tile, tile];
      if (hasSeatWind(pairTiles, seat) || hasPrevalentWind(pairTiles, st.prevalentWind) || hasDragons(pairTiles)) {
        pairFu = 2;
        break;
      }
    }
  }
  fu += pairFu;

  for (const meld of melds) {
    if (meld.type === 'pon') {
      const tile = meld.tiles[0];
      const open = true;
      fu += isTerminalOrHonor(tile) ? 4 : 2;
    }
    if (meld.type === 'kan') {
      const tile = meld.tiles[0];
      const closed = meld.subType === 'ankan';
      if (closed) {
        fu += isTerminalOrHonor(tile) ? 32 : 16;
      } else {
        fu += isTerminalOrHonor(tile) ? 16 : 8;
      }
    }
  }

  return Math.max(20, Math.ceil(fu / 10) * 10);
}

function calculatePointValues(fu, han, isDealer, isTsumo) {
  const basePoints = fu * Math.pow(2, han + 2);
  if (isTsumo) {
    if (isDealer) {
      return { total: basePoints * 6, dealerPayment: 0, otherPayment: basePoints * 2 };
    }
    return { total: basePoints * 4, dealerPayment: basePoints * 2, otherPayment: basePoints };
  }
  return { total: basePoints * 4, loserPayment: basePoints * 4 };
}

function applyScoreSettlement(st, seat, isTsumo, score) {
  if (isTsumo) {
    if (seat === st.dealer) {
      const eachLoss = score.otherPayment;
      for (let s = 0; s < SEATS; s++) {
        if (s === seat) continue;
        st.scores[s] -= eachLoss;
      }
      st.scores[seat] += eachLoss * 3;
    } else {
      for (let s = 0; s < SEATS; s++) {
        if (s === seat) continue;
        if (s === st.dealer) {
          st.scores[s] -= score.dealerPayment;
        } else {
          st.scores[s] -= score.otherPayment;
        }
      }
      st.scores[seat] += score.total;
    }
  } else {
    const loser = st.lastDiscard?.seat;
    if (typeof loser === 'number' && loser >= 0 && loser < SEATS) {
      st.scores[loser] -= score.loserPayment;
    }
    st.scores[seat] += score.total;
  }
}

function allTileTypes() {
  const tiles = [];
  for (const suit of ['m', 'p', 's']) {
    for (let i = 1; i <= 9; i++) tiles.push(`${suit}${i}`);
  }
  for (let i = 1; i <= 7; i++) tiles.push(`z${i}`);
  return tiles;
}

export function isTenpai(st, seat) {
  const hand = st.hands[seat];
  const meldCount = st.melds[seat].length;
  if (handSize(st, seat) !== 13 - 3 * meldCount) return false;
  const candidates = allTileTypes();
  return candidates.some((tile) => {
    const trial = sortTiles([...hand, tile]);
    return isWinningHandWithOpen(trial, meldCount);
  });
}

function calculatePoints(fu, han, isDealer, isTsumo) {
  return calculatePointValues(fu, han, isDealer, isTsumo).total;
}

/**
 * 도라 표시패 추가
 * @param {ReturnType<typeof createMahjongState>} st
 */
export function addDoraIndicator(st) {
  if (st.deadWall.length < 2) return;
  const indicator = st.deadWall.shift();
  const ura = st.deadWall.shift();
  st.doraIndicators.push(indicator);
  if (ura) st.uraDoraIndicators.push(ura);
}

/**
 * 깡 도라 표시패 추가 (린샨 개방 시)
 * @param {ReturnType<typeof createMahjongState>} st
 */
export function addKanDoraIndicator(st) {
  if (st.deadWall.length < 2) return;
  const indicator = st.deadWall.shift();
  const ura = st.deadWall.shift();
  st.doraIndicators.push(indicator);
  if (ura) st.uraDoraIndicators.push(ura);
}

/**
 * 도라 수 계산
 * @param {string[]} tiles - 검사할 타일들
 * @param {string[]} doraIndicators - 도라 표시패들
 * @returns {number} 도라 수
 */
export function countDora(tiles, doraIndicators) {
  let count = 0;
  for (const tile of tiles) {
    for (const indicator of doraIndicators) {
      if (nextTile(indicator) === tile) {
        count++;
      }
    }
  }
  return count;
}

/** @param {string} tile - Get the next tile in sequence (for dora) */
function nextTile(tile) {
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

export { SEATS, sortTiles, tileLabelKo };
