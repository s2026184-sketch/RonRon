import { buildWall, shuffle, tileLabelKo, normalizeTile, parseTile, tileKey } from './tiles.js';
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
    winType: /** @type {'tsumo' | 'ron' | 'tsukanzu' | null} */ (null),
    error: /** @type {string | null} */ (null),
    /** 점수 시스템 */
    scores: /** @type {number[]} */ ([25000, 25000, 25000, 25000]), // 초기 점수
    prevalentWind: 0, // 장풍 (0:동, 1:남, 2:서, 3:북)
    gameMode: 'normal', // 'normal' or 'tonpufu' (동풍전)
    round: 1, // 동풍전 판 번호 (1-4)
    honba: 0, // 본장
    riichi: /** @type {boolean[]} */ ([false, false, false, false]), // 리치 상태
    riichiTurn: /** @type {number[]} */ ([0, 0, 0, 0]), // 리치 후 턴 수
    riichiDeclaredOnFirstTurn: /** @type {boolean[]} */ ([false, false, false, false]), // 첫 턴에 리치 선언
    yaku: /** @type {Array<{ name: string, han: number }[]>} */ ([], [], [], []), // 역패 목록
    fu: /** @type {number[]} */ ([0, 0, 0, 0]), // 부수
    han: /** @type {number[]} */ ([0, 0, 0, 0]), // 합
    points: /** @type {number[]} */ ([0, 0, 0, 0]), // 최종 점수
    doraIndicators: /** @type {string[]} */ ([]), // 도라 표시패
    uraDoraIndicators: /** @type {string[]} */ ([]), // 우라도라 표시패 (리치 시 공개)
    playerKanCount: /** @type {number[]} */ ([0, 0, 0, 0]), // 각 플레이어별 깡 수
    pendingKanRon: false,
    lastDraw: /** @type {{ seat: number, tile: string } | null} */ (null),
    lastDrawFromRinshan: false,
    furitenPermanent: /** @type {boolean[]} */ ([false, false, false, false]),
    furitenTemp: /** @type {boolean[]} */ ([false, false, false, false]),
    kuikaeForbidden: /** @type {string[][]} */ ([[], [], [], []]),
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
  st.furitenPermanent = [false, false, false, false];
  st.furitenTemp = [false, false, false, false];
  st.kuikaeForbidden = [[], [], [], []];
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
    st.lastDrawFromRinshan = false;
  } else {
    st.lastDraw = null;
    st.lastDrawFromRinshan = false;
  }
  st.hands[st.dealer] = sortTiles(st.hands[st.dealer]);

  // 점수 및 역패 초기화
  st.riichi = [false, false, false, false];
  st.riichiTurn = [0, 0, 0, 0];
  st.yaku = [[], [], [], []];
  st.fu = [0, 0, 0, 0];
  st.han = [0, 0, 0, 0];
  st.points = [0, 0, 0, 0];
  st.playerKanCount = [0, 0, 0, 0];
  st.pendingKanRon = false;
}

function handSize(st, seat) {
  return st.hands[seat].length;
}

function countTile(hand, tile) {
  const normalizedTarget = normalizeTile(tile);
  return hand.filter((t) => normalizeTile(t) === normalizedTarget).length;
}

function handCanKan(hand, tile) {
  return countTile(hand, tile) >= 3;
}

function hasOpenPon(melds, tile) {
  const normalizedTarget = normalizeTile(tile);
  return melds.some(
    (m) =>
      m.type === 'pon' &&
      m.tiles.length === 3 &&
      m.tiles.every((x) => normalizeTile(x) === normalizedTarget)
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
    const normalized = normalizeTile(tile);
    counts[normalized] = (counts[normalized] || 0) + 1;
    if (counts[normalized] >= 4) return normalized;
  }
  return null;
}

function clearTempFuriten(st, seat) {
  if (seat >= 0 && seat < SEATS) {
    st.furitenTemp[seat] = false;
  }
}

function isTileWinningForHand(hand, openCount, tile) {
  const trial = sortTiles([...hand, tile]);
  return isWinningHandWithOpen(trial, openCount);
}

function hasSelfDiscardWinningTile(st, seat) {
  const open = st.melds[seat].length;
  if (handSize(st, seat) !== 13 - 3 * open) return false;
  for (const tile of st.discards[seat]) {
    if (isTileWinningForHand(st.hands[seat], open, tile)) {
      return true;
    }
  }
  return false;
}

function isFuriten(st, seat) {
  return (
    st.furitenPermanent[seat] ||
    st.furitenTemp[seat] ||
    hasSelfDiscardWinningTile(st, seat)
  );
}

function setFuritenOnPassRon(st, seat) {
  if (!st.lastDiscard) return;
  const open = st.melds[seat].length;
  if (!isTileWinningForHand(st.hands[seat], open, st.lastDiscard.tile)) return;
  st.furitenTemp[seat] = true;
  if (st.riichi[seat]) {
    st.furitenPermanent[seat] = true;
  }
}

