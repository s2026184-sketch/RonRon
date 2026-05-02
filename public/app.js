import { createTileElement, tileTitleKo, nextTile } from './tiles.js';

const tokenKey = 'mahjong-token';
const socket = io({ auth: { token: localStorage.getItem(tokenKey) || undefined } });

socket.on('connect_error', (err) => {
  toast(`연결 실패: ${err.message || '서버가 꺼졌거나 주소가 다릅니다.'}`);
});

const $ = (id) => document.getElementById(id);

let account = null;
let selectedGameMode = 'normal'; // 'normal' or 'tonpufu'
/** 서버 좌석 0~3 = 동·남·서·북 가 */
const SEAT_WINDS = ['동', '남', '서', '북'];

let mySeat = -1;
let lastState = null;
let roomId = null;
let roster = { players: [] };
let handStartScores = null;
let handStartRanks = null;

const TILE_SM = 26;
const TILE_HAND = 46;

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3200);
}

function getRanks(scores) {
  const order = scores
    .map((score, seat) => ({ score, seat }))
    .sort((a, b) => b.score - a.score);
  const ranks = Array(scores.length).fill(0);
  let rank = 1;
  for (let i = 0; i < order.length; i++) {
    if (i > 0 && order[i].score < order[i - 1].score) {
      rank = i + 1;
    }
    ranks[order[i].seat] = rank;
  }
  return ranks;
}

function formatDelta(value) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return '±0';
}

function isTileDora(tile, doraIndicators) {
  if (!doraIndicators || !doraIndicators.length) return false;
  for (const indicator of doraIndicators) {
    const normalDora = nextTile(indicator);
    if (tile === normalDora) return true;
    if (tile === `${normalDora}r`) return true;
  }
  return false;
}

function isTileAkaDora(tile) {
  return tile === 'm5' || tile === 'p5' || tile === 's5' || tile === 'm5r' || tile === 'p5r' || tile === 's5r';
}

function formatRankChange(beforeRank, afterRank) {
  const diff = beforeRank - afterRank;
  if (diff > 0) return `▲${diff}`;
  if (diff < 0) return `▼${-diff}`;
  return '—';
}

function closeSummary() {
  const modal = $('summary-modal');
  modal.classList.add('hidden');
}

function renderSummaryPopup(summary) {
  const body = $('summary-body');
  const title = summary.type === 'draw' ? '유국 결과' : `${escapeHtml(summary.winnerName)} ${summary.winText}`;

  const lines = [];
  lines.push(`<div class="summary-meta"><strong>${title}</strong></div>`);

  if (summary.type !== 'draw') {
    lines.push(`<div class="summary-meta">`);
    lines.push(`<span>승리: ${escapeHtml(summary.winnerName)} (${escapeHtml(summary.winWind)})</span>`);
    lines.push(`<span>승리 방식: ${escapeHtml(summary.winText)}</span>`);
    if (summary.yakuText) {
      lines.push(`<span>역: ${escapeHtml(summary.yakuText)}</span>`);
    }
    lines.push(`<span>점수: ${summary.points}점 (${summary.han}합 ${summary.fu}부)</span>`);
    if (summary.doraIndicators && summary.doraIndicators.length > 0) {
      const doraTiles = summary.doraIndicators.map(tile => `<span class="tile-label">${tileTitleKo(tile)}</span>`).join(' ');
      lines.push(`<span>도라: ${doraTiles}</span>`);
    }
    if (summary.uraDoraIndicators && summary.uraDoraIndicators.length > 0) {
      const uraTiles = summary.uraDoraIndicators.map(tile => `<span class="tile-label">${tileTitleKo(tile)}</span>`).join(' ');
      lines.push(`<span>우라도라: ${uraTiles}</span>`);
    }
    lines.push(`</div>`);
  } else {
    lines.push(`<div class="summary-meta">`);
    lines.push(`<span>유국</span>`);
    lines.push(`<span>오야 텐파이: ${summary.tenpai ? '예' : '아니오'}</span>`);
    lines.push(`<span>${summary.keepDealer ? '오야 유지' : '오야 이동'}</span>`);
    lines.push(`</div>`);
  }

  const rows = summary.players.map((player) => {
    return `
      <tr>
        <td>${escapeHtml(player.name)}</td>
        <td>${player.rank}</td>
        <td>${escapeHtml(player.rankChange)}</td>
        <td class="summary-row-score">${player.score}</td>
        <td class="summary-row-score summary-delta ${player.deltaClass}">${escapeHtml(player.delta)}</td>
      </tr>`;
  });

  lines.push(`
    <table class="summary-table">
      <thead>
        <tr>
          <th>플레이어</th>
          <th>등수</th>
          <th>변동</th>
          <th>점수</th>
          <th>변동</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join('')}
      </tbody>
    </table>`);

  body.innerHTML = lines.join('');
  $('summary-modal').classList.remove('hidden');
}

