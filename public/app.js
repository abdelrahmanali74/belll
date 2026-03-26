// ============================================
// 🔔 BUZZER GAME - Client Application
// ============================================

// Socket.IO with robust reconnection settings
const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 45000,
    autoConnect: true,
    transports: ['websocket', 'polling'], // Prefer websocket, fallback to polling
});

// DOM Elements
const registerScreen = document.getElementById('register-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');
const onlineCountText = document.getElementById('online-count-text');

const roundNumber = document.getElementById('round-number');
const playerAvatar = document.getElementById('player-avatar');
const playerDisplayName = document.getElementById('player-display-name');

const statusWaiting = document.getElementById('status-waiting');
const statusWinner = document.getElementById('status-winner');
const winnerNameEl = document.getElementById('winner-name');

const buzzerBtn = document.getElementById('buzzer-btn');
const buzzerHint = document.getElementById('buzzer-hint');
const ownerControls = document.getElementById('owner-controls');
const resetBtn = document.getElementById('reset-btn');
const buzzOrderSection = document.getElementById('buzz-order-section');
const buzzOrderList = document.getElementById('buzz-order-list');

const playersSidebar = document.getElementById('players-sidebar');
const playersList = document.getElementById('players-list');
const playerCount = document.getElementById('player-count');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarToggleCount = document.getElementById('sidebar-toggle-count');

const toastContainer = document.getElementById('toast-container');
const confettiContainer = document.getElementById('confetti');

// State
let myName = '';
let mySessionId = '';
let isOwner = false;
let hasBuzzed = false;
let isGameLocked = false;
let isConnected = false;
let heartbeatInterval = null;

// Try to restore session from localStorage
try {
    const savedSession = localStorage.getItem('buzzer-session');
    if (savedSession) {
        const parsed = JSON.parse(savedSession);
        myName = parsed.name || '';
        mySessionId = parsed.sessionId || '';
    }
} catch (e) { /* ignore */ }

// Colors palette for avatars
const avatarColors = [
    '#7c5cff', '#ff5c5c', '#5cff8a', '#ffaa5c', '#5cc8ff',
    '#ff5caa', '#8aff5c', '#ffd700', '#ff6b6b', '#48dbfb',
    '#ff9ff3', '#54a0ff', '#5f27cd', '#01a3a4', '#f368e0'
];

function getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getInitial(name) {
    return name.charAt(0).toUpperCase();
}

// ============================================
// REGISTRATION
// ============================================

joinBtn.addEventListener('click', register);
playerNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') register();
});

function register() {
    const name = playerNameInput.value.trim();
    if (!name) {
        playerNameInput.style.borderColor = '#ef4444';
        playerNameInput.style.animation = 'shake 0.5s ease';
        setTimeout(() => {
            playerNameInput.style.borderColor = '';
            playerNameInput.style.animation = '';
        }, 500);
        return;
    }
    socket.emit('register', { name: name, sessionId: mySessionId || null });
}

// Add shake animation
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-10px); }
        40% { transform: translateX(10px); }
        60% { transform: translateX(-6px); }
        80% { transform: translateX(6px); }
    }
