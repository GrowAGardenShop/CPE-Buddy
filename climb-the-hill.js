// Climb The Hill - Multiplayer Quiz Game Logic (2024-08-28)
// Make sure you have updated climb-the-hill.html and climb-the-hill.css as well!

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, setDoc, getDoc, updateDoc, onSnapshot, addDoc, query, orderBy, deleteField } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// --- Firebase Config ---
const firebaseConfig = {
  apiKey: "AIzaSyDh2B68G_kRSGk22Mko8HU3ztPKNgY1EEE",
  authDomain: "cpe-buddy.firebaseapp.com",
  projectId: "cpe-buddy",
  storageBucket: "cpe-buddy.appspot.com",
  messagingSenderId: "171132740113",
  appId: "1:171132740113:web:861b870b8f900429fcc7b0",
  measurementId: "G-PVQTEF4HHZ"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- Globals ---
let playerName = "";
let gameCode = "";
let localPlayerId = "";
let gameRoomUnsub = null;
let chatUnsub = null;
let lobbyChatUnsub = null;
let gameRoomData = null;
let barMax = 20;
let timerInterval = null;
let serverEndTime = 0;
let localGameEnded = false;
let playAgainClicked = false;
let kickedFlag = false;
let joinLock = false;
let leaderboardOrder = [];
let finishTimes = {};
let finishOrder = [];
let myFinishTime = null;
let myFinishPlace = null;

// --- Utility ---
function randomCode() {
  return Math.random().toString(36).substring(2,8).toUpperCase();
}
function chooseQuestions(arr, n) {
  if (arr.length <= n) return arr;
  const shuffled = arr.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}
function show(pageId) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById(pageId).style.display = 'flex';
}
window.show = show;

// --- Main Menu ---
window.gotoMultiplayer = function() {
  show('multiLobby');
  document.getElementById('mpError').innerText = "";
};
window.onload = function() {
  show('mainMenu');
};

// --- Lobby Chat ---
function setupLobbyChat(code) {
  const chatZone = document.getElementById('lobbyChatDisplay');
  chatZone.innerHTML = "";
  const chatCol = collection(db, `climb_lobby_chat_${code}`);
  const chatQ = query(chatCol, orderBy("ts"));
  if (lobbyChatUnsub) lobbyChatUnsub();
  lobbyChatUnsub = onSnapshot(chatQ, snap => {
    let arr = [];
    snap.forEach(doc => arr.push(doc.data()));
    chatZone.innerHTML = arr.map(msg => `<div class="chat-msg"><b>${msg.name}</b>: ${msg.text}</div>`).join('');
    chatZone.scrollTop = chatZone.scrollHeight;
  });
}
window.sendLobbyChatMsg = async function() {
  let msg = document.getElementById('lobbyChatInput').value.trim();
  if (!msg) return;
  const chatCol = collection(db, `climb_lobby_chat_${gameCode}`);
  await addDoc(chatCol, {
    name: playerName,
    text: msg,
    ts: Date.now()
  });
  document.getElementById('lobbyChatInput').value = "";
};

// --- Create Game Room ---
window.createGameRoom = async function() {
  playerName = document.getElementById('mpName').value.trim();
  if (!playerName) {
    document.getElementById('mpError').innerText = "Enter your name!";
    return;
  }
  gameCode = randomCode();
  localPlayerId = randomCode() + Date.now();
  const colRef = collection(db, "computersystem_questions");
  const snapshot = await getDocs(colRef);
  let questions = [];
  snapshot.forEach(docSnap => {
    const q = docSnap.data();
    questions.push(q);
  });
  questions = chooseQuestions(questions, 30);
  const now = Date.now();
  let leaderboardOrderInit = [localPlayerId];
  await setDoc(doc(db, "climb_games", gameCode), {
    code: gameCode,
    host: localPlayerId,
    started: false,
    questions,
    barMax,
    endTime: now + 5*60*1000,
    winner: null,
    playAgain: [],
    leaderboard: { [localPlayerId]: 0 },
    leaderboardOrder: leaderboardOrderInit,
    finishedPlayers: [],
    players: {
      [localPlayerId]: {
        name: playerName,
        bar: 0,
        wrongStreak: 0,
        mpQIndex: 0,
        finished: false,
        completed: false,
        finishMillis: null,
        score: 0,
        ready: false // Initialize ready state for host
      }
    },
    lastGameStartTS: now
  });
  joinGameRoom(gameCode, localPlayerId, true);
};