function buildSummaryForState(type, state, options = {}) {
  const scores = state.scores || [];
  const prevScores = handStartScores || scores;
  const prevRanks = handStartRanks || getRanks(prevScores);
  const newRanks = getRanks(scores);

  const players = scores.map((score, seat) => {
    const player = roster.players.find((p) => p.seat === seat);
    const name = player?.nickname || `좌석${seat + 1}`;
    const delta = score - (prevScores[seat] || 0);
    return {
      name,
      score,
      delta: formatDelta(delta),
      deltaClass: delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'zero',
      rank: newRanks[seat],
      rankChange: formatRankChange(prevRanks[seat] || newRanks[seat], newRanks[seat]),
      seat,
    };
  });

  players.sort((a, b) => a.rank - b.rank || b.score - a.score);

  if (type === 'draw') {
    return {
      type: 'draw',
      tenpai: options.tenpai,
      keepDealer: options.keepDealer,
      players,
    };
  }

  const winner = options.winnerSeat;
  const winnerName = options.winnerName || players.find((p) => p.seat === winner)?.name || '';
  const winWind = options.winWind || '';
  const yakuText = options.yakuText || '';

  return {
    type: 'win',
    winnerName,
    winText: options.winText || '',
    winWind,
    yakuText,
    han: options.han || 0,
    fu: options.fu || 0,
    points: options.points || 0,
    doraIndicators: options.doraIndicators || [],
    uraDoraIndicators: options.uraDoraIndicators || [],
    players,
  };
}

function setHandStartState(state) {
  if (!state || state.phase !== 'playing') return;
  if (!lastState || lastState.phase !== 'playing' || state.round !== lastState.round || state.honba !== lastState.honba) {
    handStartScores = [...state.scores];
    handStartRanks = getRanks(handStartScores);
  }
}

function setAuthState(user) {
  account = user;
  const authLine = $('auth-line');
  const logoutButton = $('btn-logout');
  const loginInputs = [$('auth-username'), $('auth-password'), $('btn-login'), $('btn-register')];

  if (user) {
    authLine.textContent = `로그인됨: ${user.username}`;
    logoutButton.classList.remove('hidden');
    loginInputs.forEach((el) => { if (el) el.disabled = true; });
  } else {
    authLine.textContent = '계정이 필요합니다. 로그인하거나 회원가입하세요.';
    logoutButton.classList.add('hidden');
    loginInputs.forEach((el) => { if (el) el.disabled = false; });
  }
}

setAuthState(null);

// 자동 로그인
const token = localStorage.getItem(tokenKey);
if (token) {
  fetch('/api/me', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      setAuthState(data);
    } else {
      localStorage.removeItem(tokenKey);
    }
  })
  .catch(() => {
    localStorage.removeItem(tokenKey);
  });
}

function seatWindLabel(seat) {
  return SEAT_WINDS[seat] ?? '?';
}

function relSeat(rel) {
  if (mySeat < 0) return rel;
  return (mySeat + rel + 4) % 4;
}

function updateRoomCodeRow() {
  const row = $('room-code-row');
  const disp = $('room-code-display');
  if (roomId) {
    row.classList.remove('hidden');
    disp.textContent = roomId;
  } else {
    row.classList.add('hidden');
    disp.textContent = '';
  }
}

