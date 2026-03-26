const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state
let gameState = {
  isLocked: false,
  winner: null,
  winnerTime: null,
  owner: null,
  players: new Map(), // socketId -> { name, joinedAt }
  buzzOrder: [],
  roundNumber: 0
};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Send current state to new connection
  socket.emit('game-state', {
    isLocked: gameState.isLocked,
    winner: gameState.winner,
    winnerTime: gameState.winnerTime,
    owner: gameState.owner,
    players: Array.from(gameState.players.values()).map(p => p.name),
    buzzOrder: gameState.buzzOrder,
    roundNumber: gameState.roundNumber
  });

  // Player registers with a name
  socket.on('register', (name) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    gameState.players.set(socket.id, {
      name: trimmedName,
      joinedAt: Date.now()
    });

    // First player becomes the owner
    if (!gameState.owner) {
      gameState.owner = socket.id;
      socket.emit('you-are-owner');
    }

    // Broadcast updated player list
    io.emit('player-joined', {
      name: trimmedName,
      players: Array.from(gameState.players.values()).map(p => p.name),
      owner: gameState.players.get(gameState.owner)?.name || null
    });

    socket.emit('registered', {
      name: trimmedName,
      isOwner: socket.id === gameState.owner
    });

    console.log(`${trimmedName} registered. Total players: ${gameState.players.size}`);
  });

  // Player presses the buzzer
  socket.on('buzz', () => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    // Check if already buzzed
    if (gameState.buzzOrder.find(b => b.socketId === socket.id)) return;

    const buzzTime = Date.now();

    gameState.buzzOrder.push({
      socketId: socket.id,
      name: player.name,
      time: buzzTime
    });

    // First buzzer wins
    if (!gameState.isLocked) {
      gameState.isLocked = true;
      gameState.winner = player.name;
      gameState.winnerTime = buzzTime;
    }

    io.emit('buzz-update', {
      isLocked: gameState.isLocked,
      winner: gameState.winner,
      buzzOrder: gameState.buzzOrder.map((b, i) => ({
        name: b.name,
        position: i + 1
      })),
      roundNumber: gameState.roundNumber
    });

    console.log(`${player.name} buzzed! Position: ${gameState.buzzOrder.length}`);
  });

  // Owner resets the buzzer
  socket.on('reset', () => {
    if (socket.id !== gameState.owner) {
      socket.emit('error-msg', 'أنت مش المالك! المالك بس اللي يقدر يرست.');
      return;
    }

    gameState.isLocked = false;
    gameState.winner = null;
    gameState.winnerTime = null;
    gameState.buzzOrder = [];
    gameState.roundNumber++;

    io.emit('buzzer-reset', {
      roundNumber: gameState.roundNumber,
      resetBy: gameState.players.get(socket.id)?.name
    });

    console.log(`Buzzer reset by owner. Round: ${gameState.roundNumber}`);
  });

  // Transfer ownership
  socket.on('transfer-ownership', (targetName) => {
    if (socket.id !== gameState.owner) return;

    for (const [sid, player] of gameState.players.entries()) {
      if (player.name === targetName) {
        gameState.owner = sid;
        io.to(sid).emit('you-are-owner');
        io.emit('ownership-changed', {
          newOwner: targetName,
          owner: targetName
        });
        break;
      }
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      console.log(`${player.name} disconnected`);
      gameState.players.delete(socket.id);

      // If owner disconnects, transfer to first available player
      if (socket.id === gameState.owner) {
        const firstPlayer = gameState.players.keys().next();
        if (!firstPlayer.done) {
          gameState.owner = firstPlayer.value;
          io.to(firstPlayer.value).emit('you-are-owner');
          io.emit('ownership-changed', {
            newOwner: gameState.players.get(firstPlayer.value)?.name,
            owner: gameState.players.get(firstPlayer.value)?.name
          });
        } else {
          gameState.owner = null;
        }
      }

      io.emit('player-left', {
        name: player.name,
        players: Array.from(gameState.players.values()).map(p => p.name),
        owner: gameState.owner ? gameState.players.get(gameState.owner)?.name : null
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔔 Buzzer Game running at http://localhost:${PORT}`);
});