// --- Join Game Room
window.joinGameRoomBtn = async function() {
  if (joinLock) return;
  joinLock = true;
  try {
    playerName = document.getElementById('mpName').value.trim();
    if (!playerName) {
      document.getElementById('mpError').innerText = "Enter your name!";
      joinLock = false; return;
    }
    const code = document.getElementById('mpCode').value.trim().toUpperCase();
    if (!code) {
      document.getElementById('mpError').innerText = "Enter code!";
      joinLock = false; return;
    }
    const roomRef = doc(db, "climb_games", code);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) {
      document.getElementById('mpError').innerText = "Room not found!";
      joinLock = false; return;
    }
    let data = roomSnap.data();
    if (data.started) {
      document.getElementById('mpError').innerText = "Game already started!";
      joinLock = false; return;
    }
    if (data.players && Object.keys(data.players).length >= 5) {
      document.getElementById('mpError').innerText = "Room is full!";
      joinLock = false; return;
    }
    let duplicate = Object.values(data.players || {}).some(p => p.name === playerName);
    if (duplicate) {
      document.getElementById('mpError').innerText = "This name already joined!";
      joinLock = false; return;
    }
    localPlayerId = randomCode() + Date.now();
    let leaderboardPatch = data.leaderboard || {};
    leaderboardPatch[localPlayerId] = leaderboardPatch[localPlayerId] || 0;
    let leaderboardOrderPatch = data.leaderboardOrder || [];
    leaderboardOrderPatch.push(localPlayerId);
    await updateDoc(roomRef, {
      [`players.${localPlayerId}`]: {
        name: playerName,
        bar: 0,
        wrongStreak: 0,
        mpQIndex: 0,
        finished: false,
        completed: false,
        finishMillis: null,
        score: 0,
        ready: false // Initialize ready state for joining player
      },
      leaderboard: leaderboardPatch,
      leaderboardOrder: leaderboardOrderPatch
    });
    joinGameRoom(code, localPlayerId, false);
  } finally {
    setTimeout(() => { joinLock = false; }, 1500);
  }
};

