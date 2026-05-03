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
     * @param {string} displayName
     * @param {string|null} username
     */
    joinRoom(roomId, socketId, displayName, username = null) {
      const room = rooms.get(roomId);
      if (!room) return { ok: false, error: '방을 찾을 수 없습니다.' };
      if (room.players.length >= SEATS) return { ok: false, error: '방이 가득 찼습니다.' };
      const existing = room.players.find((p) => p.socketId === socketId);
      if (existing) {
        existing.displayName = displayName.slice(0, 24);
        existing.username = username;
        existing.nickname = displayName.slice(0, 24);
        return { ok: true, room };
      }
      const seat = room.players.length;
      room.players.push({ socketId, displayName: displayName.slice(0, 24), username, nickname: displayName.slice(0, 24), seat });
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

    /** @param {string} roomId @param {string} socketId */
    startGameIfHost(roomId, socketId, gameMode = 'normal') {
      const room = rooms.get(roomId);
      if (!room) return { ok: false, error: '방을 찾을 수 없습니다.' };
      if (room.players.length !== SEATS) return { ok: false, error: `시작하려면 ${SEATS}명이 필요합니다.` };
      if (room.players[0]?.socketId !== socketId) return { ok: false, error: '첫 입장자만 게임을 시작할 수 있습니다.' };
      startGame(room.game, 0, gameMode, 1, 0);
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
      // 기존 gameMode 유지, 새 게임으로 초기화
      const gameMode = room.game.gameMode || 'normal';
      startGame(room.game, 0, gameMode, 1, 0);
      return { ok: true, room };
    },

    /** 동풍전 자동 다음 판 시작 */
    autoStartNextRound(roomId, keepDealer = false) {
      const room = rooms.get(roomId);
      if (!room) return { ok: false, error: '방을 찾을 수 없습니다.' };
      if (room.game.gameMode !== 'tonpufu') return { ok: false, error: '동풍전 모드가 아닙니다.' };

      if (!keepDealer) {
        room.game.round++;
        if (room.game.round > 4) {
          return { ok: false, error: '동풍전이 종료되었습니다.' };
        }
      }
      
      const nextDealer = keepDealer ? room.game.dealer : (room.game.dealer + 1) % SEATS;
      room.game.honba = keepDealer ? room.game.honba + 1 : 0;
      startGame(room.game, nextDealer, 'tonpufu', room.game.round, room.game.honba);
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
