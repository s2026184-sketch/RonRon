import { createMahjongState, startGame, isTenpai } from './server/game/mahjongGame.js';
const st = createMahjongState();
startGame(st, 0, 'normal', 1, 0);
console.log('lastDraw', st.lastDraw);
console.log('isTenpai', isTenpai(st, 0));