// --- ROOM LOGIC ---
function joinGameRoom(code, playerId, isHost) {
  gameCode = code;
  localPlayerId = playerId;
  playAgainClicked = false;
  kickedFlag = false;
  show('roomMenu');
  document.getElementById('roomCodeShow').innerText = "Room Code: " + code;
  document.getElementById('roomHostShow').innerText = isHost ? "(You are host)" : "";
  renderRoomPlayers([]);
  setupLobbyChat(code);
  if (gameRoomUnsub) gameRoomUnsub();
  const roomRef = doc(db, "climb_games", code);
  gameRoomUnsub = onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) {
      alert("Room closed or deleted!");
      show('mainMenu');
      return;
    }
    gameRoomData = snap.data();
    leaderboardOrder = gameRoomData.leaderboardOrder || Object.keys(gameRoomData.leaderboard || {});
    renderRoomPlayers(gameRoomData.players || {});
    renderLeaderboardBar();

    // Check if the game should be in gameplay or room menu
    if (gameRoomData.started && !gameRoomData.playAgainStatus) { // Added playAgainStatus check
      show('gamePlay');
      if (lobbyChatUnsub) lobbyChatUnsub();
      startGamePlay();
      setupChat(gameCode);
    } else {
      // If the game is not started or in "play again" mode, ensure we are in roomMenu
      // This is crucial for non-hosts to see the "Ready" button again
      show('roomMenu');
      if (chatUnsub) chatUnsub(); // Unsubscribe from game chat if back in lobby
      setupLobbyChat(gameCode); // Ensure lobby chat is active
      // Update the Ready button state based on the current player's ready status
      const localPlayer = gameRoomData.players[localPlayerId];
      if (localPlayer) {
        document.getElementById('roomReadyBtn').innerText = localPlayer.ready ? "Ready ✔" : "Ready";
        document.getElementById('roomReadyBtn').disabled = localPlayer.ready;
      }
    }
  });
}
function renderRoomPlayers(players) {
  const zone = document.getElementById('roomPlayers');
  if (!players || Object.keys(players).length === 0) {
    zone.innerHTML = "<i>No players yet.</i>";
    document.getElementById('roomStartBtn').disabled = true;
    // Also disable ready button if no players, though it shouldn't happen for the local player
    document.getElementById('roomReadyBtn').disabled = true;
    return;
  }
  let html = "";
  let readyCount = 0;
  Object.entries(players).forEach(([pid, p]) => {
    let kickBtn = "";
    if (gameRoomData && localPlayerId === gameRoomData.host && pid !== localPlayerId) {
      kickBtn = `<button style="margin-left:8px;background:#b00;" onclick="window.kickPlayer('${pid}')" title="Kick">Kick</button>`;
    }
    html += `<div class="room-player${p.ready ? ' ready' : ''}">${p.name} ${p.ready ? "✔" : ""}${kickBtn}</div>`;
    if (p.ready) readyCount++;
  });
  zone.innerHTML = html;

  // Update ready button for local player
  const localPlayer = players[localPlayerId];
  if (localPlayer) {
    document.getElementById('roomReadyBtn').innerText = localPlayer.ready ? "Ready ✔" : "Ready";
    document.getElementById('roomReadyBtn').disabled = localPlayer.ready;
  }

  // Host specific button logic
  if (gameRoomData && localPlayerId === gameRoomData.host) {
    document.getElementById('roomStartBtn').style.display = 'block';
    document.getElementById('roomStartBtn').disabled = readyCount < 2;
  } else {
    document.getElementById('roomStartBtn').style.display = 'none'; // Hide start button for non-hosts
  }
}
window.kickPlayer = async function(pid) {
  if (!confirm("Kick this player?")) return;
  const roomRef = doc(db, "climb_games", gameCode);
  let patch = {};
  patch[`players.${pid}`] = deleteField();
  let leaderboardOrder = gameRoomData.leaderboardOrder || [];
  patch["leaderboardOrder"] = leaderboardOrder.filter(id => id !== pid);
  await updateDoc(roomRef, patch);
};
window.setReady = async function() {
  const roomRef = doc(db, "climb_games", gameCode);
  // Toggle ready state
  const currentReadyState = gameRoomData.players[localPlayerId]?.ready || false;
  await updateDoc(roomRef, {
    [`players.${localPlayerId}.ready`]: !currentReadyState
  });
};
window.startGameRoom = async function() {
  const roomRef = doc(db, "climb_games", gameCode);
  const newEnd = Date.now() + 5*60*1000;
  await updateDoc(roomRef, {
    started: true,
    endTime: newEnd,
    lastGameStartTS: Date.now(),
    finishedPlayers: [],
    playAgainStatus: false // Reset this flag when starting a new game
  });
};
window.leaveRoom = function() {
  if (gameRoomUnsub) gameRoomUnsub();
  if (lobbyChatUnsub) lobbyChatUnsub();
  if (chatUnsub) chatUnsub(); // Also unsubscribe game chat
  if (gameCode && localPlayerId) {
    const roomRef = doc(db, "climb_games", gameCode);
    let patch = {};
    patch[`players.${localPlayerId}`] = deleteField();
    let leaderboardOrder = gameRoomData && gameRoomData.leaderboardOrder ? gameRoomData.leaderboardOrder : [];
    patch["leaderboardOrder"] = leaderboardOrder.filter(id => id !== localPlayerId);
    updateDoc(roomRef, patch);
  }
  show('mainMenu');
};

