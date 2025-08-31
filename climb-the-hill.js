// Climb The Hill - Multiplayer Quiz Game Logic (2024-08-28) - Enhanced Leaderboard & Module Selection

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
let selectedModule = "computersystem_questions";

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
  const sel = document.getElementById('collectionSelect');
  if (sel) sel.disabled = false;
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
  // Get selected module
  const sel = document.getElementById('collectionSelect');
  selectedModule = sel && sel.value ? sel.value : "computersystem_questions";
  if (sel) sel.disabled = true;
  gameCode = randomCode();
  localPlayerId = randomCode() + Date.now();
  // Fetch questions from the selected module/collection
  const colRef = collection(db, selectedModule);
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
    module: selectedModule,
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
        ready: false
      }
    },
    lastGameStartTS: now
  });
  joinGameRoom(gameCode, localPlayerId, true);
};

// --- Join Game Room ---
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

    // Read module from room data
    selectedModule = data.module || "computersystem_questions";

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
        ready: false
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

    // Set the currently selected module from DB
    selectedModule = gameRoomData.module || "computersystem_questions";
    renderRoomPlayers(gameRoomData.players || {});
    renderLeaderboardBar();

    // --- SHOW MODULE IN ROOM MENU ---
    const moduleMap = {
      "computersystem_questions": "Computer System",
      "datandigitial_questions": "Data n Digital",
      "economics_questions": "Economics",
      "feedback_questions": "Feedback",
      "computeraided_questions": "Computer-Aided"
    };
    const moduleShow = document.getElementById('roomModuleShow');
    if (moduleShow) {
      moduleShow.innerHTML = `<b>Quiz Module:</b> ${moduleMap[selectedModule] || selectedModule}`;
    }

    // If the game is finished (all players done or winner determined), show placement/results screen
    if (shouldShowResultsScreen()) {
      show('gamePlay');
      renderPlacementScreen();
      clearInterval(timerInterval);
      return;
    }

    // Check if the game should be in gameplay or room menu
    if (gameRoomData.started && !gameRoomData.playAgainStatus) {
      show('gamePlay');
      if (lobbyChatUnsub) lobbyChatUnsub();
      startGamePlay();
      setupChat(gameCode);
    } else {
      show('roomMenu');
      if (chatUnsub) chatUnsub();
      setupLobbyChat(gameCode);
      const localPlayer = gameRoomData.players[localPlayerId];
      if (localPlayer) {
        document.getElementById('roomReadyBtn').innerText = localPlayer.ready ? "Ready ✔" : "Ready";
        document.getElementById('roomReadyBtn').disabled = localPlayer.ready;
      }
    }
  });
}
function shouldShowResultsScreen() {
  if (!gameRoomData) return false;
  const finishedPlayers = gameRoomData.finishedPlayers || [];
  const allPlayers = leaderboardOrder.filter(pid => gameRoomData.players[pid]);
  return (
    gameRoomData.started &&
    !gameRoomData.playAgainStatus &&
    (
      !!gameRoomData.winner ||
      finishedPlayers.length === allPlayers.length ||
      (gameRoomData.endTime && Date.now() > gameRoomData.endTime)
    )
  );
}
function renderRoomPlayers(players) {
  const zone = document.getElementById('roomPlayers');
  if (!players || Object.keys(players).length === 0) {
    zone.innerHTML = "<i>No players yet.</i>";
    document.getElementById('roomStartBtn').disabled = true;
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
    document.getElementById('roomStartBtn').style.display = 'none';
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
    playAgainStatus: false
  });
};
window.leaveRoom = function() {
  if (gameRoomUnsub) gameRoomUnsub();
  if (lobbyChatUnsub) lobbyChatUnsub();
  if (chatUnsub) chatUnsub();
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
  if (player.completed || player.finished || player.mpQIndex >= gameRoomData.questions.length) {
    tryEndGame();
    renderPersonalResultScreen();
    return;
  }
  let mpQIndex = player.mpQIndex || 0;
  let q = gameRoomData.questions[mpQIndex];
  if (!q) {
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
  const player = gameRoomData.players[localPlayerId];
  let finishedPlayers = gameRoomData.finishedPlayers || [];
  let allPlayers = leaderboardOrder.filter(pid => gameRoomData.players[pid]);

  // 1. If a player reaches barMax (20), they win immediately, mark winner and everyone as finished
  if (player.bar >= barMax && !gameRoomData.winner) {
    let patch = {};
    patch[`players.${localPlayerId}.completed`] = true;
    patch[`players.${localPlayerId}.finishMillis`] = Date.now();
    patch[`players.${localPlayerId}.score`] = player.bar;
    patch["winner"] = player.name;
    // Mark all others as finished if not already
    for (let pid of allPlayers) {
      if (pid !== localPlayerId && !gameRoomData.players[pid].finished && !gameRoomData.players[pid].completed) {
        patch[`players.${pid}.finished`] = true;
        patch[`players.${pid}.finishMillis`] = Date.now();
        patch[`players.${pid}.score`] = gameRoomData.players[pid].bar;
      }
    }
    await updateDoc(doc(db, "climb_games", gameCode), patch);
    return;
  }

  // 2. If all questions are finished for this player (but didn't reach barMax)
  if ((player.completed || player.finished || player.mpQIndex >= gameRoomData.questions.length) && !player.finishMillis) {
    const finishMillis = Date.now();
    let patch = {};
    patch[`players.${localPlayerId}.finishMillis`] = finishMillis;
    patch[`players.${localPlayerId}.score`] = player.bar || 0;

    if (!finishedPlayers.some(fp => fp.pid === localPlayerId)) {
      finishedPlayers = finishedPlayers.slice();
      finishedPlayers.push({
        pid: localPlayerId,
        name: player.name,
        score: player.bar || 0,
        finishMillis
      });
      patch["finishedPlayers"] = finishedPlayers;
    }
    await updateDoc(doc(db, "climb_games", gameCode), patch);
  }

  // 3. If time runs out, ensure all players are marked finished and scores are set for non-finishers
  if (gameRoomData.endTime && Date.now() > gameRoomData.endTime) {
    let patch = {};
    for (let pid of allPlayers) {
      let p = gameRoomData.players[pid];
      if (!p.finishMillis) {
        patch[`players.${pid}.finished`] = true;
        patch[`players.${pid}.finishMillis`] = Date.now();
        patch[`players.${pid}.score`] = p.bar || 0;
      }
    }
    await updateDoc(doc(db, "climb_games", gameCode), patch);
  }
}

// --- Show personal result (while waiting others or after forced finish) ---
function renderPersonalResultScreen() {
  const player = gameRoomData.players[localPlayerId];
  if (!player.finishMillis) {
    document.getElementById('gameCenter').innerHTML = `
      <div style="font-size:2em;color:#FFD700;margin-bottom:20px;">🎉 You finished!</div>
      <div>Please wait for the players to finish...</div>
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
    <div style="margin-top:20px;">Please wait for the players to finish...</div>
  `;
}

// --- Show placements for all when game is over ---
function renderPlacementScreen() {
  let finishedPlayers = (gameRoomData.finishedPlayers || []).slice();
  let allPlayers = leaderboardOrder.filter(pid => gameRoomData.players[pid]);
  for (let pid of allPlayers) {
    if (!finishedPlayers.some(fp => fp.pid === pid)) {
      let p = gameRoomData.players[pid];
      finishedPlayers.push({
        pid,
        name: p.name,
        score: p.bar || 0,
        finishMillis: p.finishMillis || Date.now()
      });
    }
  }
  finishedPlayers.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.finishMillis - b.finishMillis;
  });
  let winner = finishedPlayers.length > 0 ? finishedPlayers[0] : null;
  let isHost = (localPlayerId === gameRoomData.host);

  let html = `<div class="flag-trophy"></div>
    <h2 style="color:#FFD700;text-align:center;">Results</h2>
    <div class="leaderboard">`;
  for (let i=0;i<finishedPlayers.length;i++) {
    let tp = finishedPlayers[i];
    let timeSec = Math.max(0, Math.floor((tp.finishMillis-(gameRoomData.lastGameStartTS||0))/1000));
    let mm = String(Math.floor(timeSec/60)).padStart(1,"0");
    let ss = String(timeSec%60).padStart(2,"0");
    html += `<div${i === 0 ? ' style="font-weight:bold;color:#FFD700;"' : ''}>${i+1}. <b>${tp.name}</b> &nbsp; <span style="color:#FFD700;">${mm}:${ss}</span> &nbsp; <span style="color:#3B82F6;">Score: ${tp.score}</span></div>`;
  }
  html += `</div>`;

  // Module selector for host
  if (isHost) {
    html += `
      <div id="playAgainModuleSelect" style="margin-top:10px;">
        <label style="color:#FFD700;font-weight:bold;">Next Quiz Module:</label>
        <select id="nextModuleSelect">
          <option value="computersystem_questions">Computer System</option>
          <option value="datandigitial_questions">Data n Digital</option>
          <option value="economics_questions">Economics</option>
          <option value="feedback_questions">Feedback</option>
          <option value="computeraided_questions">Computer-Aided</option>
        </select>
      </div>
    `;
  }

  html += `<div id="playAgainZone" style="margin-top:18px;"></div>
    <div id="playAgainError" style="color:#FFD700;margin-top:8px;"></div>`;
  document.getElementById('gameCenter').innerHTML = html;
  setupPlayAgainButton(winner && winner.pid);
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
  // Only the host gets the Play Again button
  if (localPlayerId === gameRoomData.host) {
    document.getElementById('playAgainZone').innerHTML = `
      <button onclick="window.playAgainClick()">Play Again</button>
    `;
  } else {
    document.getElementById('playAgainZone').innerHTML = `<div>Waiting for host to restart the game...</div>`;
  }
  const errorBox = document.getElementById('playAgainError');
  if (errorBox) errorBox.innerText = "";
}