function renderRoster() {
  $('room-line').textContent = roomId ? `방 코드: ${roomId}` : '';
  updateRoomCodeRow();
  const box = $('roster');
  box.innerHTML = '';
  roster.players.forEach((p) => {
    const d = document.createElement('span');
    d.className = 'seat-pill' + (p.you ? ' me' : '');
    const w = seatWindLabel(p.seat);
    d.textContent = `${w}가 ${p.nickname}${p.host ? ' · 방장' : ''}`;
    box.appendChild(d);
  });
  const me = roster.players.find((p) => p.you);
  const imHost = Boolean(me?.host);
  $('btn-start').disabled = !(roomId && roster.players.length === 4 && imHost);
}

function renderDiscardStrip(container, seat, state, tileSize) {
  container.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'strip-discards';
  const disc = state.discards[seat] || [];
  disc.forEach((t, i) => {
    const isLastRiver =
      state.lastDiscard &&
      state.lastDiscard.seat === seat &&
      i === disc.length - 1 &&
      t === state.lastDiscard.tile;
    const isDora = isTileDora(t, state.doraIndicators);
    const className = isDora ? 'tile-dora' : '';
    row.appendChild(createTileElement(t, { size: tileSize, highlight: isLastRiver, className }));
  });
  container.appendChild(row);
}

function renderPlayerZone(zoneEl, rel, state, names) {
  const seat = relSeat(rel);
  const name = names[seat] || `좌석${seat + 1}`;
  const wind = seatWindLabel(seat);

  zoneEl.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'strip-head';

  const wEl = document.createElement('span');
  wEl.className = 'strip-wind';
  wEl.textContent = wind;
  head.appendChild(wEl);

  const nEl = document.createElement('span');
  nEl.className = 'strip-name';
  nEl.textContent = name;
  head.appendChild(nEl);

  if (state.dealer === seat) {
    const o = document.createElement('span');
    o.className = 'badge-oya';
    o.textContent = '오야';
    head.appendChild(o);
  }

  // 리치 표시
  if (state.riichi && state.riichi[seat]) {
    const r = document.createElement('span');
    r.className = 'badge-riichi';
    r.textContent = '리치';
    head.appendChild(r);
  }

  const turnOk =
    state.phase === 'playing' &&
    !state.waitingRon &&
    !state.waitingNaki &&
    state.current === seat &&
    state.current >= 0;
  if (turnOk) {
    const t = document.createElement('span');
    t.className = 'badge-turn';
    t.textContent = '차례';
    head.appendChild(t);
  }

  if (state.waitingNaki && state.nakiCurrentSeat === seat) {
    const nk = document.createElement('span');
    nk.className = 'badge-turn';
    nk.textContent = '후로';
    head.appendChild(nk);
  }

  zoneEl.appendChild(head);

  // 점수 표시
  if (state.scores) {
    const scoreEl = document.createElement('div');
    scoreEl.className = 'player-score';
    scoreEl.textContent = state.scores[seat];
    zoneEl.appendChild(scoreEl);
  }

  // 리치봉 (이치봉)
  const richiStick = document.createElement('div');
  richiStick.className = 'richi-stick';
  if (state.riichi && state.riichi[seat]) {
    richiStick.classList.add('active');
  }
  zoneEl.appendChild(richiStick);

  const melds = state.melds[seat] || [];
  if (melds.length) {
    const mw = document.createElement('div');
    mw.className = 'melds-wrap';
    melds.forEach((m) => {
      const mr = document.createElement('div');
      mr.className = 'meld-row';
      m.tiles.forEach((t) => {
        const isDora = isTileDora(t, state.doraIndicators);
        const className = isDora ? 'tile-dora' : '';
        mr.appendChild(createTileElement(t, { size: 22, className }));
      });
      mw.appendChild(mr);
    });
    zoneEl.appendChild(mw);
  }

  const discWrap = document.createElement('div');
  renderDiscardStrip(discWrap, seat, state, TILE_SM);
  zoneEl.appendChild(discWrap);
}