// --- GAMEPLAY ---
function startGamePlay() {
  serverEndTime = gameRoomData.endTime || (Date.now() + 5 * 60 * 1000);
  localGameEnded = false;
  playAgainClicked = false;
  finishTimes = {};
  finishOrder = [];
  myFinishTime = null;
  myFinishPlace = null;
  setupGlobalTimer();
  renderLeaderboardBar();
  renderBars();
  renderGameScreen();
}

// --- TIMER ---
function setupGlobalTimer() {
  clearInterval(timerInterval);
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}
function updateTimer() {
  let now = Date.now();
  let secs = Math.max(0, Math.floor((serverEndTime-now)/1000));
  const min = String(Math.floor(secs/60)).padStart(1,"0");
  const s = String(secs%60).padStart(2,"0");
  document.getElementById('globalTimer').innerText = `${min}:${s}`;
  if (secs <= 0 && !localGameEnded) {
    localGameEnded = true;
    tryEndGame();
  }
}

// --- BAR DRAW ---
function renderBars() {
  const players = gameRoomData.players;
  let barsHtml = "";
  leaderboardOrder.forEach(pid => {
    const p = players[pid];
    if (!p) return;
    let width = Math.round((p.bar/barMax)*100);
    let color = pid === localPlayerId ? "#FFD700" : "#2196f3";
    barsHtml += `
      <div class="player-bar">
        <div class="bar-label">${p.name}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%;background:${color}"></div>
        </div>
      </div>
    `;
  });
  document.getElementById('barsZone').innerHTML = barsHtml;
}

// --- GAME CENTER / QUESTIONS ---
function renderGameScreen() {
  const player = gameRoomData.players[localPlayerId];
  // Check if all questions are finished for the player, or if the player has explicitly finished
  if (player.completed || player.finished || player.mpQIndex >= gameRoomData.questions.length) {
    tryEndGame();
    renderPersonalResultScreen();
    return;
  }
  let mpQIndex = player.mpQIndex || 0;
  let q = gameRoomData.questions[mpQIndex];
  if (!q) {
    // This case should ideally be covered by the check above, but as a safeguard
    tryEndGame();
    renderPersonalResultScreen();
    return;
  }
  let questionHtml = `
    <div class="question-title">Q${mpQIndex+1}: ${q.question}</div>
    <div class="options">
      ${q.options.map((opt, i) =>
        `<button class="option-btn" onclick="window.answerMp(${i})">${opt}</button>`
      ).join('')}
    </div>
    <div class="flag-progress">
      <div class="flag-img" style="left:${Math.round((player.bar / barMax) * 210)}px;"></div>
      <div class="hill"></div>
    </div>
  `;
  document.getElementById('gameCenter').innerHTML = questionHtml;
}

