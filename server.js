const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Connection reliability settings
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  // Allow reconnection with same session
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state
let gameState = {
  isLocked: false,
  winner: null,
  winnerTime: null,
  owner: null,
  players: new Map(),       // socketId -> { name, joinedAt, sessionId }
  sessions: new Map(),      // sessionId -> { name, lastSeen }
  buzzOrder: [],
  roundNumber: 0
};

// Generate a simple session ID
function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Get full game state for sending to clients
function getFullState() {
  return {
    isLocked: gameState.isLocked,
    winner: gameState.winner,
    winnerTime: gameState.winnerTime,
    owner: gameState.owner ? gameState.players.get(gameState.owner)?.name || null : null,
    players: Array.from(gameState.players.values()).map(p => p.name),
    buzzOrder: gameState.buzzOrder.map((b, i) => ({
      name: b.name,
      position: i + 1
    })),
    roundNumber: gameState.roundNumber
  };
}

// Transfer ownership to next available player
function transferOwnership() {
  const firstPlayer = gameState.players.keys().next();
  if (!firstPlayer.done) {
    gameState.owner = firstPlayer.value;
    io.to(firstPlayer.value).emit('you-are-owner');
    const ownerName = gameState.players.get(firstPlayer.value)?.name;
    io.emit('ownership-changed', {
      newOwner: ownerName,
      owner: ownerName
    });
    return ownerName;
  } else {
    gameState.owner = null;
    return null;
  }
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id} (recovered: ${socket.recovered})`);

  // Send current state to new connection
  socket.emit('game-state', getFullState());

  // Player registers with a name (and optionally reconnect with session)
  socket.on('register', (data) => {
    let name, sessionId;

    // Support both string (name) and object ({name, sessionId})
    if (typeof data === 'string') {
      name = data.trim();
      sessionId = null;
    } else if (data && typeof data === 'object') {
      name = (data.name || '').trim();
      sessionId = data.sessionId || null;
    } else {
      return;
    }

    if (!name) return;

    // Check for duplicate names (but allow same session to reconnect)
    for (const [sid, player] of gameState.players.entries()) {
      if (player.name === name && sid !== socket.id) {
        // Same session reconnecting? Remove old entry
        if (sessionId && player.sessionId === sessionId) {
          // Was this the owner?
          const wasOwner = gameState.owner === sid;
          gameState.players.delete(sid);
          if (wasOwner) {
            gameState.owner = socket.id; // Transfer to new socket
          }
          break;
        } else {
          // Different person with same name - add number
          name = name + '_' + Math.floor(Math.random() * 100);
        }
      }
    }

    // Create or reuse session
    if (!sessionId) {
      sessionId = generateSessionId();
    }

    gameState.players.set(socket.id, {
      name: name,
      joinedAt: Date.now(),
      sessionId: sessionId
    });

    gameState.sessions.set(sessionId, {
      name: name,
      lastSeen: Date.now()
    });

    // First player becomes the owner
    if (!gameState.owner || !gameState.players.has(gameState.owner)) {
      gameState.owner = socket.id;
      socket.emit('you-are-owner');
    }

    // Send registration confirmation with session
    socket.emit('registered', {
      name: name,
      sessionId: sessionId,
      isOwner: socket.id === gameState.owner
    });

    // Broadcast updated player list
    const ownerName = gameState.owner ? gameState.players.get(gameState.owner)?.name : null;
    io.emit('player-joined', {
      name: name,
      players: Array.from(gameState.players.values()).map(p => p.name),
      owner: ownerName
    });

    console.log(`${name} registered (session: ${sessionId}). Total players: ${gameState.players.size}`);
  });

  // Player presses the buzzer
  socket.on('buzz', () => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    // Check if already buzzed (by name to handle reconnects)
    if (gameState.buzzOrder.find(b => b.name === player.name)) return;

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

  // Heartbeat - client pings to confirm alive
  socket.on('heartbeat', () => {
    const player = gameState.players.get(socket.id);
    if (player && player.sessionId) {
      const session = gameState.sessions.get(player.sessionId);
      if (session) session.lastSeen = Date.now();
    }
    socket.emit('heartbeat-ack');
  });

  // Handle disconnection with grace period
  socket.on('disconnect', (reason) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    console.log(`${player.name} disconnected (reason: ${reason})`);

    // Grace period: wait 10 seconds for reconnection before removing
    const disconnectedSocketId = socket.id;
    const disconnectedSessionId = player.sessionId;

    setTimeout(() => {
      // Check if the player reconnected with a new socket but same session
      let reconnected = false;
      for (const [sid, p] of gameState.players.entries()) {
        if (p.sessionId === disconnectedSessionId && sid !== disconnectedSocketId) {
          reconnected = true;
          break;
        }
      }

      // If still in players map with old socket ID and not reconnected
      if (gameState.players.has(disconnectedSocketId) && !reconnected) {
        gameState.players.delete(disconnectedSocketId);

        // If owner disconnects, transfer
        if (disconnectedSocketId === gameState.owner) {
          transferOwnership();
        }

        const ownerName = gameState.owner ? gameState.players.get(gameState.owner)?.name : null;
        io.emit('player-left', {
          name: player.name,
          players: Array.from(gameState.players.values()).map(p => p.name),
          owner: ownerName
        });

        console.log(`${player.name} removed after grace period. Players: ${gameState.players.size}`);
      }
    }, 10000); // 10 second grace period
  });
});

// Clean up stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of gameState.sessions.entries()) {
    if (now - session.lastSeen > 10 * 60 * 1000) { // 10 minutes
      gameState.sessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔔 Buzzer Game running at http://localhost:${PORT}`);
});