function renderGame(state) {
  const panel = $('panel-game');
  const appEl = $('app');
  if (!roomId || !state || state.phase === 'idle') {
    panel.classList.add('hidden');
    appEl.classList.remove('table-focus');
    return;
  }
  panel.classList.remove('hidden');
  appEl.classList.add('table-focus');

  const names = roster.players.map((p) => p.nickname);
  $('wall-count-disp').textContent = String(state.wallLeft ?? '—');

  // 장풍 표시
  const roundWindEl = $('round-wind');
  if (roundWindEl) {
    const windLabels = ['동', '남', '서', '북'];
    let windText = `장풍: ${windLabels[state.prevalentWind || 0]}`;
    if (state.gameMode === 'tonpufu') {
      windText += ` · 동${state.round || 1}국`;
      if (state.honba > 0) {
        windText += ` · ${state.honba}본장`;
      }
    }
    roundWindEl.textContent = windText;
  }

  // 도라 표시패 렌더링
  const doraContainer = $('dora-indicators');
  doraContainer.innerHTML = '';
  if (state.doraIndicators && state.doraIndicators.length > 0) {
    state.doraIndicators.forEach((tile) => {
      const tileEl = createTileElement(tile, { size: 28 });
      doraContainer.appendChild(tileEl);
    });
  }
  if (state.uraDoraIndicators && state.uraDoraIndicators.length > 0) {
    const uraSection = document.createElement('div');
    uraSection.className = 'ura-dora-label';
    uraSection.textContent = '우라도라:';
    doraContainer.appendChild(uraSection);
    state.uraDoraIndicators.forEach((tile) => {
      const tileEl = createTileElement(tile, { size: 28, className: 'tile-ura' });
      doraContainer.appendChild(tileEl);
    });
  }

  const status = $('game-status');
  let main = `산패 ${state.wallLeft}장 · 오야(동가) ${seatWindLabel(state.dealer ?? 0)}가 · 나는 ${seatWindLabel(mySeat)}가`;
  if (state.phase === 'finished') {
    if (state.winner != null && state.winType) {
      const wn = names[state.winner] || `${state.winner + 1}번`;
      main =
        state.winType === 'tsumo'
          ? `종료 — 쯔모 · ${wn} (${seatWindLabel(state.winner)}가)`
          : `종료 — 론 · ${wn} (${seatWindLabel(state.winner)}가)`;
    } else main = state.error || '무승부';
  } else if (state.waitingRon) {
    main += ' · 론 대기';
  } else if (state.waitingNaki) {
    main += ' · 후로 (울기) 대기';
    if (state.nakiCurrentSeat != null) {
      const ns = names[state.nakiCurrentSeat] || seatWindLabel(state.nakiCurrentSeat) + '가';
      main += ` · 응답 차례: ${ns}`;
    }
  } else if (state.awaitingDiscardAfterMeld === mySeat) {
    main += ' · 펑/치 후 패 1장 버리기';
  } else if (state.current >= 0) {
    main += ` · 지금 차례: ${names[state.current] || seatWindLabel(state.current) + '가'}`;
  }
  status.textContent = main;

  const extra = $('game-extra');
  const parts = [];
  if (state.waitingRon) {
    const n = (state.ronPasses || []).length;
    parts.push(`론 패스 ${n}/3`);
    if (state.lastDiscard) {
      parts.push(`버림: ${seatWindLabel(state.lastDiscard.seat)}가`);
    }
  }
  if (state.waitingNaki) {
    parts.push('하가→펑·치 우선');
  }
  if (state.reveal) parts.push('전원 패 공개');
  if (state.phase === 'playing' && !state.waitingRon && state.current >= 0) {
    parts.push(`남은 산패로 유국까지 최대 약 ${Math.ceil((state.wallLeft || 0) / 4)}순`);
  }
  extra.textContent = parts.join(' · ');

  if (mySeat >= 0) {
    renderPlayerZone($('zone-top'), 2, state, names);
    renderPlayerZone($('zone-right'), 1, state, names);
    renderPlayerZone($('zone-left'), 3, state, names);
    renderPlayerZone($('zone-bottom'), 0, state, names);
  } else {
    ;['zone-top', 'zone-right', 'zone-left', 'zone-bottom'].forEach((id) => {
      $(id).innerHTML = '';
    });
  }

  const handEl = $('hand');
  handEl.innerHTML = '';
  const mine = state.hands[mySeat] || [];
  const myMeldCount = (state.melds[mySeat] || []).length;
  const needDrawn = 14 - 3 * myMeldCount;
  const canDiscard =
    state.phase === 'playing' &&
    !state.waitingRon &&
    !state.waitingNaki &&
    state.current === mySeat &&
    mine.length === needDrawn;

  mine.forEach((t) => {
    const clickable = canDiscard && t !== 'back';
    const isDora = isTileDora(t, state.doraIndicators);
    const className = isDora ? 'tile-dora' : '';
    handEl.appendChild(
      createTileElement(t, {
        size: TILE_HAND,
        clickable,
        onClick: clickable ? () => socket.emit('game:discard', { tile: t }) : undefined,
        className,
      })
    );
  });

  const imDiscarder = state.lastDiscard && state.lastDiscard.seat === mySeat;
  const conc = mine.filter((x) => x !== 'back').length;
  const canAttemptRon = state.waitingRon && !imDiscarder;
  const alreadyPassed = (state.ronPasses || []).includes(mySeat);
  const showRonButton = !!state.canRon && canAttemptRon && !alreadyPassed;
  const showPassButton = !!state.canRon && canAttemptRon && !alreadyPassed;

  if (
    state.waitingRon &&
    !state.canRon &&
    !imDiscarder &&
    !alreadyPassed &&
    mySeat >= 0
  ) {
    socket.emit('game:passRon');
  }

  const showTsumoButton = !!state.canTsumo;

  $('btn-tsumo').disabled = !showTsumoButton;
  $('btn-tsumo').classList.toggle('hidden', !showTsumoButton);
  $('btn-ron').classList.toggle('hidden', !showRonButton);
  $('btn-pass-ron').classList.toggle('hidden', !showPassButton);
  $('btn-kan').classList.toggle('hidden', !state.canKan);
  $('btn-ron').disabled = !showRonButton;
  $('btn-pass-ron').disabled = !showPassButton;
  $('btn-kan').disabled = !state.canKan;

  // 리치 버튼 표시 (자기 차례이고, 멘젠 상태이고, 1000점 이상이고, 아직 리치하지 않음)
  const canRiichi = !!state.canRiichi;
  $('btn-riichi').classList.toggle('hidden', !canRiichi);
  $('btn-riichi').disabled = !canRiichi;

  const nakiMe = state.waitingNaki && state.nakiCurrentSeat === mySeat;
  const nakiBar = $('naki-bar');
  if (state.waitingNaki) {
    nakiBar.classList.remove('hidden');
    $('btn-pon').disabled = !(nakiMe && state.nakiCanPon);
    const chiPairs = state.nakiChiPairs || [];
    const canChi = nakiMe && state.nakiCanChi && chiPairs.length >= 1;
    $('btn-chi').disabled = !canChi;
    $('btn-pass-naki').disabled = !nakiMe;

    const sel = $('chi-pair-select');
    sel.innerHTML = '';
    chiPairs.forEach(([a, b]) => {
      const opt = document.createElement('option');
      opt.value = `${a}|${b}`;
      opt.textContent = `${tileTitleKo(a)} + ${tileTitleKo(b)}`;
      sel.appendChild(opt);
    });
    if (chiPairs.length > 1) sel.classList.remove('hidden');
    else sel.classList.add('hidden');

    // Show/hide buttons based on canChi, canPon, canPassNaki
    $('btn-chi').classList.toggle('hidden', !state.canChi);
    $('btn-pon').classList.toggle('hidden', !state.canPon);
    $('btn-pass-naki').classList.toggle('hidden', !state.canPassNaki);
  } else {
    nakiBar.classList.add('hidden');
  }

  // no restart button in this version
}