window.playAgainClick = async function() {
  try {
    await finishAndCommitWinner();
  } catch (err) {
    console.error("[PlayAgain] Button error", err);
    const errorBox = document.getElementById('playAgainError');
    if (errorBox) errorBox.innerText = `PlayAgain error: ${err.message}`;
  }
};

async function finishAndCommitWinner() {
  try {
    let leaderboardObj = {...(gameRoomData.leaderboard || {})};
    // Winner id for leaderboard
    let winnerPid = null;
    let finishedPlayers = (gameRoomData.finishedPlayers || []).slice();
    finishedPlayers.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.finishMillis - b.finishMillis;
    });
    if (finishedPlayers.length > 0) winnerPid = finishedPlayers[0].pid;
    if (winnerPid) leaderboardObj[winnerPid] = (leaderboardObj[winnerPid] || 0) + 1;

    // Determine new module for next round
    let newModule = gameRoomData.module;
    if (localPlayerId === gameRoomData.host) {
      const sel = document.getElementById('nextModuleSelect');
      if (sel) newModule = sel.value;
    }

    // Use the selected module for new questions
    const colRef = collection(db, newModule || "computersystem_questions");
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
          ready: false
        };
      }
    });

    const newEnd = Date.now() + 5*60*1000;
    await updateDoc(doc(db, "climb_games", gameCode), {
      questions,
      playAgain: [],
      started: false,
      endTime: newEnd,
      lastGameStartTS: Date.now(),
      winner: null,
      leaderboard: leaderboardObj,
      players: playersPatch,
      finishedPlayers: [],
      playAgainStatus: true,
      module: newModule
    });
    console.log("[PlayAgain] Game reset for new round!");
  } catch (err) {
    console.error("[PlayAgain] CommitWinner error", err);
    const errorBox = document.getElementById('playAgainError');
    if (errorBox) errorBox.innerText = `CommitWinner error: ${err.message}`;
  }
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
  if (nextQIndex >= gameRoomData.questions.length) {
    updates[`players.${localPlayerId}.finished`] = true;
  }
  updates[`players.${localPlayerId}.bar`] = newBar;
  updates[`players.${localPlayerId}.wrongStreak`] = newWrongStreak;
  updates[`players.${localPlayerId}.mpQIndex`] = nextQIndex;
  await updateDoc(roomRef, updates);

  gameRoomData.players[localPlayerId].bar = newBar;
  gameRoomData.players[localPlayerId].wrongStreak = newWrongStreak;
  gameRoomData.players[localPlayerId].mpQIndex = nextQIndex;
  gameRoomData.players[localPlayerId].completed = updates[`players.${localPlayerId}.completed`] || player.completed;
  gameRoomData.players[localPlayerId].finished = updates[`players.${localPlayerId}.finished`] || player.finished;

  setTimeout(() => {
    if (gameRoomData.players[localPlayerId].completed || gameRoomData.players[localPlayerId].finished) {
        tryEndGame();
    } else {
        renderGameScreen();
    }
  }, 120);
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