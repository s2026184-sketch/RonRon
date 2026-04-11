import { randomBytes } from 'crypto';
import {
  createMahjongState,
  startGame,
  discardTile,
  declareTsumo,
  declareRon,
  passRon,
  publicSnapshot,
  SEATS,
} from './game/mahjongGame.js';

function roomCode() {
  return randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
}

export function createRoomManager() {
  /** @type {Map<string, Room>} */
  const rooms = new Map();

  /** @param {string} id */
  function getOrCreateRoom(id) {
    let r = rooms.get(id);
    if (!r) {
      r = {
        id,
        players: [],
        game: createMahjongState(),
        chat: /** @type {{ nick: string, text: string, at: number }[]} */ ([]),
      };
      rooms.set(id, r);
    }
    return r;
  }

  return {
    rooms,

      createRoom() {
      let id = roomCode();
      while (rooms.has(id)) id = roomCode();
      getOrCreateRoom(id);
      return id;
    },

    /** @param {string} roomId */
    getRoom(roomId) {
      return rooms.get(roomId) || null;
    },

    /**
     * @param {string} roomId
     * @param {string} socketId
     * @param {string} nickname
     */
    joinRoom(roomId, socketId, nickname) {
      const room = rooms.get(roomId);
      if (!room) return { ok: false, error: '방을 찾을 수 없습니다.' };
      if (room.players.length >= SEATS) return { ok: false, error: '방이 가득 찼습니다.' };
      const existing = room.players.find((p) => p.socketId === socketId);
      if (existing) {
        existing.nickname = nickname.slice(0, 24);
        return { ok: true, room };
      }
      const seat = room.players.length;
      room.players.push({ socketId, nickname: nickname.slice(0, 24), seat });
      return { ok: true, room };
    },

    /** @param {string} socketId */
    leaveAllRooms(socketId) {
      for (const room of [...rooms.values()]) {
        const i = room.players.findIndex((p) => p.socketId === socketId);
        if (i === -1) continue;
        room.players.splice(i, 1);
        for (let s = 0; s < room.players.length; s++) room.players[s].seat = s;
        if (room.players.length === 0) rooms.delete(room.id);
      }
    },

    /** @param {string} roomId @param {string} socketId */
    findSeat(roomId, socketId) {
      const room = rooms.get(roomId);
      if (!room) return -1;
      const p = room.players.find((x) => x.socketId === socketId);
      return p ? p.seat : -1;
    },

    /** @param {string} roomId */
    startGameIfHost(roomId, socketId) {
      const room = rooms.get(roomId);
      if (!room) return { ok: false, error: '방을 찾을 수 없습니다.' };
      if (room.players.length !== SEATS) return { ok: false, error: `시작하려면 ${SEATS}명이 필요합니다.` };
      if (room.players[0]?.socketId !== socketId) return { ok: false, error: '첫 입장자만 게임을 시작할 수 있습니다.' };
      startGame(room.game, 0);
      return { ok: true, room };
    },

    /** @param {string} roomId @param {string} nick @param {string} text */
    addChat(roomId, nick, text) {
      const room = rooms.get(roomId);
      if (!room) return;
      const t = text.trim().slice(0, 500);
      if (!t) return;
      room.chat.push({ nick, text: t, at: Date.now() });
      if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100);
    },

    broadcastState(room, io, roomId) {
      for (const p of room.players) {
        const seat = p.seat;
        io.to(p.socketId).emit('game:state', publicSnapshot(room.game, seat));
      }
    },

    /** @param {string} roomId @param {string} socketId */
    restartGame(roomId, socketId) {
      const room = rooms.get(roomId);
      if (!room) return { ok: false, error: '방을 찾을 수 없습니다.' };
      if (room.players[0]?.socketId !== socketId) return { ok: false, error: '첫 입장자만 다시 시작할 수 있습니다.' };
      if (room.players.length !== SEATS) return { ok: false, error: `다시 시작하려면 ${SEATS}명이 필요합니다.` };
      startGame(room.game, 0);
      return { ok: true, room };
    },

    /** 승리 후 방 삭제, 소켓 id 목록 반환 (퇴장 처리용) */
    dissolveRoom(roomId) {
      const room = rooms.get(roomId);
      if (!room) return [];
      const socketIds = room.players.map((p) => p.socketId);
      rooms.delete(roomId);
      return socketIds;
    },
  };
}