socket.on('connect', () => {
  $('me-line').textContent = `연결됨 · ${socket.id.slice(0, 8)}…`;
});

socket.on('hello', () => {
  const saved = localStorage.getItem(nickKey);
  const hasToken = Boolean(localStorage.getItem(tokenKey));
  if (!hasToken && saved) socket.emit('user:nickname', { nickname: saved });
});

socket.on('user:me', (p) => {
  $('me-line').dataset.nick = p.nickname;
  $('me-line').textContent = `나: ${p.nickname}`;
  $('nick').value = p.nickname;
  if (p.username) {
    setAuthState({ username: p.username, nickname: p.nickname });
  } else {
    setAuthState(null);
    localStorage.setItem(nickKey, p.nickname);
  }
  renderRoster();
});

async function authAction(endpoint) {
  const username = $('auth-username').value.trim();
  const password = $('auth-password').value;
  if (!username || !password) {
    toast('아이디와 비밀번호를 입력하세요.');
    return null;
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, nickname: $('nick').value.trim() || username }),
    });
    const data = await resp.json();
    if (!resp.ok || !data?.ok) {
      toast(data?.error || '인증에 실패했습니다.');
      return null;
    }
    localStorage.setItem(tokenKey, data.token);
    socket.auth = { token: data.token };
    socket.disconnect();
    socket.connect();
    toast(`${endpoint === '/api/login' ? '로그인' : '회원가입'} 성공했습니다.`);
    return data;
  } catch (error) {
    toast(error.message || '서버 오류가 발생했습니다.');
    return null;
  }
}