// --- At finish, record time, update finishOrder ---
async function tryEndGame() {
  // Only update finish status if it hasn't been done yet for this player
  const player = gameRoomData.players[localPlayerId];
  let finishedPlayers = gameRoomData.finishedPlayers || [];
  let allPlayers = leaderboardOrder.filter(pid => gameRoomData.players[pid]);

  // If the player has completed or finished and their finishMillis isn't set yet
  if ((player.completed || player.finished) && !player.finishMillis) {
    const finishMillis = Date.now();
    let patch = {};
    patch[`players.${localPlayerId}.finishMillis`] = finishMillis;
    patch[`players.${localPlayerId}.score`] = player.bar || 0;

    // Only add to finishedPlayers if not already present
    if (!finishedPlayers.some(fp => fp.pid === localPlayerId)) {
      finishedPlayers = finishedPlayers.slice(); // Create a new array
      finishedPlayers.push({
        pid: localPlayerId,
        name: player.name,
        score: player.bar || 0,
        finishMillis
      });
      patch["finishedPlayers"] = finishedPlayers;
    }

    if (!gameRoomData.winner && player.completed) {
      patch.winner = player.name;
    }
    await updateDoc(doc(db, "climb_games", gameCode), patch);
  }

  // If a winner is declared or all players have finished (by score or by time)
  if (gameRoomData.winner || finishedPlayers.length === allPlayers.length) {
    // This part should be handled by the onSnapshot listener to update the display
    // after the finishedPlayers array is fully populated in the database.
    // For now, ensure renderPlacementScreen is called, but the main update will come from Firebase.
    renderPlacementScreen();
    clearInterval(timerInterval); // Stop the timer when game officially ends
    return;
  }

  // If the local player has just finished but not all players are done, show personal result
  if (player.completed || player.finished) {
    renderPersonalResultScreen();
  }
}

// --- Show personal result (while waiting others or after forced finish) ---
function renderPersonalResultScreen() {
  const player = gameRoomData.players[localPlayerId];
  if (!player.finishMillis) {
    document.getElementById('gameCenter').innerHTML = `
      <div style="font-size:2em;color:#FFD700;margin-bottom:20px;">🎉 You finished!</div>
      <div>Waiting for others to finish...</div>
    `;
    return;
  }
  let finishedPlayers = (gameRoomData.finishedPlayers || []).slice();
  finishedPlayers.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.finishMillis - b.finishMillis;
  });
  let myPlace = finishedPlayers.findIndex(e => e.pid === localPlayerId) + 1;
  let myTime = Math.max(0, Math.floor((player.finishMillis - (gameRoomData.lastGameStartTS||0))/1000));
  let mm = String(Math.floor(myTime/60)).padStart(1, "0");
  let ss = String(myTime%60).padStart(2, "0");
  document.getElementById('gameCenter').innerHTML = `
    <div style="font-size:2em;color:#FFD700;margin-bottom:20px;">🎉 You finished!</div>
    <div>Your place: <b>${myPlace}</b> <br>Score: <b>${player.bar || 0}</b> <br>Time: <b>${mm}:${ss}</b></div>
    <div style="margin-top:20px;">Waiting for others to finish...</div>
  `;
}

// --- Show placements for all when game is over ---
function renderPlacementScreen() {
  let finishedPlayers = (gameRoomData.finishedPlayers || []).slice();
  let allPlayers = leaderboardOrder.filter(pid => gameRoomData.players[pid]);
  finishedPlayers.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.finishMillis - b.finishMillis;
  });
  let html = `<div class="flag-trophy"></div>
    <h2>Results</h2>
    <div class="leaderboard">`;
  for (let i=0;i<allPlayers.length;i++) {
    if (finishedPlayers[i]) {
      let tp = finishedPlayers[i];
      let timeSec = Math.max(0, Math.floor((tp.finishMillis-(gameRoomData.lastGameStartTS||0))/1000));
      let mm = String(Math.floor(timeSec/60)).padStart(1,"0");
      let ss = String(timeSec%60).padStart(2,"0");
      html += `<div>${i+1}. <b>${tp.name}</b> &nbsp; <span style="color:#FFD700;">${mm}:${ss}</span> &nbsp; <span style="color:#3B82F6;">Score: ${tp.score}</span></div>`;
    } else {
      // Display players who didn't finish explicitly but are part of the game
      const playerWhoDidNotFinish = allPlayers.find(pid => !finishedPlayers.some(fp => fp.pid === pid));
      if (playerWhoDidNotFinish) {
        const pnf = gameRoomData.players[playerWhoDidNotFinish];
        html += `<div>${i+1}. <b>${pnf.name}</b> &nbsp; <span style="color:#666;">Did not finish</span> &nbsp; <span style="color:#3B82F6;">Score: ${pnf.bar || 0}</span></div>`;
      } else {
        html += `<div>${i+1}. ???</div>`; // Fallback if somehow there's a missing player
      }
    }
  }
  html += `</div>
    <div id="playAgainZone" style="margin-top:18px;"></div>`;
  document.getElementById('gameCenter').innerHTML = html;
  setupPlayAgainButton(finishedPlayers.length ? finishedPlayers[0].pid : null);
}
function renderLeaderboardBar() {
  let playerMap = gameRoomData.players;
  let leaderboardObj = gameRoomData.leaderboard || {};
  let arr = leaderboardOrder
    .map(pid => ({
      name: playerMap[pid]?.name || "Player",
      wins: leaderboardObj[pid] || 0
    }));
  let html = arr.map(p => `<span style="color:#FFD700;font-weight:bold;">${p.name}: ${p.wins}🏆</span>`).join(' &nbsp;|&nbsp; ');
  document.getElementById('leaderboardBar').innerHTML = html || "";
}