function setKuikaeForbiddenForChi(st, seat, tileA, tileB, t) {
  const forbidden = new Set([normalizeTile(t)]);
  const pA = parseTile(tileA);
  const pB = parseTile(tileB);
  const pT = parseTile(t);
  if (pA.suit === pB.suit && pA.suit === pT.suit && pT.suit !== 'z') {
    const nums = [pA.n, pB.n].sort((a, b) => a - b);
    if (nums[1] - nums[0] === 1) {
      if (nums[0] - 1 >= 1) forbidden.add(tileKey(pA.suit, nums[0] - 1));
      if (nums[1] + 1 <= 9) forbidden.add(tileKey(pA.suit, nums[1] + 1));
    }
  }
  st.kuikaeForbidden[seat] = [...forbidden];
}

function setKuikaeForbiddenForPonOrKan(st, seat, t) {
  st.kuikaeForbidden[seat] = [normalizeTile(t)];
}

function clearKuikaeForbidden(st, seat) {
  if (seat >= 0 && seat < SEATS) {
    st.kuikaeForbidden[seat] = [];
  }
}

function isKuikaeForbidden(st, seat, tile) {
  return st.kuikaeForbidden[seat].includes(normalizeTile(tile));
}

function drawRinshan(st) {
  const draw = st.deadWall.shift() || st.wall.shift();
  if (!draw) return null;
  if (st.current < 0 || st.current >= SEATS) return null;
  st.hands[st.current].push(draw);
  st.hands[st.current] = sortTiles(st.hands[st.current]);
  st.lastDraw = { seat: st.current, tile: draw };
    st.lastDrawFromRinshan = true;
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
  clearTempFuriten(st, seat);
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
  if (st.awaitingDiscardAfterMeld === seat && isKuikaeForbidden(st, seat, tile)) {
    st.error = '쿠이카에 규칙으로 바로 버릴 수 없습니다.';
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
  clearKuikaeForbidden(st, seat);
  st.waitingRon = true;
  st.ronPasses = [];
  st.nextDrawer = (seat + 1) % SEATS;
  st.current = -1;
  
  // 리치 턴 증가
  for (let i = 0; i < SEATS; i++) {
    if (st.riichi[i]) {
      st.riichiTurn[i]++;
    }
  }
  
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
  setFuritenOnPassRon(st, seat);
  st.ronPasses.push(seat);
  const need = SEATS - 1;
  if (st.ronPasses.length < need) return true;

  if (st.pendingKanRon) {
    const kanSeat = st.lastDiscard?.seat ?? -1;
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
    st.current = kanSeat;
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
  const normalizedT = normalizeTile(t);
  const h = st.hands[seat];
  let removed = 0;
  for (let i = h.length - 1; i >= 0 && removed < 2; i--) {
    if (normalizeTile(h[i]) === normalizedT) {
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
  setKuikaeForbiddenForPonOrKan(st, seat, t);
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
    const normalizedT = normalizeTile(t);
    const h = st.hands[seat];
    let removed = 0;
    for (let i = h.length - 1; i >= 0 && removed < 3; i--) {
      if (normalizeTile(h[i]) === normalizedT) {
        h.splice(i, 1);
        removed++;
      }
    }
    if (removed !== 3) {
      st.error = '손패 오류';
      return false;
    }
    st.melds[seat].push({
      type: 'kan',
      subType: 'daiminkan',
      sourceSeat: st.nakiDiscarder,
      tiles: sortTiles([t, t, t, t]),
    });
    st.hands[seat] = sortTiles(h);
    st.playerKanCount[seat] += 1;
    addKanDoraIndicator(st);
    setKuikaeForbiddenForPonOrKan(st, seat, t);
    st.waitingNaki = false;
    st.nakiCurrentSeat = null;
    st.nakiCanChi = false;
    st.nakiCanPon = false;
    st.awaitingDiscardAfterMeld = seat;
    st.nakiTile = null;
    st.current = seat;
    if (st.playerKanCount[seat] >= 4) {
      st.phase = 'finished';
      st.current = -1;
      st.winner = seat;
      st.winType = 'tsukanzu';
      st.yaku[seat] = [{ name: '쓰깡즈', han: 13 }];
      st.fu[seat] = 30;
      st.han[seat] = 13;
      const score = calculatePointValues(30, 13, seat === st.dealer, true);
      st.points[seat] = score.total;
      const prevScores = [...st.scores];
      applyScoreSettlement(st, seat, true, score);
      st.scoreChanges = st.scores.map((s, i) => s - prevScores[i]);
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
    const normalizedChosen = normalizeTile(chosenTile);
    const meldIndex = st.melds[seat].findIndex(
      (m) =>
        m.type === 'pon' &&
        m.tiles.length === 3 &&
        m.tiles.every((x) => normalizeTile(x) === normalizedChosen)
    );
    if (meldIndex === -1) {
      st.error = '가캉 불가';
      return false;
    }
    const h = st.hands[seat];
    let removed = 0;
    for (let i = h.length - 1; i >= 0 && removed < 1; i--) {
      if (normalizeTile(h[i]) === normalizedChosen) {
        h.splice(i, 1);
        removed++;
      }
    }
    if (removed !== 1) {
      st.error = '손패 오류';
      return false;
    }
    st.melds[seat][meldIndex] = {
      type: 'kan',
      subType: 'kakan',
      tiles: sortTiles([chosenTile, chosenTile, chosenTile, chosenTile]),
    };
    st.hands[seat] = sortTiles(h);
    isKakan = true;
  } else if (ankanTile === chosenTile && countTile(hand, chosenTile) >= 4) {
    const normalizedChosen = normalizeTile(chosenTile);
    const h = st.hands[seat];
    let removed = 0;
    for (let i = h.length - 1; i >= 0 && removed < 4; i--) {
      if (normalizeTile(h[i]) === normalizedChosen) {
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

  st.playerKanCount[seat] += 1;
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
  if (st.playerKanCount[seat] >= 4) {
    st.phase = 'finished';
    st.current = -1;
    st.winner = seat;
    st.winType = 'tsukanzu';
    st.yaku[seat] = [{ name: '쓰깡즈', han: 13 }];
    st.fu[seat] = 30;
    st.han[seat] = 13;
    const score = calculatePointValues(30, 13, seat === st.dealer, true);
    st.points[seat] = score.total;
    const prevScores = [...st.scores];
    applyScoreSettlement(st, seat, true, score);
    st.scoreChanges = st.scores.map((s, i) => s - prevScores[i]);
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
  const normalizedA = normalizeTile(tileA);
  const normalizedB = normalizeTile(tileB);
  const h = st.hands[seat];
  for (const normalizedRm of [normalizedA, normalizedB]) {
    const ix = h.findIndex((x) => normalizeTile(x) === normalizedRm);
    if (ix === -1) {
      st.error = '손에 없는 패입니다.';
      return false;
    }
    h.splice(ix, 1);
  }
  st.melds[seat].push({ type: 'chi', tiles: sortTiles([tileA, tileB, t]) });
  st.hands[seat] = sortTiles(h);
  setKuikaeForbiddenForChi(st, seat, tileA, tileB, t);
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
  st.riichiTurn[seat] = 1;
  // 첫 턴에 리치 선언했는지 확인 (아직 아무 패도 버리지 않음)
  st.riichiDeclaredOnFirstTurn[seat] = st.discards[seat].length === 0;
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
  if (isFuriten(st, seat)) {
    st.error = '후리텐 상태에서는 론할 수 없습니다.';
    return false;
  }
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
  const melds = st.melds.map((m) =>
    m.map((x) => ({
      type: x.type,
      subType: x.subType,
      sourceSeat: x.sourceSeat,
      tiles: [...x.tiles],
    }))
  );

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
    if (handSize(st, viewerSeat) === 13 - 3 * m && !isFuriten(st, viewerSeat)) {
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

  let waitingTiles = [];
  if (viewerSeat >= 0 && viewerSeat < SEATS && isTenpai(st, viewerSeat)) {
    waitingTiles = getWaitingTiles(st, viewerSeat);
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
    waitingTiles,
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

function isRinshan(st, seat) {
  return st.lastDrawFromRinshan && st.lastDraw?.seat === seat;
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
  
  // 기본 역들
  // 탕야오추
  if (isTanyao(allTiles)) {
    yaku.push({ name: '탕야오추', han: 1 });
  }
  
  // 핑후
  if (isPinfu(hand, melds, seat, st.prevalentWind)) {
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
    if (st.riichiDeclaredOnFirstTurn[seat]) {
      yaku.push({ name: '더블리치', han: 2 });
    } else {
      yaku.push({ name: '리치', han: 1 });
    }
    
    // 일발 (리치 후 첫 번째 턴에 화료)
    if (st.riichiTurn[seat] === 1) {
      yaku.push({ name: '일발', han: 1 });
    }
  }
  
  // 멘젠쯔모
  if (isTsumo && melds.length === 0) {
    yaku.push({ name: '멘젠쯔모', han: 1 });
  }
  
  // 치또이츠 / 이페코 / 양페코
  const chiitoitsu = isChiitoitsu(hand, melds);
  if (chiitoitsu) {
    yaku.push({ name: '치또이츠', han: 2 });
  } else if (isRyanpeikou(hand, melds)) {
    yaku.push({ name: '양페코', han: 3 });
  } else if (isIipeikou(hand, melds)) {
    yaku.push({ name: '이페코', han: melds.length === 0 ? 1 : 0 });
  }
  
  // 또이또이
  if (isToitoi(hand, melds)) {
    yaku.push({ name: '또이또이', han: 2 });
  }
  
  // 혼일색
  if (isHonitsu(allTiles)) {
    yaku.push({ name: '혼일색', han: melds.length === 0 ? 3 : 2 });
  }
  
  // 고급 역들
  // 삼색동순
  const sanshokuDoujun = isSanshokuDoujun(hand, melds);
  if (sanshokuDoujun) {
    yaku.push({ name: '삼색동순', han: sanshokuDoujun.menzen ? 2 : 1 });
  }
  
  // 일기통관
  const ikkitsuukan = isIkkitsuukan(hand, melds);
  if (ikkitsuukan) {
    yaku.push({ name: '일기통관', han: ikkitsuukan.menzen ? 2 : 1 });
  }
  
  // 찬타
  const chanta = isChanta(hand, melds);
  if (chanta) {
    yaku.push({ name: '찬타', han: chanta.menzen ? 2 : 1 });
  }
  
  // 준찬타
  const junchan = isJunchan(hand, melds);
  if (junchan) {
    yaku.push({ name: '준찬타', han: junchan.menzen ? 3 : 2 });
  }
  
  // 청일색
  if (isChinitsu(allTiles)) {
    yaku.push({ name: '청일색', han: melds.length === 0 ? 6 : 5 });
  }
  
  // 영상개화
  if (isRinshan(st, seat) && isTsumo) {
    yaku.push({ name: '영상개화', han: 1 });
  }

  // 천화
  if (isTenhou(st, seat, isTsumo)) {
    yaku.push({ name: '천화', han: 13 });
  }

  // 지화
  if (isChiihou(st, seat, isTsumo)) {
    yaku.push({ name: '지화', han: 13 });
  }

  // 녹일색
  if (isRyuuiisou(allTiles)) {
    yaku.push({ name: '녹일색', han: 13 });
  }

  // 청노두
  if (isChinroutou(allTiles)) {
    yaku.push({ name: '청노두', han: 13 });
  }

  // 소사희 / 대사희
  if (isDaisuushi(allTiles)) {
    yaku.push({ name: '대사희', han: 13 });
  } else if (isShousuushi(allTiles)) {
    yaku.push({ name: '소사희', han: 13 });
  }

  // 사깡쯔
  if (isSuukantsu(melds)) {
    yaku.push({ name: '사깡쯔', han: 13 });
  }

  // 구련보등
  if (isChurenPoutou(hand, melds)) {
    yaku.push({ name: '구련보등', han: 13 });
  }

  // 삼암각
  if (isSananko(hand, melds)) {
    yaku.push({ name: '삼암각', han: 2 });
  }
  if (isHaiteiraoyue(st)) {
    yaku.push({ name: '해저로월', han: 1 });
  }
  
  // 하저로어
  if (isHouteiraoyui(st)) {
    yaku.push({ name: '하저로어', han: 1 });
  }
  
  // 창깡
  if (isChankan(st, seat)) {
    yaku.push({ name: '창깡', han: 1 });
  }
  
  // 소삼원
  if (isShousangen(hand, melds)) {
    yaku.push({ name: '소삼원', han: 2 });
  }
  
  // 혼노두
  if (isHonroutou(allTiles)) {
    yaku.push({ name: '혼노두', han: 2 });
  }
  
  // 삼깡쯔
  if (isSankantsu(melds)) {
    yaku.push({ name: '삼깡쯔', han: 2 });
  }
  
  // 창깡 (이미 위에서 처리)
  
  // 국사무쌍
  if (isKokushimusou(hand, melds)) {
    yaku.push({ name: '국사무쌍', han: 13 }); // 역만
  }
  
  // 사암각
  if (isSuuankou(hand, melds)) {
    yaku.push({ name: '사암각', han: 13 }); // 역만
  }
  
  // 대삼원
  if (isDaisangen(allTiles)) {
    yaku.push({ name: '대삼원', han: 13 }); // 역만
  }
  
  // 자일색
  if (isTsuisou(allTiles)) {
    yaku.push({ name: '자일색', han: 13 }); // 역만
  }
  
  // 삼색동각
  if (isSanshokuDoukou(hand, melds)) {
    yaku.push({ name: '삼색동각', han: 2 });
  }
  
  // 도라
  const doraCount = countDora(allTiles, st.doraIndicators);
  if (doraCount > 0) {
    yaku.push({ name: `도라 x${doraCount}`, han: doraCount });
  }
  
  // 우라도라
  if (hasRiichi(st.riichi, seat)) {
    const uraCount = countDora(allTiles, st.uraDoraIndicators);
    if (uraCount > 0) {
      yaku.push({ name: `우라도라 x${uraCount}`, han: uraCount });
    }
  }
  
  return yaku;
}

function compareNormalizedTiles(a, b) {
  const pa = parseTile(a);
  const pb = parseTile(b);
  const order = { m: 0, p: 1, s: 2, z: 3 };
  if (order[pa.suit] !== order[pb.suit]) return order[pa.suit] - order[pb.suit];
  return pa.n - pb.n;
}

function findWinningDecomposition(tiles, validator = () => true) {
  if (tiles.length < 2 || (tiles.length - 2) % 3 !== 0) return null;
  const normalizedTiles = tiles.map(normalizeTile).sort((a, b) => compareNormalizedTiles(a, b));
  const counts = {};
  for (const tile of normalizedTiles) counts[tile] = (counts[tile] || 0) + 1;

  function searchMelds(currentCounts) {
    const keys = Object.keys(currentCounts).filter((k) => currentCounts[k] > 0).sort(compareNormalizedTiles);
    if (keys.length === 0) return [[]];

    const first = keys[0];
    let results = [];

    if (currentCounts[first] >= 3) {
      const nextCounts = { ...currentCounts };
      nextCounts[first] -= 3;
      if (nextCounts[first] === 0) delete nextCounts[first];
      const nextMelds = searchMelds(nextCounts);
      if (nextMelds) {
        for (const path of nextMelds) {
          results.push([{ type: 'pon', tiles: [first, first, first] }, ...path]);
        }
      }
    }

    const parsed = parseTile(first);
    if (parsed.suit !== 'z' && parsed.n <= 7) {
      const t2 = tileKey(parsed.suit, parsed.n + 1);
      const t3 = tileKey(parsed.suit, parsed.n + 2);
      if ((currentCounts[t2] || 0) > 0 && (currentCounts[t3] || 0) > 0) {
        const nextCounts = { ...currentCounts };
        nextCounts[first]--;
        nextCounts[t2]--;
        nextCounts[t3]--;
        for (const key of [first, t2, t3]) {
          if (nextCounts[key] === 0) delete nextCounts[key];
        }
        const nextMelds = searchMelds(nextCounts);
        if (nextMelds) {
          for (const path of nextMelds) {
            results.push([{ type: 'chi', tiles: [first, t2, t3] }, ...path]);
          }
        }
      }
    }

    return results.length > 0 ? results : null;
  }

  for (const tile of Object.keys(counts).filter((tile) => counts[tile] >= 2).sort(compareNormalizedTiles)) {
    const nextCounts = { ...counts };
    nextCounts[tile] -= 2;
    if (nextCounts[tile] === 0) delete nextCounts[tile];
    const meldCombinations = searchMelds(nextCounts);
    if (!meldCombinations) continue;

    for (const melds of meldCombinations) {
      const decomposition = { pair: [tile, tile], melds };
      if (validator(decomposition)) {
        return decomposition;
      }
    }
  }

  return null;
}

function isHonitsu(tiles) {
  const suits = new Set();
  for (const tile of tiles) {
    const suit = tile[0];
    if (suit !== 'z') {
      suits.add(suit);
    }
  }
  return suits.size === 1; // 수패가 한 가지 종류만
}

function isSanshokuDoujun(hand, melds) {
  // 삼색동순: 같은 숫자의 세 가지 색깔 슌쯔
  function collectSequenceStarts(allMelds) {
    const sequences = [];
    for (const meld of allMelds) {
      if (meld.type !== 'chi') continue;
      if (meld.tiles.length !== 3) continue;
      const [t1, t2, t3] = meld.tiles;
      const p1 = parseTile(t1);
      const p2 = parseTile(t2);
      const p3 = parseTile(t3);
      if (p1.suit === p2.suit && p2.suit === p3.suit && p1.suit !== 'z' &&
          p2.n === p1.n + 1 && p3.n === p2.n + 1) {
        sequences.push({ suit: p1.suit, start: p1.n });
      }
    }
    return sequences;
  }

  const decomposition = findWinningDecomposition(hand, ({ melds: concealedMelds }) => {
    const allMelds = [...melds, ...concealedMelds];
    const sequenceMap = {};
    for (const seq of collectSequenceStarts(allMelds)) {
      sequenceMap[seq.start] = sequenceMap[seq.start] || new Set();
      sequenceMap[seq.start].add(seq.suit);
    }
    return Object.values(sequenceMap).some((suits) => suits.size === 3);
  });

  if (!decomposition) return false;
  return { menzen: melds.length === 0 };
}

function isIkkitsuukan(hand, melds) {
  // 일기통관: 1-9까지 한 가지 색깔로 연속
  const allTiles = [...hand, ...melds.flatMap(m => m.tiles)];
  const suitCounts = { m: [], p: [], s: [] };
  
  for (const tile of allTiles) {
    const { suit, n } = parseTile(tile);
    if (suit !== 'z') {
      suitCounts[suit].push(n);
    }
  }
  
  for (const [suit, numbers] of Object.entries(suitCounts)) {
    const uniqueNumbers = [...new Set(numbers)].sort((a, b) => a - b);
    if (uniqueNumbers.length >= 9 && uniqueNumbers.every((n, i) => n === i + 1)) {
      return { menzen: melds.length === 0 };
    }
  }
  
  return false;
}

function isChanta(hand, melds) {
  // 찬타: 모든 멘쯔와 머리가 단기패(1,9,자패) 포함
  const decomposition = findWinningDecomposition(hand, ({ pair, melds: concealedMelds }) => {
    const allGroups = [
      ...melds,
      ...concealedMelds,
      { type: 'pair', tiles: pair },
    ];

    return allGroups.every(group => {
      return group.tiles.some(tile => {
        const { suit, n } = parseTile(tile);
        return suit === 'z' || n === 1 || n === 9;
      });
    });
  });

  return decomposition ? { menzen: melds.length === 0 } : false;
}

function isJunchan(hand, melds) {
  // 준찬타: 찬타의 준말, 단기패만 사용 (자패 불가)
  const allTiles = [...hand, ...melds.flatMap(m => m.tiles)];
  
  // 자패가 없어야 함
  if (allTiles.some(tile => tile[0] === 'z')) return false;
  
  // 모든 타일이 1이나 9여야 함
  for (const tile of allTiles) {
    const { n } = parseTile(tile);
    if (n !== 1 && n !== 9) return false;
  }
  
  return { menzen: melds.length === 0 };
}

function isChinitsu(allTiles) {
  // 청일색: 한 가지 색깔만 사용 (자패 불가)
  const suits = new Set();
  for (const tile of allTiles) {
    const suit = tile[0];
    if (suit === 'z') return false; // 자패 불가
    suits.add(suit);
  }
  return suits.size === 1;
}

function isRyuuiisou(allTiles) {
  // 녹일색: 모두 녹색 패 (2,3,4,6,8삭 + 녹용)
  const greenTiles = ['s2', 's3', 's4', 's6', 's8', 'z6']; // 녹용은 z6
  return allTiles.every(tile => greenTiles.includes(tile));
}

function isChinroutou(allTiles) {
  // 청노두: 자패 없이 1과 9만으로 구성
  return allTiles.every(tile => {
    const { suit, n } = parseTile(tile);
    return suit !== 'z' && (n === 1 || n === 9);
  });
}

function isShousuushi(allTiles) {
  // 소사희: 바람패 3개 코츠/깡, 1개 쌍
  const winds = ['z1', 'z2', 'z3', 'z4'];
  const counts = winds.map(w => allTiles.filter(tile => tile === w).length);
  const tripletCount = counts.filter(count => count >= 3).length;
  const pairCount = counts.filter(count => count >= 2).length;
  return tripletCount === 3 && pairCount === 4;
}

function isDaisuushi(allTiles) {
  // 대사희: 바람패 4개 모두 코츠/깡
  const winds = ['z1', 'z2', 'z3', 'z4'];
  return winds.every(w => allTiles.filter(tile => tile === w).length >= 3);
}

function isSuukantsu(melds) {
  // 사깡쯔: 깡 4개
  let kanCount = 0;
  for (const meld of melds) {
    if (meld.type === 'kan') kanCount++;
  }
  return kanCount === 4;
}

function isChurenPoutou(hand, melds) {
  // 구련보등: 멘젠 + 같은 수패 1112345678999 + 같은 수패 한 장
  if (melds.length > 0) return false;
  if (hand.length !== 14) return false;
  const suit = hand[0][0];
  if (suit === 'z') return false;
  if (!hand.every(tile => tile[0] === suit)) return false;

  const counts = {};
  for (const tile of hand) counts[tile] = (counts[tile] || 0) + 1;
  for (let n = 1; n <= 9; n++) {
    const tile = `${suit}${n}`;
    const count = counts[tile] || 0;
    if (n === 1 || n === 9) {
      if (count < 3) return false;
    } else {
      if (count < 1) return false;
    }
  }
  return true;
}

function isTenhou(st, seat, isTsumo) {
  return isTsumo && st.lastDraw?.seat === seat && seat === st.dealer && st.discards[seat].length === 0 && st.melds[seat].length === 0 && !st.lastDrawFromRinshan;
}

function isChiihou(st, seat, isTsumo) {
  return !isTsumo && seat !== st.dealer && st.lastDiscard?.seat === st.dealer && st.discards[seat].length === 0 && st.melds[seat].length === 0;
}

function isSananko(hand, melds) {
  // 삼암각: 3개의 암코
  const counts = {};
  for (const tile of hand) counts[tile] = (counts[tile] || 0) + 1;

  function isValidTripletOrSequence(remaining) {
    const tiles = Object.keys(remaining);
    if (tiles.length === 1) {
      const [tile] = tiles;
      return remaining[tile] === 3;
    }
    if (tiles.length === 3) {
      const [t1, t2, t3] = tiles.sort((a, b) => {
        const [sa, na] = [a[0], parseInt(a.slice(1), 10)];
        const [sb, nb] = [b[0], parseInt(b.slice(1), 10)];
        const o = { m: 0, p: 1, s: 2, z: 3 };
        if (o[sa] !== o[sb]) return o[sa] - o[sb];
        return na - nb;
      });
      const p1 = parseTile(t1);
      const p2 = parseTile(t2);
      const p3 = parseTile(t3);
      return p1.suit === p2.suit && p2.suit === p3.suit && p1.suit !== 'z' && p2.n === p1.n + 1 && p3.n === p2.n + 1 && remaining[t1] === 1 && remaining[t2] === 1 && remaining[t3] === 1;
    }
    return false;
  }

  function canFormRemaining(remaining) {
    const total = Object.values(remaining).reduce((sum, v) => sum + v, 0);
    if (total !== 5) return false;
    for (const [tile, count] of Object.entries(remaining)) {
      if (count >= 2) {
        const next = { ...remaining, [tile]: count - 2 };
        if (next[tile] === 0) delete next[tile];
        if (Object.values(next).reduce((sum, v) => sum + v, 0) !== 3) continue;
        if (isValidTripletOrSequence(next)) return true;
      }
    }
    return false;
  }

  function search(needed, currentCounts) {
    if (needed === 0) {
      return canFormRemaining(currentCounts);
    }
    for (const [tile, count] of Object.entries(currentCounts)) {
      if (count >= 3) {
        const nextCounts = { ...currentCounts, [tile]: count - 3 };
        if (nextCounts[tile] === 0) delete nextCounts[tile];
        if (search(needed - 1, nextCounts)) return true;
      }
    }
    return false;
  }

  return search(3, counts);
}

function isHonroutou(allTiles) {
  // 혼노두: 모두 단기패와 자패
  return allTiles.every(tile => {
    const { suit, n } = parseTile(tile);
    return suit === 'z' || n === 1 || n === 9;
  });
}

function isShousangen(hand, melds) {
  // 소삼원: 삼원패 중 2개 + 다른 머리
  const allTiles = [...hand, ...melds.flatMap(m => m.tiles)];
  const dragons = ['z5', 'z6', 'z7']; // 백, 발, 중
  
  const dragonCounts = {};
  for (const dragon of dragons) {
    dragonCounts[dragon] = allTiles.filter(tile => tile === dragon).length;
  }
  
  // 삼원패 중 2개가 코쯔나 깡으로 있고, 나머지 하나가 머리로 있는지 확인
  const dragonKoutsu = Object.values(dragonCounts).filter(count => count >= 3).length;
  const dragonPairs = Object.values(dragonCounts).filter(count => count >= 2).length;
  
  return dragonKoutsu === 2 && dragonPairs === 3; // 2개는 코쯔, 1개는 머리
}

function isDaisangen(allTiles) {
  // 대삼원: 세 가지 삼원패 모두
  const dragons = ['z5', 'z6', 'z7'];
  return dragons.every(dragon => allTiles.filter(tile => tile === dragon).length >= 3);
}

function isTsuisou(allTiles) {
  // 자일색: 모두 자패
  return allTiles.every(tile => tile[0] === 'z');
}

function isSanshokuDoukou(hand, melds) {
  // 삼색동각: 같은 숫자의 세 가지 색깔 코쯔
  const decomposition = findWinningDecomposition(hand, ({ melds: concealedMelds }) => {
    const koutsu = [];
    const allMelds = [...melds, ...concealedMelds];
    for (const meld of allMelds) {
      if (meld.type !== 'pon' && meld.type !== 'kan') continue;
      const tile = meld.tiles[0];
      const { suit, n } = parseTile(tile);
      if (suit !== 'z') {
        koutsu.push({ suit, number: n });
      }
    }

    const numberMap = {};
    for (const k of koutsu) {
      numberMap[k.number] = numberMap[k.number] || new Set();
      numberMap[k.number].add(k.suit);
    }
    return Object.values(numberMap).some((suits) => suits.size === 3);
  });

  return !!decomposition;
}

function isSuuankou(hand, melds) {
  // 사암각: 4개의 암각 (안깡)
  let ankanCount = 0;
  for (const meld of melds) {
    if (meld.type === 'kan' && meld.subType === 'ankan') {
      ankanCount++;
    }
  }
  return ankanCount === 4;
}

function isSankantsu(melds) {
  // 삼깡쯔: 깡 3개
  let kanCount = 0;
  for (const meld of melds) {
    if (meld.type === 'kan') {
      kanCount++;
    }
  }
  return kanCount === 3;
}

function isKokushimusou(hand, melds) {
  // 국사무쌍: 13가지 단기패 + 1장
  if (melds.length > 0) return false; // 멘젠이어야 함
  
  const requiredTiles = [
    'm1', 'm9', 'p1', 'p9', 's1', 's9',
    'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'
  ];
  
  const counts = {};
  for (const tile of hand) counts[tile] = (counts[tile] || 0) + 1;
  
  // 13가지 단기패가 각각 1장씩 있고, 나머지 1장이 단기패여야 함
  let terminalHonorCount = 0;
  let extraTile = null;
  
  for (const tile of requiredTiles) {
    const count = counts[tile] || 0;
    if (count >= 1) {
      terminalHonorCount++;
      if (count > 1) extraTile = tile;
    }
  }
  
  return terminalHonorCount === 13 && extraTile !== null;
}

function isChiitoitsu(hand, melds) {
  if (melds.length > 0) return false;
  if (hand.length !== 14) return false;
  const counts = {};
  for (const tile of hand) counts[tile] = (counts[tile] || 0) + 1;
  return Object.values(counts).length === 7 && Object.values(counts).every(count => count === 2);
}

function isIipeikou(hand, melds) {
  if (melds.length > 0) return false;
  if (hand.length !== 14) return false;
  const sorted = sortTiles(hand);
  const sequences = [];
  for (let i = 0; i < sorted.length - 2; i++) {
    const t1 = sorted[i];
    const t2 = sorted[i + 1];
    const t3 = sorted[i + 2];
    const p1 = parseTile(t1);
    const p2 = parseTile(t2);
    const p3 = parseTile(t3);
    if (p1.suit === p2.suit && p2.suit === p3.suit && p1.suit !== 'z' &&
        p2.n === p1.n + 1 && p3.n === p2.n + 1) {
      sequences.push([t1, t2, t3]);
      i += 2;
    }
  }
  if (sequences.length !== 4) return false;
  const sequenceStrings = sequences.map(seq => seq.join(','));
  const unique = [...new Set(sequenceStrings)];
  if (unique.length !== 3) return false;
  const counts = {};
  for (const seq of sequenceStrings) counts[seq] = (counts[seq] || 0) + 1;
  return Object.values(counts).some(count => count === 2);
}

function isRyanpeikou(hand, melds) {
  // 양페코: 이페코의 업그레이드, 두 쌍의 동일 슌쯔
  if (melds.length > 0) return false; // 멘젠이어야 함
  
  const sorted = sortTiles(hand);
  if (sorted.length !== 14) return false;
  
  // 슌쯔들을 찾기
  const sequences = [];
  for (let i = 0; i < sorted.length - 2; i++) {
    const t1 = sorted[i];
    const t2 = sorted[i + 1];
    const t3 = sorted[i + 2];
    
    const p1 = parseTile(t1);
    const p2 = parseTile(t2);
    const p3 = parseTile(t3);
    
    if (p1.suit === p2.suit && p2.suit === p3.suit && p1.suit !== 'z' &&
        p2.n === p1.n + 1 && p3.n === p2.n + 1) {
      sequences.push([t1, t2, t3]);
      i += 2; // 다음 슌쯔로 건너뜀
    }
  }
  
  // 정확히 두 쌍의 동일 슌쯔가 있는지 확인
  if (sequences.length !== 4) return false; // 4개의 슌쯔가 있어야 함
  
  const sequenceStrings = sequences.map(seq => seq.join(','));
  const uniqueSequences = [...new Set(sequenceStrings)];
  
  // 두 쌍씩 두 종류의 슌쯔가 있어야 함
  if (uniqueSequences.length !== 2) return false;
  
  return sequenceStrings.filter(s => s === uniqueSequences[0]).length === 2 &&
         sequenceStrings.filter(s => s === uniqueSequences[1]).length === 2;
}

function isToitoi(hand, melds) {
  // 또이또이: 모든 멜드가 모두 코쯔/깡이어야 함
  if (melds.some((meld) => meld.type !== 'pon' && meld.type !== 'kan')) return false;

  const decomposition = findWinningDecomposition(hand, ({ melds: concealedMelds }) =>
    concealedMelds.every((meld) => meld.type === 'pon' || meld.type === 'kan')
  );
  return !!decomposition;
}

function isHaiteiraoyue(st) {
  // 해저로월: 마지막 패로 쯔모
  return st.wall.length === 0 && st.deadWall.length === 0;
}

function isHouteiraoyui(st) {
  // 하저로어: 마지막 패로 론
  return st.wall.length === 0 && st.deadWall.length === 0;
}

function isChankan(st, seat) {
  // 창깡: 상대의 깡 선언에 론
  return st.pendingKanRon && st.lastDiscard?.seat !== seat;
}

function isTerminalOrHonor(tile) {
  const { suit, n } = parseTile(tile);
  return suit === 'z' || n === 1 || n === 9;
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

export function getWaitingTiles(st, seat) {
  const hand = st.hands[seat];
  const meldCount = st.melds[seat].length;
  if (handSize(st, seat) !== 13 - 3 * meldCount) return [];
  const candidates = allTileTypes();
  const waitingTiles = [];
  for (const tile of candidates) {
    const trial = sortTiles([...hand, tile]);
    if (isWinningHandWithOpen(trial, meldCount)) {
      waitingTiles.push(tile);
    }
  }
  return waitingTiles;
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
    if (tile === 'm5r' || tile === 'p5r' || tile === 's5r') {
      // 적도라는 항상 도라로 취급
      count += 1;
    }
    const normalizedTile = normalizeTile(tile);
    for (const indicator of doraIndicators) {
      if (nextTile(indicator) === normalizedTile) {
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