$('btn-login').addEventListener('click', () => authAction('/api/login'));
$('btn-register').addEventListener('click', () => authAction('/api/register'));
$('btn-logout').addEventListener('click', () => {
  localStorage.removeItem(tokenKey);
  socket.auth = { token: null };
  socket.disconnect();
  socket.connect();
  setAuthState(null);
  toast('로그아웃되었습니다.');
});

socket.on('room:roster', (r) => {
  roster = r;
  if (r.roomId) roomId = r.roomId;
  const me = r.players.find((p) => p.you);
  mySeat = me ? me.seat : -1;
  renderRoster();
  if (lastState) renderGame(lastState);
});

socket.on('chat:history', (lines) => {
  const log = $('chat-log');
  log.innerHTML = '';
  lines.forEach(appendChatLine);
  log.scrollTop = log.scrollHeight;
});

socket.on('chat:message', (m) => {
  appendChatLine(m);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
});

function appendChatLine(m) {
  const log = $('chat-log');
  const div = document.createElement('div');
  div.className = 'chat-line';
  div.innerHTML = `<span class="who">${escapeHtml(m.nick)}</span>${escapeHtml(m.text)}`;
  log.appendChild(div);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

socket.on('game:state', (state) => {
  setHandStartState(state);
  lastState = state;
  renderGame(state);
});

socket.on('game:over', (p) => {
  if (!lastState) return;
  const winner = p.winnerSeat;
  const yaku = p.yaku || [];
  const yakuText = yaku.length ? yaku.map((y) => y.name).join(', ') : '없음';
  const summary = buildSummaryForState('win', lastState, {
    winnerSeat: winner,
    winnerName: p?.winnerNickname || `좌석${winner + 1}`,
    winText: p?.winType === 'ron' ? '론' : p?.winType === 'tsumo' ? '쯔모' : '승리',
    winWind: seatWindLabel(winner),
    yakuText,
    han: p.han || 0,
    fu: p.fu || 0,
    points: p.points || 0,
    doraIndicators: p.doraIndicators || [],
    uraDoraIndicators: p.uraDoraIndicators || [],
  });
  renderSummaryPopup(summary);

  const label = p?.winType === 'ron' ? '론' : p?.winType === 'tsumo' ? '쯔모' : '승리';
  toast(`${p?.winnerNickname || '승자'} ${label}!`);
});

socket.on('game:next-round', (p) => {
  toast(p.message || `다음 판 시작!`);
});

socket.on('game:draw', (p) => {
  if (lastState) {
    const summary = buildSummaryForState('draw', lastState, {
      tenpai: Boolean(p?.tenpai),
      keepDealer: Boolean(p?.keepDealer),
    });
    renderSummaryPopup(summary);
  }
  toast(p.message || '유국이 발생했습니다.');
});

socket.on('room:closed', (p) => {
  toast(p.message || '플레이어가 나갔습니다.');
  roomId = null;
  roster = { players: [] };
  mySeat = -1;
  lastState = null;
  $('panel-game').classList.add('hidden');
  $('app').classList.remove('table-focus');
  updateRoomCodeRow();
  renderRoster();
  closeSummary();
});

socket.on('game:tonpufu-finished', (p) => {
  toast(p.message || '동풍전이 종료되었습니다!');
  roomId = null;
  roster = { players: [] };
  mySeat = -1;
  lastState = null;
  $('panel-game').classList.add('hidden');
  $('app').classList.remove('table-focus');
  updateRoomCodeRow();
  renderRoster();
});

socket.on('game:error', (e) => toast(e.message || '오류'));

$('btn-summary-close').addEventListener('click', closeSummary);
$('btn-summary-close-bottom').addEventListener('click', closeSummary);

$('btn-mode-normal').addEventListener('click', () => {
  selectedGameMode = 'normal';
  $('btn-mode-normal').classList.add('active');
  $('btn-mode-tonpufu').classList.remove('active');
});

$('btn-mode-tonpufu').addEventListener('click', () => {
  selectedGameMode = 'tonpufu';
  $('btn-mode-normal').classList.remove('active');
  $('btn-mode-tonpufu').classList.add('active');
});

$('btn-copy-room').addEventListener('click', async () => {
  if (!roomId) return;
  try {
    await navigator.clipboard.writeText(roomId);
    toast('방 코드를 복사했습니다.');
  } catch {
    toast('복사에 실패했습니다. 코드를 직접 선택해 복사하세요.');
  }
});

function joinRoomById(id) {
  const code = String(id || '')
    .toUpperCase()
    .replace(/[^A-F0-9]/g, '')
    .slice(0, 8);
  if (code.length < 4) {
    toast('방 코드가 올바르지 않습니다.');
    return;
  }
  socket.emit('room:join', { roomId: code }, (j) => {
    if (!j?.ok) toast(j?.error || '입장 실패');
  });
}

$('btn-create').addEventListener('click', () => {
  socket.emit('room:create', {}, (res) => {
    if (!res?.roomId) {
      toast('방 만들기 응답이 없습니다. 서버(pnpm start)를 켰는지 확인하세요.');
      return;
    }
    roomId = res.roomId;
    joinRoomById(res.roomId);
  });
});

socket.on('room:created', (res) => {
  if (res?.roomId) {
    roomId = res.roomId;
    joinRoomById(res.roomId);
  }
});

$('btn-join').addEventListener('click', () => {
  joinRoomById($('room-code').value.trim());
});

$('btn-leave').addEventListener('click', () => {
  socket.emit('room:leave');
  roomId = null;
  roster = { players: [] };
  mySeat = -1;
  lastState = null;
  $('panel-game').classList.add('hidden');
  $('app').classList.remove('table-focus');
  renderRoster();
});

$('btn-start').addEventListener('click', () => socket.emit('room:start', { gameMode: selectedGameMode }));

$('btn-tsumo').addEventListener('click', () => socket.emit('game:tsumo'));
$('btn-ron').addEventListener('click', () => socket.emit('game:ron'));
$('btn-pass-ron').addEventListener('click', () => socket.emit('game:passRon'));
$('btn-riichi').addEventListener('click', () => socket.emit('game:riichi'));

$('btn-kan').addEventListener('click', () => socket.emit('game:kan'));

$('btn-pon').addEventListener('click', () => socket.emit('game:pon'));

$('btn-chi').addEventListener('click', () => {
  const pairs = lastState?.nakiChiPairs || [];
  if (!pairs.length) return;
  let a;
  let b;
  if (pairs.length === 1) {
    [a, b] = pairs[0];
  } else {
    const v = $('chi-pair-select').value.split('|');
    a = v[0];
    b = v[1];
  }
  socket.emit('game:chi', { tileA: a, tileB: b });
});

$('btn-pass-naki').addEventListener('click', () => socket.emit('game:passNaki'));

function sendChat() {
  const t = $('chat-input').value.trim();
  if (!t) return;
  socket.emit('chat:message', { text: t });
  $('chat-input').value = '';
}

$('btn-chat').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});