// --- PLAY AGAIN LOGIC ---
function setupPlayAgainButton(winnerPid) {
  let playAgainArr = gameRoomData.playAgain || [];
  let totalPlayers = leaderboardOrder.filter(pid => gameRoomData.players[pid]).length;
  let alreadyClicked = playAgainArr.includes(localPlayerId);
  let btnText = alreadyClicked ? `Waiting (${playAgainArr.length}/${totalPlayers})` : `Play Again (${playAgainArr.length}/${totalPlayers})`;
  let disableBtn = alreadyClicked;
  let btnHtml = `
  <button onclick="window.playAgainClick()" ${disableBtn ? "disabled" : ""}>${btnText}</button>
  `;
  document.getElementById('playAgainZone').innerHTML = btnHtml;

  // If all players have clicked "Play Again", and current player is host, then reset for next game
  if (playAgainArr.length === totalPlayers && totalPlayers > 0 && localPlayerId === gameRoomData.host) {
    finishAndCommitWinner(winnerPid);
  }
}

window.playAgainClick = async function() {
  if (playAgainClicked) return;
  playAgainClicked = true;
  const roomRef = doc(db, "climb_games", gameCode);
  const snap = await getDoc(roomRef);
  let arr = snap.data().playAgain || [];
  if (!arr.includes(localPlayerId)) arr.push(localPlayerId);
  await updateDoc(roomRef, { playAgain: arr });
};

async function finishAndCommitWinner(winnerPid) {
  // This function is now only called by the host when all players have clicked "Play Again"
  // It should reset the game state in Firebase to allow a new game to begin.

  let leaderboardObj = {...(gameRoomData.leaderboard || {})};
  if (winnerPid) leaderboardObj[winnerPid] = (leaderboardObj[winnerPid] || 0) + 1;

  const colRef = collection(db, "computersystem_questions");
  const snapshot = await getDocs(colRef);
  let questions = [];
  snapshot.forEach(docSnap => questions.push(docSnap.data()));
  questions = chooseQuestions(questions, 30);

  let playersPatch = {};
  (gameRoomData.leaderboardOrder || Object.keys(gameRoomData.players)).forEach(pid => {
    let p = gameRoomData.players[pid];
    if (p) {
      playersPatch[pid] = {
        ...p,
        bar: 0,
        wrongStreak: 0,
        mpQIndex: 0,
        finished: false,
        completed: false,
        finishMillis: null,
        score: 0,
        ready: false // Players should be set to not ready for the new game
      };
    }
  });

  const newEnd = Date.now() + 5*60*1000;
  await updateDoc(doc(db, "climb_games", gameCode), {
    questions,
    playAgain: [], // Clear playAgain array
    started: false, // Set to false so everyone goes back to the room menu
    endTime: newEnd,
    lastGameStartTS: Date.now(),
    winner: null,
    leaderboard: leaderboardObj,
    players: playersPatch,
    finishedPlayers: [],
    playAgainStatus: true // New flag to indicate "play again" cycle is active, game not "started" yet.
  });
  // After host updates, the onSnapshot listener will trigger for all clients
  // and move them to the 'roomMenu' due to 'started: false'.
}


