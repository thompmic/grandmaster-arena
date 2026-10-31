const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 20000, pingTimeout: 45000 });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const rooms = new Map();
const themes = ['storm', 'inferno', 'void'];
const nameRoots = ['Storm Challenger', 'Iron Comet', 'Blaze Knight', 'Midnight Rook', 'Frost Vanguard'];
function uniqueName(room, requested) {
  const used = new Set([room.players.white?.name, room.players.black?.name, ...[...room.spectators.values()].map(p => p.name)].filter(Boolean).map(n => n.toLowerCase()));
  const base = String(requested || '').trim().slice(0, 22);
  if (base && !used.has(base.toLowerCase())) return base;
  if (base) {
    let suffix = 2, candidate = `${base.slice(0, 18)} ${suffix}`;
    while (used.has(candidate.toLowerCase())) candidate = `${base.slice(0, 18)} ${++suffix}`;
    if (candidate.length <= 22) return candidate;
  }
  let candidate;
  do { candidate = `${nameRoots[Math.floor(Math.random() * nameRoots.length)]} ${require('crypto').randomInt(100000, 1000000)}`; } while (used.has(candidate.toLowerCase()));
  return candidate;
}
function nextTheme(theme) { return themes[(themes.indexOf(theme) + 1) % themes.length]; }
const code = () => { let s = ''; for (let i = 0; i < 4; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]; return s; };
const snapshot = (room) => ({
  code: room.code, fen: room.chess.fen(), pgn: room.chess.pgn(), turn: room.chess.turn(),
  players: { white: publicPlayer(room.players.white), black: publicPlayer(room.players.black) }, spectators: [...room.spectators.values()].map(({ id, name }) => ({ id, name })),
  viewers: room.sockets.size, duelists: Object.values(room.players).filter(p => p?.connected).length, hype: room.hype, reactions: room.reactions.slice(-12), drawOffer: room.drawOffer,
  moves: room.chess.history({ verbose: true }).map(m => ({ san: m.san, from: m.from, to: m.to, color: m.color, captured: m.captured, promotion: m.promotion, flags: m.flags })),
  status: room.ended ? 'ended' : room.chess.isCheckmate() ? 'checkmate' : room.chess.isStalemate() ? 'stalemate' : room.chess.isDraw() ? 'draw' : 'playing',
  winner: room.winner || null, endType: room.endType || null,
  check: room.chess.isCheck(), createdAt: room.createdAt, clock: room.clock, clockAt: room.clockAt,
  clockRemaining: liveClock(room), lastLine: room.lastLine
});
function publicPlayer(player) { return player ? { name: player.name, theme: player.theme, connected: player.connected } : null; }
function liveClock(room) {
  const remaining = { ...room.clockRemaining };
  if (room.clock && room.clockAt) { const side = room.chess.turn() === 'w' ? 'white' : 'black'; remaining[side] = Math.max(0, remaining[side] - (Date.now() - room.clockAt) / 1000); }
  return remaining;
}
function emitState(room) { io.to(room.code).emit('state', snapshot(room)); }
function broadcastEvent(room, event) {
  const cinematic = { ...event, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, startAt: Date.now() + 180 };
  io.to(room.code).emit('cinematic', cinematic);
}
function describeMove(move, room) {
  const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const piece = names[move.piece] || 'piece';
  const crowd = ['THE ARENA ERUPTS!', 'THE CROWD IS ON ITS FEET!', 'WHAT A MOMENT IN THE COLOSSEUM!', 'THE ROAR SHAKES THE STANDS!'];
  const hits = ['WITH A THUNDEROUS STRIKE', 'FROM THE TOP ROPE', 'WITH CHAMPIONSHIP PRECISION', 'IN A BLISTERING COUNTER'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  if (move.captured === 'q' && move.piece === 'p') return `UPSET OF THE CENTURY! A PAWN TOPPLES THE QUEEN ${move.to.toUpperCase()}! ${pick(crowd)}`;
  if (move.san.includes('#')) return `THAT'S IT! CHECKMATE! ${move.color === 'w' ? room.players.white?.name : room.players.black?.name} CLAIMS THE CROWN! ${pick(crowd)}`;
  if (move.san.includes('+')) return `CHECK! THE ${piece.toUpperCase()} HAS THE KING IN ITS SIGHTS ON ${move.to.toUpperCase()}! ${pick(crowd)}`;
  if (move.captured) return `OH MY! THE ${piece.toUpperCase()} ${pick(hits)} AND TAKES DOWN THE ${names[move.captured].toUpperCase()} ON ${move.to.toUpperCase()}! ${pick(crowd)}`;
  if (move.flags.includes('k') || move.flags.includes('q')) return `THE ROYAL GUARD SWEEPS INTO FORMATION — CASTLING! ${pick(crowd)}`;
  if (move.promotion) return `ASCENSION! THE PAWN RISES AS A ${names[move.promotion].toUpperCase()}! ${pick(crowd)}`;
  return `THE ${piece.toUpperCase()} ADVANCES TO ${move.to.toUpperCase()}. THE POSITION TAKES SHAPE.`;
}
function clearDisconnectTimer(room, side) { if (room.disconnectTimers?.[side]) { clearTimeout(room.disconnectTimers[side]); room.disconnectTimers[side] = null; } }

io.on('connection', socket => {
  socket.on('create', ({ name, theme, clock } = {}, ack = () => {}) => {
    let c; do c = code(); while (rooms.has(c));
    const token = require('crypto').randomBytes(18).toString('hex');
    const player = { id: socket.id, token, name: uniqueName({ players: { white: null, black: null }, spectators: new Map() }, name), theme: themes.includes(theme) ? theme : 'storm', connected: true };
    const seconds = Number(clock) || 0;
    const room = { code: c, chess: new Chess(), players: { white: player, black: null }, spectators: new Map(), sockets: new Set(), hype: 0, reactions: [], createdAt: Date.now(), clock: seconds, clockRemaining: { white: seconds, black: seconds }, clockAt: 0, disconnectTimers: { white: null, black: null }, drawOffer: null, ended: false, winner: null, endType: null, lastLine: 'THE ARENA IS READY. WHO WILL CLAIM THE CROWN?' };
    rooms.set(c, room); socket.join(c); socket.data.room = c; socket.data.side = 'white'; room.sockets.add(socket.id);
    ack({ ok: true, state: snapshot(room), side: 'white', token, assignedName: player.name }); emitState(room);
  });
  socket.on('join', ({ code: raw, name, theme } = {}, ack = () => {}) => {
    const c = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); const room = rooms.get(c);
    if (!room) return ack({ ok: false, error: 'No arena found with that code.' });
    const available = !room.players.white || !room.players.black;
    const side = available ? (!room.players.white ? 'white' : 'black') : 'spectator';
    const token = require('crypto').randomBytes(18).toString('hex');
    let assignedTheme = themes.includes(theme) ? theme : (side === 'black' ? 'inferno' : 'storm');
    if (side === 'black' && room.players.white?.theme === assignedTheme) assignedTheme = nextTheme(assignedTheme);
    const player = { id: socket.id, token, name: uniqueName(room, name), theme: assignedTheme, connected: true };
    if (side === 'spectator') room.spectators.set(socket.id, player); else room.players[side] = player;
    if (side === 'black' && room.clock && !room.clockAt) room.clockAt = Date.now();
    room.sockets.add(socket.id); socket.join(c); socket.data.room = c; socket.data.side = side;
    ack({ ok: true, state: snapshot(room), side, token, assignedTheme, assignedName: player.name, themeChanged: side === 'black' && themes.includes(theme) && assignedTheme !== theme }); emitState(room); if(side!=='spectator')io.to(room.code).emit('playerJoined',{name:player.name,side});
    if (side !== 'spectator') clearDisconnectTimer(room, side);
  });
  socket.on('resume', ({ code: raw, token } = {}, ack = () => {}) => {
    const room = rooms.get(String(raw || '').toUpperCase()); if (!room || !token) return ack({ ok: false });
    const side = ['white', 'black'].find(s => room.players[s]?.token === token);
    if (!side) return ack({ ok: false });
    const player = room.players[side]; player.id = socket.id; player.connected = true;
    socket.join(room.code); socket.data.room = room.code; socket.data.side = side; room.sockets.add(socket.id);
    clearDisconnectTimer(room, side);
    ack({ ok: true, side, state: snapshot(room) }); io.to(room.code).emit('playerReconnected', { side }); emitState(room);
  });
  socket.on('move', ({ from, to, promotion, id } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.room); if (!room) return ack({ ok: false, error: 'Arena closed.' });
    if (room.ended) return ack({ ok: false, error: 'This match has ended.' });
    const side = socket.data.side; const player = room.players[side];
    if (!player || player.id !== socket.id || room.chess.turn() !== (side === 'white' ? 'w' : 'b')) return ack({ ok: false, error: 'It is not your turn.' });
    try {
      const activeSide = room.chess.turn() === 'w' ? 'white' : 'black';
      const elapsed = room.clock && room.clockAt ? (Date.now() - room.clockAt) / 1000 : 0;
      if (room.clock) {
        if (room.clockRemaining[activeSide] - elapsed <= 0) {
          room.clockRemaining[activeSide] = 0;
          const winner = activeSide === 'white' ? 'black' : 'white';
          room.ended = true; room.winner = winner; room.endType = 'time';
          room.lastLine = `${room.players[winner]?.name || 'CHAMPION'} WINS ON TIME! THE CROWD ERUPTS!`;
          ack({ ok: false, error: 'Time expired.' }); io.to(room.code).emit('matchEnded', { winner, state: snapshot(room) }); return;
        }
      }
      const move = room.chess.move({ from, to, promotion: promotion || 'q' });
      if (!move) return ack({ ok: false, error: 'That move is not legal.' });
      if (room.clock) room.clockRemaining[activeSide] = Math.max(0, room.clockRemaining[activeSide] - elapsed);
      if (room.chess.isGameOver()) { room.ended = true; room.endType = room.chess.isCheckmate() ? 'checkmate' : room.chess.isStalemate() ? 'stalemate' : 'draw'; room.winner = room.chess.isCheckmate() ? side : null; }
      room.clockAt = room.players.black?.connected ? Date.now() : 0; room.lastLine = describeMove(move, room);
      const event = { type: room.chess.isCheckmate() ? 'checkmate' : move.captured ? 'capture' : room.chess.isCheck() ? 'check' : (move.flags.includes('k') || move.flags.includes('q')) ? 'castle' : move.promotion ? 'promotion' : 'move', move: { san: move.san, from: move.from, to: move.to, color: move.color, piece: move.piece, captured: move.captured, promotion: move.promotion, flags: move.flags }, line: room.lastLine, winner: room.winner, theme: player.theme, hype: room.hype, requestId: id };
      ack({ ok: true, state: snapshot(room) });
      io.to(room.code).emit('moveCommitted', { state: snapshot(room), requestId: id });
      broadcastEvent(room, event);
      if (event.type === 'capture' || event.type === 'checkmate') room.hype = Math.min(100, room.hype + (move.captured === 'q' ? 30 : 16));
      emitState(room);
    } catch (_) { ack({ ok: false, error: 'That move is not legal.' }); }
  });
  socket.on('legalMoves', ({ square } = {}, ack = () => {}) => { const room=rooms.get(socket.data.room), side=socket.data.side; if(!room||room.ended||!['white','black'].includes(side)||room.players[side]?.id!==socket.id||room.chess.turn()!==(side==='white'?'w':'b')) return ack({moves:[]}); ack({moves:room.chess.moves({square,verbose:true}).map(m=>m.to)}); });
  socket.on('reaction', ({ emoji, cheer } = {}) => { const room = rooms.get(socket.data.room); if (!room) return; room.hype = Math.max(0, Math.min(100, room.hype + (cheer ? 6 : -5))); room.reactions.push({ emoji: ['👏','🔥','⚡','👑','💀','🎉'].includes(emoji) ? emoji : (cheer ? '👏' : '👎'), name: room.spectators.get(socket.id)?.name || 'Fan', at: Date.now() }); room.reactions = room.reactions.slice(-24); io.to(room.code).emit('reaction', { ...room.reactions.at(-1), hype: room.hype }); emitState(room); });
  socket.on('resign', () => { const room = rooms.get(socket.data.room); const side = socket.data.side; if (!room || room.ended || !['white','black'].includes(side) || room.players[side]?.id !== socket.id) return; const winner = side === 'white' ? 'black' : 'white'; room.ended = true; room.winner = winner; room.endType = 'forfeit'; room.lastLine = `${room.players[winner]?.name || 'THE CHAMPION'} WINS BY RESIGNATION!`; broadcastEvent(room, { type: 'checkmate', line: room.lastLine, winner, theme: room.players[winner]?.theme || 'inferno' }); setTimeout(()=>{if(rooms.has(room.code))io.to(room.code).emit('matchEnded', { winner, state: snapshot(room) });},3000); });
  socket.on('draw', () => { const room = rooms.get(socket.data.room); const side = socket.data.side; if (!room || room.ended || !['white','black'].includes(side) || room.players[side]?.id !== socket.id || room.drawOffer) return; room.drawOffer = side; io.to(room.code).emit('drawOffered', { name: room.players[side].name, side }); });
  socket.on('drawResponse', ({ accept } = {}) => { const room = rooms.get(socket.data.room); const side = socket.data.side; if (!room || room.ended || !room.drawOffer || !['white','black'].includes(side) || room.drawOffer === side || room.players[side]?.id !== socket.id) return; room.drawOffer = null; if (accept) { room.ended = true; room.endType = 'draw'; room.winner = null; room.lastLine = 'THE CHAMPIONS AGREE TO A DRAW. THE ARENA SALUTES BOTH WARRIORS.'; io.to(room.code).emit('matchEnded', { winner: null, state: snapshot(room) }); } else io.to(room.code).emit('drawDeclined'); });
  socket.on('rematch', () => { const room=rooms.get(socket.data.room), side=socket.data.side; if(!room||!room.ended||!['white','black'].includes(side)||room.players[side]?.id!==socket.id)return; room.rematchVotes??=new Set(); room.rematchVotes.add(side); if(room.rematchVotes.size<2){io.to(room.code).emit('rematchWaiting',{side});return;} const oldWhite=room.players.white,oldBlack=room.players.black; room.players={white:{...oldBlack},black:{...oldWhite}}; for(const s of room.sockets){const client=io.sockets.sockets.get(s); if(client?.data.room===room.code&&['white','black'].includes(client.data.side))client.data.side=client.data.side==='white'?'black':'white';} room.chess=new Chess();room.hype=0;room.reactions=[];room.drawOffer=null;room.ended=false;room.winner=null;room.endType=null;room.rematchVotes.clear();room.clockRemaining={white:room.clock,black:room.clock};room.clockAt=room.clock&&room.players.black?.connected?Date.now():0;room.lastLine='THE REMATCH IS ON. COLORS HAVE CHANGED.';io.to(room.code).emit('rematchStarted',{state:snapshot(room)});emitState(room); });
  socket.on('seat', seat => { if (['director','ringside','behind-white','behind-black','stands','free'].includes(seat)) socket.data.seat = seat; });
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room); if (!room) return; room.sockets.delete(socket.id);
    if (socket.data.side === 'spectator') room.spectators.delete(socket.id);
    else if (!room.ended && ['white','black'].includes(socket.data.side) && room.players[socket.data.side]?.id === socket.id) {
      const side = socket.data.side; room.players[side].connected = false; if(!room.players.white?.connected&&!room.players.black){rooms.delete(room.code);return;} if(!room.players.white?.connected||!room.players.black?.connected)io.to(room.code).emit('playerDisconnected', { side, seconds: 60 });
      clearDisconnectTimer(room, side);
      if(room.players.white&&room.players.black) room.disconnectTimers[side] = setTimeout(() => { if (rooms.has(room.code) && room.players[side] && !room.players[side].connected) { const winner = side === 'white' ? 'black' : 'white'; room.ended = true; room.winner = winner; room.endType = 'disconnect'; room.lastLine = `${room.players[winner]?.name || 'Opponent'} WINS BY FORFEIT.`; io.to(room.code).emit('matchEnded', { winner, state: snapshot(room) }); } }, 60000);
      emitState(room);
    }
    emitState(room);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Grandmaster Arena listening on ${port}`));
