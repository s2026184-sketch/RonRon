import { createTileElement, tileTitleKo } from './tiles.js';

const socket = io();

socket.on('connect_error', (err) => {
  toast(`연결 실패: ${err.message || '서버가 꺼졌거나 주소가 다릅니다.'}`);
});

const $ = (id) => document.getElementById(id);

const nickKey = 'mahjong-nick';
/** 서버 좌석 0~3 = 동·남·서·북 가 */
const SEAT_WINDS = ['동', '남', '서', '북'];

let mySeat = -1;
let lastState = null;
let roomId = null;
let roster = { players: [] };

const TILE_SM = 26;
const TILE_HAND = 46;

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3200);
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
  updateRestartButton(imHost);
}

function updateRestartButton(imHost) {
  const done = lastState && lastState.phase === 'finished';
  $('btn-restart').disabled = !(imHost && roster.players.length === 4 && done);
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
    row.appendChild(createTileElement(t, { size: tileSize, highlight: isLastRiver }));
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

  const melds = state.melds[seat] || [];
  if (melds.length) {
    const mw = document.createElement('div');
    mw.className = 'melds-wrap';
    melds.forEach((m) => {
      const mr = document.createElement('div');
      mr.className = 'meld-row';
      m.tiles.forEach((t) => mr.appendChild(createTileElement(t, { size: 22 })));
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
    handEl.appendChild(
      createTileElement(t, {
        size: TILE_HAND,
        clickable,
        onClick: clickable ? () => socket.emit('game:discard', { tile: t }) : undefined,
      })
    );
  });

  const imDiscarder = state.lastDiscard && state.lastDiscard.seat === mySeat;
  const conc = mine.filter((x) => x !== 'back').length;
  const canRon =
    state.waitingRon && !imDiscarder && conc === 13 - 3 * myMeldCount;
  const alreadyPassed = (state.ronPasses || []).includes(mySeat);

  $('btn-tsumo').disabled = !(
    state.phase === 'playing' &&
    !state.waitingRon &&
    !state.waitingNaki &&
    state.current === mySeat &&
    mine.length === needDrawn
  );
  $('btn-ron').disabled = !(canRon && !alreadyPassed);
  $('btn-pass-ron').disabled = !(canRon && !alreadyPassed);

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
  } else {
    nakiBar.classList.add('hidden');
  }

  const me = roster.players.find((p) => p.you);
  updateRestartButton(Boolean(me?.host));
}

socket.on('connect', () => {
  $('me-line').textContent = `연결됨 · ${socket.id.slice(0, 8)}…`;
});

socket.on('hello', () => {
  const saved = localStorage.getItem(nickKey);
  if (saved) socket.emit('user:nickname', { nickname: saved });
});

socket.on('user:me', (p) => {
  $('me-line').dataset.nick = p.nickname;
  $('me-line').textContent = `나: ${p.nickname}`;
  $('nick').value = p.nickname;
  localStorage.setItem(nickKey, p.nickname);
  renderRoster();
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
  lastState = state;
  renderGame(state);
});

socket.on('game:over', (p) => {
  const label = p?.winType === 'ron' ? '론' : p?.winType === 'tsumo' ? '쯔모' : '승리';
  toast(`${p?.winnerNickname || '승자'} ${label}! 방이 닫혔습니다.`);
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

$('btn-save-nick').addEventListener('click', () => {
  const v = $('nick').value.trim();
  if (v) socket.emit('user:nickname', { nickname: v });
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

$('btn-start').addEventListener('click', () => socket.emit('room:start'));
$('btn-restart').addEventListener('click', () => socket.emit('game:restart'));

$('btn-tsumo').addEventListener('click', () => socket.emit('game:tsumo'));
$('btn-ron').addEventListener('click', () => socket.emit('game:ron'));
$('btn-pass-ron').addEventListener('click', () => socket.emit('game:passRon'));

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