// --- ANSWERING ---
window.answerMp = async function(idx) {
  if (localGameEnded) return;
  let roomRef = doc(db, "climb_games", gameCode);
  let player = gameRoomData.players[localPlayerId];
  if (player.completed || player.finished) return;
  let mpQIndex = player.mpQIndex || 0;
  let q = gameRoomData.questions[mpQIndex];
  if (!q) {
    // This should not happen if renderGameScreen checks mpQIndex
    console.warn("No question found at index", mpQIndex);
    return;
  }
  let correct = idx === q.correctAnswerIndex;
  let updates = {};
  let newBar = player.bar || 0;
  let newWrongStreak = player.wrongStreak || 0;
  let nextQIndex = mpQIndex + 1;
  let completed = false;
  if (correct) {
    newBar = Math.min(newBar + 1, barMax);
    newWrongStreak = 0;
  } else {
    newWrongStreak += 1;
    if (newWrongStreak >= 2) {
      newBar = Math.max(newBar - 1, 0);
      newWrongStreak = 0;
    }
  }
  if (newBar >= barMax) {
    completed = true;
    updates[`players.${localPlayerId}.completed`] = true;
  }
  // If no more questions, the player has "finished"
  if (nextQIndex >= gameRoomData.questions.length) {
    updates[`players.${localPlayerId}.finished`] = true;
  }
  updates[`players.${localPlayerId}.bar`] = newBar;
  updates[`players.${localPlayerId}.wrongStreak`] = newWrongStreak;
  updates[`players.${localPlayerId}.mpQIndex`] = nextQIndex;
  await updateDoc(roomRef, updates);

  // Optimistic UI update and game screen re-render for local player
  gameRoomData.players[localPlayerId].bar = newBar;
  gameRoomData.players[localPlayerId].wrongStreak = newWrongStreak;
  gameRoomData.players[localPlayerId].mpQIndex = nextQIndex;
  gameRoomData.players[localPlayerId].completed = updates[`players.${localPlayerId}.completed`] || player.completed;
  gameRoomData.players[localPlayerId].finished = updates[`players.${localPlayerId}.finished`] || player.finished;

  setTimeout(() => {
    // After update to Firebase, tryEndGame will be triggered by onSnapshot for all clients
    // If completed or finished, render personal result screen.
    if (gameRoomData.players[localPlayerId].completed || gameRoomData.players[localPlayerId].finished) {
        tryEndGame();
    } else {
        renderGameScreen();
    }
  }, 150); // Small delay for visual feedback before next question
};

// --- Live Chat ---
function setupChat(code) {
  const chatZone = document.getElementById('chatDisplay');
  chatZone.innerHTML = "";
  const chatCol = collection(db, `climb_chat_${code}`);
  const chatQ = query(chatCol, orderBy("ts"));
  if (chatUnsub) chatUnsub();
  chatUnsub = onSnapshot(chatQ, snap => {
    let arr = [];
    snap.forEach(doc => arr.push(doc.data()));
    chatZone.innerHTML = arr.map(msg => `<div class="chat-msg"><b>${msg.name}</b>: ${msg.text}</div>`).join('');
    chatZone.scrollTop = chatZone.scrollHeight;
  });
}
window.sendChatMsg = async function() {
  let msg = document.getElementById('chatInput').value.trim();
  if (!msg) return;
  const chatCol = collection(db, `climb_chat_${gameCode}`);
  await addDoc(chatCol, {
    name: playerName,
    text: msg,
    ts: Date.now()
  });
  document.getElementById('chatInput').value = "";
};