`;
document.head.appendChild(style);

// ============================================
// CONNECTION MANAGEMENT
// ============================================

function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
        if (isConnected) {
            socket.emit('heartbeat');
        }
    }, 15000); // Every 15 seconds
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

socket.on('connect', () => {
    console.log('✅ Connected to server');
    isConnected = true;
    startHeartbeat();

    // Auto re-register if we had a session
    if (myName && mySessionId) {
        console.log(`🔄 Auto re-registering as ${myName}`);
        socket.emit('register', { name: myName, sessionId: mySessionId });
    }

    // Update connection indicator
    updateConnectionStatus(true);
});

socket.on('disconnect', (reason) => {
    console.log(`❌ Disconnected: ${reason}`);
    isConnected = false;
    stopHeartbeat();
    updateConnectionStatus(false);

    // Don't show toast for intentional disconnects
    if (reason !== 'io client disconnect') {
        showToast('⚠️ انقطع الاتصال... جاري إعادة الاتصال', 'error');
    }
});

socket.on('connect_error', (err) => {
    console.log(`🔴 Connection error: ${err.message}`);
    updateConnectionStatus(false);
});

socket.on('heartbeat-ack', () => {
    // Server is alive, connection is healthy
});

socket.io.on('reconnect', (attempt) => {
    console.log(`🔄 Reconnected after ${attempt} attempts`);
    showToast('✅ تم إعادة الاتصال بنجاح!', 'success');
});

socket.io.on('reconnect_attempt', (attempt) => {
    if (attempt % 5 === 0) {
        showToast(`🔄 جاري محاولة إعادة الاتصال... (${attempt})`, 'warning');
    }
});

socket.io.on('reconnect_failed', () => {
    showToast('❌ فشل إعادة الاتصال. جرب تحدث الصفحة.', 'error');
});

function updateConnectionStatus(connected) {
    const dot = document.querySelector('.pulse-dot');
    if (dot) {
        dot.style.background = connected ? 'var(--success)' : 'var(--danger)';
    }
}

// ============================================
// SOCKET EVENT HANDLERS
// ============================================

socket.on('registered', (data) => {
    myName = data.name;
    mySessionId = data.sessionId;
    isOwner = data.isOwner;

    // Save session to localStorage for reconnection
    try {
        localStorage.setItem('buzzer-session', JSON.stringify({
            name: myName,
            sessionId: mySessionId
        }));
    } catch (e) { /* ignore */ }

    // Switch to game screen
    registerScreen.classList.remove('active');
    gameScreen.classList.add('active');

    // Set player info
    playerAvatar.textContent = getInitial(myName);
    playerAvatar.style.background = `linear-gradient(135deg, ${getAvatarColor(myName)}, ${getAvatarColor(myName + 'dark')})`;
    playerDisplayName.textContent = myName;

    if (isOwner) {
        ownerControls.classList.remove('hidden');
    } else {
        ownerControls.classList.add('hidden');
    }

    showToast(`أهلاً ${myName}! 🎉`, 'success');
});

socket.on('you-are-owner', () => {
    isOwner = true;
    ownerControls.classList.remove('hidden');
    showToast('👑 أنت بقيت المالك!', 'warning');
});

socket.on('game-state', (state) => {
    // Update initial state on connection
    onlineCountText.textContent = `${state.players.length} لاعب متصل`;

    if (state.isLocked && state.winner) {
        isGameLocked = true;
        showWinner(state.winner);
        lockBuzzer();
    } else {
        isGameLocked = false;
    }

    roundNumber.textContent = state.roundNumber + 1;

    if (state.buzzOrder && state.buzzOrder.length > 0) {
        showBuzzOrder(state.buzzOrder);
    }

    // Update players list
    if (state.players && state.players.length > 0) {
        updatePlayersList(state.players, state.owner);
        playerCount.textContent = state.players.length;
        sidebarToggleCount.textContent = state.players.length;
    }
});

socket.on('player-joined', (data) => {
    updatePlayersList(data.players, data.owner);
    onlineCountText.textContent = `${data.players.length} لاعب متصل`;
    playerCount.textContent = data.players.length;
    sidebarToggleCount.textContent = data.players.length;

    if (myName && data.name !== myName) {
        showToast(`${data.name} انضم للعبة 🎮`, 'info');
    }
});

socket.on('player-left', (data) => {
    updatePlayersList(data.players, data.owner);
    playerCount.textContent = data.players.length;
    sidebarToggleCount.textContent = data.players.length;
    onlineCountText.textContent = `${data.players.length} لاعب متصل`;
    showToast(`${data.name} ساب اللعبة 👋`, 'info');
});

socket.on('buzz-update', (data) => {
    isGameLocked = data.isLocked;

    if (data.isLocked && data.winner) {
        showWinner(data.winner);
        lockBuzzer();
        if (data.winner === myName) {
            launchConfetti();
            showToast('🎉 مبروك! أنت ضغطت الأول!', 'success');
        }
    }

    showBuzzOrder(data.buzzOrder);
    roundNumber.textContent = data.roundNumber + 1;
});

socket.on('buzzer-reset', (data) => {
    resetGameUI();
    roundNumber.textContent = data.roundNumber + 1;
    showToast(`🔄 ${data.resetBy} عمل رست. الجولة ${data.roundNumber + 1}`, 'info');
});

socket.on('ownership-changed', (data) => {
    if (data.newOwner !== myName) {
        isOwner = false;
        ownerControls.classList.add('hidden');
    }
    showToast(`👑 ${data.newOwner} بقى المالك الجديد`, 'warning');
});

socket.on('error-msg', (msg) => {
    showToast(`❌ ${msg}`, 'error');
});

// ============================================
// BUZZER
// ============================================

buzzerBtn.addEventListener('click', () => {
    if (hasBuzzed || isGameLocked || !isConnected) return;

    hasBuzzed = true;
    socket.emit('buzz');

    buzzerBtn.classList.add('pressed');
    buzzerHint.textContent = '✅ ضغطت!';
    playBuzzerSound();

    // Play vibration if available
    if (navigator.vibrate) {
        navigator.vibrate(100);
    }
});

// Keyboard shortcut - Space bar
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && gameScreen.classList.contains('active') && !hasBuzzed && !isGameLocked) {
        e.preventDefault();
        buzzerBtn.click();
    }
});

function lockBuzzer() {
    if (!hasBuzzed) {
        buzzerBtn.classList.add('locked');
        buzzerHint.textContent = '🔒 الجرس مقفول';
    }
}

function showWinner(name) {
    statusWaiting.classList.add('hidden');
    statusWinner.classList.remove('hidden');
    winnerNameEl.textContent = name;
}

function showBuzzOrder(order) {
    buzzOrderSection.classList.remove('hidden');
    buzzOrderList.innerHTML = order.map((item, i) => `
        <div class="buzz-order-item" style="animation-delay: ${i * 0.1}s">
            <div class="buzz-position">${item.position}</div>
            <div class="buzz-name">${item.name}</div>
            ${item.position === 1 ? '<span>🏆</span>' : ''}
        </div>
    `).join('');
}

// ============================================
// OWNER CONTROLS
// ============================================

resetBtn.addEventListener('click', () => {
    if (!isConnected) {
        showToast('❌ مفيش اتصال بالسيرفر!', 'error');
        return;
    }
    socket.emit('reset');
});

function resetGameUI() {
    hasBuzzed = false;
    isGameLocked = false;

    buzzerBtn.classList.remove('locked', 'pressed');
    buzzerHint.textContent = 'اضغط الجرس!';

    statusWaiting.classList.remove('hidden');
    statusWinner.classList.add('hidden');

    buzzOrderSection.classList.add('hidden');
    buzzOrderList.innerHTML = '';

    // Clear confetti
    confettiContainer.innerHTML = '';
}

// ============================================
// PLAYERS SIDEBAR
// ============================================

sidebarToggle.addEventListener('click', () => {
    playersSidebar.classList.toggle('open');
});

// Close sidebar on click outside
document.addEventListener('click', (e) => {
    if (!playersSidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
        playersSidebar.classList.remove('open');
    }
});

function updatePlayersList(players, ownerName) {
    playersList.innerHTML = players.map(name => {
        const color = getAvatarColor(name);
        const isPlayerOwner = name === ownerName;
        return `
            <div class="player-item">
                <div class="player-item-avatar" style="background: linear-gradient(135deg, ${color}, ${color}88)">
                    ${getInitial(name)}
                </div>
                <span class="player-item-name">${name}</span>
                ${isPlayerOwner ? '<span class="player-item-badge badge-owner">👑 مالك</span>' : ''}
                ${name === myName ? '<span class="player-item-badge" style="background: rgba(124,92,255,0.2); color: var(--accent-light);">أنت</span>' : ''}
            </div>
        `;
    }).join('');
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

let toastQueue = [];
const MAX_TOASTS = 3;

function showToast(message, type = 'info') {
    // Remove oldest if too many
    while (toastContainer.children.length >= MAX_TOASTS) {
        toastContainer.removeChild(toastContainer.firstChild);
    }

    // Debounce duplicate messages
    const lastToast = toastQueue[toastQueue.length - 1];
    if (lastToast && lastToast.message === message && Date.now() - lastToast.time < 2000) {
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    toastQueue.push({ message, time: Date.now() });
    if (toastQueue.length > 10) toastQueue.shift();

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 3500);
}

// ============================================
// CONFETTI
// ============================================

function launchConfetti() {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffd700', '#ff6b6b', '#48dbfb', '#ff9ff3'];

    for (let i = 0; i < 80; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.width = Math.random() * 10 + 5 + 'px';
        piece.style.height = Math.random() * 10 + 5 + 'px';
        piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
        piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
        piece.style.animationDelay = Math.random() * 0.5 + 's';
        confettiContainer.appendChild(piece);
    }

    setTimeout(() => {
        confettiContainer.innerHTML = '';
    }, 5000);
}

// ============================================
// SOUND
// ============================================

function playBuzzerSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 800;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
        // Audio not supported
    }
}

// ============================================
// AUTO-RECONNECT ON VISIBILITY CHANGE
// ============================================

// When user switches back to the tab, check connection
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (!socket.connected) {
            console.log('🔄 Tab became visible, reconnecting...');
            socket.connect();
        }
    }
});

// Also handle online/offline events
window.addEventListener('online', () => {
    console.log('🌐 Network is back online');
    if (!socket.connected) {
        socket.connect();
    }
    showToast('🌐 الإنترنت رجع!', 'success');
});

window.addEventListener('offline', () => {
    console.log('📴 Network went offline');
    showToast('📴 الإنترنت انقطع!', 'error');
});

// ============================================
// PAGE LOAD - AUTO RE-JOIN
// ============================================

// If user refreshes and has saved session, auto-fill name
window.addEventListener('DOMContentLoaded', () => {
    if (myName) {
        playerNameInput.value = myName;
    }
});
