import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { createRoomManager } from './roomManager.js';
import { createAccountStore } from './accountStore.js';
import {
  discardTile,
  declareTsumo,
  declareRon,
  passRon,
  passNaki,
  declarePon,
  declareChi,
  declareRiichi,
  declareKan,
  isTenpai,
} from './game/mahjongGame.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
});

const rm = createRoomManager();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const accounts = createAccountStore(path.join(__dirname, 'accounts.json'));
const PORT = Number(process.env.PORT) || 3000;

function getTokenFromReq(req) {
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function apiError(res, error, code = 400) {
  return res.status(code).json({ ok: false, error });
}

/** @param {import('socket.io').Socket} socket */
function leaveIoRooms(socket) {
  for (const room of socket.rooms) {
    if (room !== socket.id) socket.leave(room);
  }
}

/** 화료 후 최종 상태 전송 → 방 해산 → 모든 소켓 퇴장 */
function finalizeMatchWin(io, rm, room, rid, winnerSeat, winType) {
  rm.broadcastState(room, io, rid);
  const wn =
    room.players.find((p) => p.seat === winnerSeat)?.nickname || `좌석${winnerSeat + 1}`;
  io.to(`room:${rid}`).emit('game:over', {
    winType,
    winnerSeat,
    winnerNickname: wn,
    yaku: room.game.yaku[winnerSeat],
    fu: room.game.fu[winnerSeat],
    han: room.game.han[winnerSeat],
    points: room.game.points[winnerSeat],
    scoreChanges: room.game.scoreChanges,
    doraIndicators: room.game.doraIndicators,
    uraDoraIndicators: room.game.uraDoraIndicators,
  });
  
  if (room.game.gameMode === 'tonpufu') {
    const keepDealer = winnerSeat === room.game.dealer;
    const result = rm.autoStartNextRound(rid, keepDealer);
    if (result.ok) {
      rm.broadcastState(room, io, rid);
      io.to(`room:${rid}`).emit('game:next-round', {
        round: room.game.round,
        message: `동${room.game.round}국 시작! ${keepDealer ? '오야 렌짱' : '다음 오야'}`,
      });
    } else {
      const sids = rm.dissolveRoom(rid);
      for (const sid of sids) {
        const sock = io.sockets.sockets.get(sid);
        if (sock) {
          sock.leave(`room:${rid}`);
          sock.data.roomId = null;
        }
      }
      io.to(`room:${rid}`).emit('game:tonpufu-finished', {
        message: '동풍전이 종료되었습니다!',
      });
    }
  } else {
    const sids = rm.dissolveRoom(rid);
    for (const sid of sids) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) {
        sock.leave(`room:${rid}`);
        sock.data.roomId = null;
      }
    }
  }
}

function finalizeDrawEnd(io, rm, room, rid) {
  const dealer = room.game.dealer;
  const tenpai = isTenpai(room.game, dealer);
  const keepDealer = tenpai;
  const result = rm.autoStartNextRound(rid, keepDealer);
  if (result.ok) {
    rm.broadcastState(room, io, rid);
    io.to(`room:${rid}`).emit('game:draw', {
      tenpai,
      keepDealer,
      round: room.game.round,
      message: tenpai
        ? `유국! 오야 텐파이로 렌짱, 동${room.game.round}국 시작!`
        : `유국! 오야 노텐, 다음 오야로 넘어갑니다. 동${room.game.round}국 시작!`,
    });
  } else {
    const sids = rm.dissolveRoom(rid);
    for (const sid of sids) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) {
        sock.leave(`room:${rid}`);
        sock.data.roomId = null;
      }
    }
    io.to(`room:${rid}`).emit('game:tonpufu-finished', {
      message: '동풍전이 종료되었습니다!',
    });
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.post('/api/register', (req, res) => {
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  const nickname = String(req.body?.nickname || username).trim().slice(0, 24);
  const result = accounts.registerUser(username, password, nickname);
  if (!result.ok) return apiError(res, result.error);
  return res.json({ ok: true, token: result.token, username: result.user.username, nickname: result.user.nickname });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  const result = accounts.loginUser(username, password);
  if (!result.ok) return apiError(res, result.error);
  return res.json({ ok: true, token: result.token, username: result.user.username, nickname: result.user.nickname });
});

