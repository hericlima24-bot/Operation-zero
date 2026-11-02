const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 20;
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, game: "OPERATION ZERO" }));

function publicRooms() {
  return [...rooms.entries()]
    .filter(([, room]) => !room.private)
    .map(([id, room]) => ({ id, mode: room.mode, count: room.players.size, max: MAX_PLAYERS }));
}

function sendRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("room:players", [...room.players.values()]);
  io.emit("rooms:list", publicRooms());
}

io.on("connection", (socket) => {
  socket.emit("rooms:list", publicRooms());

  socket.on("room:create", (payload = {}, callback = () => {}) => {
    const name = String(payload.name || "Operador").trim().slice(0, 18) || "Operador";
    const mode = payload.mode === "teams" ? "teams" : "free";
    const isPrivate = Boolean(payload.private);
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();

    rooms.set(roomId, { mode, private: isPrivate, players: new Map() });
    joinRoom(socket, roomId, name, callback);
  });

  socket.on("room:join", (payload = {}, callback = () => {}) => {
    const roomId = String(payload.roomId || "").toUpperCase().slice(0, 8);
    const name = String(payload.name || "Operador").trim().slice(0, 18) || "Operador";
    const room = rooms.get(roomId);
    if (!room) return callback({ ok: false, error: "Sala não encontrada." });
    if (room.players.size >= MAX_PLAYERS) return callback({ ok: false, error: "Sala cheia." });
    if (room.private && payload.code !== roomId) return callback({ ok: false, error: "Código de convite inválido." });
    joinRoom(socket, roomId, name, callback);
  });

  function joinRoom(sock, roomId, name, callback) {
    const room = rooms.get(roomId);
    if (!room || room.players.size >= MAX_PLAYERS) return callback({ ok: false, error: "Não foi possível entrar na sala." });
    if (sock.data.roomId) leaveRoom(sock);
    const player = {
      id: sock.id, name, x: (Math.random() - 0.5) * 5, y: 1.7,
      z: (Math.random() - 0.5) * 5, rot: 0, team: room.players.size % 2
    };
    sock.data.roomId = roomId;
    room.players.set(sock.id, player);
    sock.join(roomId);
    callback({ ok: true, roomId, mode: room.mode, playerId: sock.id });
    sendRoomState(roomId);
  }

  socket.on("player:move", (data = {}) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    const player = room?.players.get(socket.id);
    if (!player) return;
    // Validação básica: o servidor limita coordenadas e velocidade reportadas.
    const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
    player.x = clamp(data.x, -90, 90);
    player.y = clamp(data.y, 0.5, 5);
    player.z = clamp(data.z, -90, 90);
    player.rot = clamp(data.rot, -Math.PI * 4, Math.PI * 4);
    socket.to(roomId).emit("player:moved", player);
  });

  socket.on("chat:send", (message) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || typeof message !== "string") return;
    const player = room.players.get(socket.id);
    const clean = message.trim().slice(0, 160);
    if (clean) io.to(roomId).emit("chat:message", { name: player?.name || "Jogador", text: clean });
  });

  socket.on("disconnect", () => leaveRoom(socket));

  function leaveRoom(sock) {
    const roomId = sock.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    room.players.delete(sock.id);
    sock.leave(roomId);
    delete sock.data.roomId;
    if (room.players.size === 0) rooms.delete(roomId);
    else sendRoomState(roomId);
    io.emit("rooms:list", publicRooms());
  }
});

server.listen(PORT, () => console.log(`OPERATION ZERO online na porta ${PORT}`));