app.get('/api/me', (req, res) => {
  const token = getTokenFromReq(req);
  const user = token ? accounts.getUserByToken(token) : null;
  if (!user) return apiError(res, '로그인 상태가 아닙니다.', 401);
  return res.json({ ok: true, username: user.username, nickname: user.nickname });
});

const spritePaths = [
  path.join(__dirname, '../public/spritesheet.png'),
  path.join(__dirname, '../spritesheet.png'),
];
app.get('/game-assets/spritesheet.png', (req, res) => {
  for (const p of spritePaths) {
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(404).type('text/plain').send('spritesheet.png 없음: public/spritesheet.png 또는 프로젝트 루트에 두세요.');
});

io.on('connection', (socket) => {
  const authToken = socket.handshake.auth?.token;
  const account = authToken ? accounts.getUserByToken(authToken) : null;
  socket.data.account = account || null;
  socket.data.nickname = account?.username || `손님${socket.id.slice(0, 4)}`;
  socket.data.roomId = null;

  socket.emit('hello', {
    id: socket.id,
    nickname: socket.data.nickname,
    username: account?.username || null,
  });

  socket.on('user:nickname', (payload) => {
    const n = typeof payload?.nickname === 'string' ? payload.nickname.trim().slice(0, 24) : '';
    if (!n) return;
    socket.data.nickname = n;
    if (socket.data.account) {
      const updated = accounts.updateNickname(socket.data.account.username, n);
      if (updated) socket.data.account = { ...socket.data.account, nickname: updated.nickname };
    }
    if (socket.data.roomId) {
      const room = rm.getRoom(socket.data.roomId);
      if (room) {
        const player = room.players.find((p) => p.socketId === socket.id);
        if (player) player.nickname = n;
        emitRoster(io, room);
      }
    }
    socket.emit('user:me', {
      id: socket.id,
      nickname: socket.data.nickname,
      username: socket.data.account?.username || null,
    });
  });

  socket.on('room:create', (_payload, ack) => {
    const id = rm.createRoom();
    if (typeof ack === 'function') ack({ roomId: id });
    else socket.emit('room:created', { roomId: id });
  });

  socket.on('room:join', (payload, ack) => {
    const roomId = String(payload?.roomId || '')
      .toUpperCase()
      .replace(/[^A-F0-9]/g, '')
      .slice(0, 8);
    if (roomId.length < 4) {
      const err = '유효한 방 코드가 아닙니다.';
      if (typeof ack === 'function') ack({ ok: false, error: err });
      return;
    }
    if (!rm.getRoom(roomId)) {
      if (typeof ack === 'function') ack({ ok: false, error: '방을 찾을 수 없습니다.' });
      return;
    }
    rm.leaveAllRooms(socket.id);
    const { ok, error, room } = rm.joinRoom(roomId, socket.id, socket.data.nickname);
    if (!ok) {
      if (typeof ack === 'function') ack({ ok: false, error });
      return;
    }
    leaveIoRooms(socket);
    socket.join(`room:${roomId}`);
    socket.data.roomId = roomId;
    if (typeof ack === 'function') ack({ ok: true, roomId });
    emitRoster(io, room);
    socket.emit('chat:history', room.chat.slice(-50));
    rm.broadcastState(room, io, roomId);
  });

  socket.on('room:leave', () => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    const leavingName = socket.data.nickname || '플레이어';
    if (room && room.game.phase === 'playing') {
      io.to(`room:${rid}`).emit('room:closed', {
        message: `${leavingName}가 나갔습니다. 게임이 종료됩니다.`,
        leftNickname: leavingName,
      });
      rm.dissolveRoom(rid);
    }

    rm.leaveAllRooms(socket.id);
    socket.leave(`room:${rid}`);
    socket.data.roomId = null;

    const remaining = rm.getRoom(rid);
    if (remaining) {
      emitRoster(io, remaining);
      rm.broadcastState(remaining, io, rid);
    }
  });

  socket.on('room:start', (payload) => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    if (!room) return;
    const gameMode = payload?.gameMode || 'normal'; // 'normal' or 'tonpufu'
    const res = rm.startGameIfHost(rid, socket.id, gameMode);
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    io.to(`room:${rid}`).emit('game:started');
    rm.broadcastState(res.room, io, rid);
  });

  socket.on('game:restart', () => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const res = rm.restartGame(rid, socket.id);
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    io.to(`room:${rid}`).emit('game:restarted');
    rm.broadcastState(res.room, io, rid);
  });

  socket.on('chat:message', (payload) => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const text = typeof payload?.text === 'string' ? payload.text : '';
    const room = rm.getRoom(rid);
    if (!room) return;
    rm.addChat(rid, socket.data.nickname, text);
    const last = room.chat[room.chat.length - 1];
    io.to(`room:${rid}`).emit('chat:message', last);
  });

  socket.on('game:discard', (payload) => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    if (!room) return;
    const seat = rm.findSeat(rid, socket.id);
    if (seat < 0) {
      socket.emit('game:error', { message: '방에 입장한 상태가 아닙니다.' });
      return;
    }
    const tile = typeof payload?.tile === 'string' ? payload.tile : '';
    if (!discardTile(room.game, seat, tile)) {
      socket.emit('game:error', { message: room.game.error || '버리기 실패' });
      return;
    }
    io.to(`room:${rid}`).emit('game:event', { type: 'discard', seat, tile });
    rm.broadcastState(room, io, rid);
  });

  socket.on('game:tsumo', () => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    if (!room) return;
    const seat = rm.findSeat(rid, socket.id);
    if (seat < 0) {
      socket.emit('game:error', { message: '방에 입장한 상태가 아닙니다.' });
      return;
    }
    if (!declareTsumo(room.game, seat)) {
      socket.emit('game:error', { message: room.game.error || '쯔모 불가' });
      return;
    }
    io.to(`room:${rid}`).emit('game:event', { type: 'tsumo', seat });
    finalizeMatchWin(io, rm, room, rid, seat, 'tsumo');
  });

  socket.on('game:ron', () => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    if (!room) return;
    const seat = rm.findSeat(rid, socket.id);
    if (seat < 0) {
      socket.emit('game:error', { message: '방에 입장한 상태가 아닙니다.' });
      return;
    }
    if (!declareRon(room.game, seat)) {
      socket.emit('game:error', { message: room.game.error || '론 불가' });
      return;
    }
    io.to(`room:${rid}`).emit('game:event', { type: 'ron', seat });
    finalizeMatchWin(io, rm, room, rid, seat, 'ron');
  });

  socket.on('game:passRon', () => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    if (!room) return;
    const seat = rm.findSeat(rid, socket.id);
    if (seat < 0) {
      socket.emit('game:error', { message: '방에 입장한 상태가 아닙니다.' });
      return;
    }
    if (!passRon(room.game, seat)) {
      socket.emit('game:error', { message: room.game.error || '패스 불가' });
      return;
    }
    io.to(`room:${rid}`).emit('game:event', { type: 'passRon', seat });
    rm.broadcastState(room, io, rid);
    if (room.game.phase === 'finished' && room.game.winner === null) {
      finalizeDrawEnd(io, rm, room, rid);
    }
  });

  socket.on('game:passNaki', () => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    if (!room) return;
    const seat = rm.findSeat(rid, socket.id);
    if (seat < 0) {
      socket.emit('game:error', { message: '방에 입장한 상태가 아닙니다.' });
      return;
    }
    if (!passNaki(room.game, seat)) {
      socket.emit('game:error', { message: room.game.error || '후로 패스 불가' });
      return;
    }
    io.to(`room:${rid}`).emit('game:event', { type: 'passNaki', seat });
    rm.broadcastState(room, io, rid);
  });

  socket.on('game:riichi', () => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    if (!room) return;
    const seat = rm.findSeat(rid, socket.id);
    if (seat < 0) {
      socket.emit('game:error', { message: '방에 입장한 상태가 아닙니다.' });
      return;
    }
    if (!declareRiichi(room.game, seat)) {
      socket.emit('game:error', { message: room.game.error || '리치 불가' });
      return;
    }
    io.to(`room:${rid}`).emit('game:event', { type: 'riichi', seat });
    rm.broadcastState(room, io, rid);
  });

  socket.on('game:pon', () => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    if (!room) return;
    const seat = rm.findSeat(rid, socket.id);
    if (seat < 0) {
      socket.emit('game:error', { message: '방에 입장한 상태가 아닙니다.' });
      return;
    }
    if (!declarePon(room.game, seat)) {
      socket.emit('game:error', { message: room.game.error || '펑 불가' });
      return;
    }
    io.to(`room:${rid}`).emit('game:event', { type: 'pon', seat });
    rm.broadcastState(room, io, rid);
  });

  socket.on('game:chi', (payload) => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    if (!room) return;
    const seat = rm.findSeat(rid, socket.id);
    if (seat < 0) {
      socket.emit('game:error', { message: '방에 입장한 상태가 아닙니다.' });
      return;
    }
    const a = typeof payload?.tileA === 'string' ? payload.tileA : '';
    const b = typeof payload?.tileB === 'string' ? payload.tileB : '';
    if (!declareChi(room.game, seat, a, b)) {
      socket.emit('game:error', { message: room.game.error || '치 불가' });
      return;
    }
    io.to(`room:${rid}`).emit('game:event', { type: 'chi', seat, tileA: a, tileB: b });
    rm.broadcastState(room, io, rid);
  });

  socket.on('game:kan', (payload) => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = rm.getRoom(rid);
    if (!room) return;
    const seat = rm.findSeat(rid, socket.id);
    if (seat < 0) {
      socket.emit('game:error', { message: '방에 입장한 상태가 아닙니다.' });
      return;
    }
    const tile = typeof payload?.tile === 'string' ? payload.tile : null;
    if (!declareKan(room.game, seat, tile)) {
      socket.emit('game:error', { message: room.game.error || '깡 불가' });
      return;
    }
    io.to(`room:${rid}`).emit('game:event', { type: 'kan', seat, tile });
    rm.broadcastState(room, io, rid);
    if (room.game.phase === 'finished' && room.game.winner === null) {
      finalizeDrawEnd(io, rm, room, rid);
    }
  });

  socket.on('disconnect', () => {
    const rid = socket.data.roomId;
    const room = rid ? rm.getRoom(rid) : null;
    const leavingName = socket.data.nickname || '플레이어';
    if (room && room.game.phase === 'playing') {
      io.to(`room:${rid}`).emit('room:closed', {
        message: `${leavingName}가 나갔습니다. 게임이 종료됩니다.`,
        leftNickname: leavingName,
      });
      rm.dissolveRoom(rid);
    }

    rm.leaveAllRooms(socket.id);
    if (rid) {
      const remaining = rm.getRoom(rid);
      if (remaining) {
        emitRoster(io, remaining);
        rm.broadcastState(remaining, io, rid);
      }
    }
  });
});

function emitRoster(io, room) {
  for (const p of room.players) {
    io.to(p.socketId).emit('room:roster', {
      roomId: room.id,
      players: room.players.map((x, i) => ({
        nickname: x.nickname,
        seat: x.seat,
        host: i === 0,
        you: x.socketId === p.socketId,
      })),
    });
  }
}

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
