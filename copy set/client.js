// =============================================================================
// == FINAL LABELED client.js (with final layout fixes)                       ==
// =============================================================================
// This file handles all client-side logic, including rendering the game with
// p5.js, communicating with the server via Socket.IO, and managing user input.
// =============================================================================


// =============================================================================
// == GLOBAL VARIABLES & STATE MANAGEMENT                                     ==
// =============================================================================

let socket; // The main WebSocket connection object to the server.
let myJugadorName; // The internal name assigned to this client (e.g., "Jugador 1").
let myPlayerHand = []; // An array holding the domino objects for this player.
let gameState = {}; // A comprehensive object reflecting the current state of the game from the server.
let selectedTileIndex = null; // The index of the domino tile the player has clicked on in their hand.
let messageDisplay = { text: '', time: 0 }; // An object to manage temporary messages shown to the player.
let tileSound; // A variable to hold the sound played when a tile is placed.


// =============================================================================
// == P5.JS CORE FUNCTIONS (PRELOAD, SETUP, DRAW)                             ==
// =============================================================================

/**
 * (p5.js function) Preloads assets before the main setup.
 */
function preload() {
    soundFormats('mp3');
    tileSound = loadSound('assets/sounds/tile_place.mp3');
}

/**
 * (p5.js function) Runs once when the program starts.
 */
function setup() {
    const canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-container');
    setupLobby();
    setupButtonListeners();
}

/**
 * (p5.js function) The main rendering loop, runs continuously.
 */
function draw() {
    try {
        background(0, 100, 0);
        updateUI();
        updatePlayersUI();
        updateTeamInfo();
        updateScoreboard();
        if (gameState.board) drawBoard();
        if (myPlayerHand) drawHand();
        drawMessages();
    } catch (error) {
        console.error("[CLIENT] Error in draw loop:", error);
    }
}


// =============================================================================
// == LOBBY & SERVER CONNECTION                                               ==
// =============================================================================

function setupLobby() {
    const lobbyContainer = document.getElementById('lobby-container');
    const nameInput = document.getElementById('name-input');
    const setNameBtn = document.getElementById('set-name-btn');
    setNameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (name) {
            lobbyContainer.style.display = 'none';
            connectToServer(name);
        }
    });
}

function connectToServer(playerName) {
    socket = io();
    socket.on('connect', () => {
        console.log("Connected to server.");
        socket.emit('setPlayerName', playerName);
    });
    socket.on('playerAssigned', (name) => { myJugadorName = name; });
    socket.on('gameState', (state) => {
        gameState = state;
        const newRoundContainer = document.getElementById('new-round-container');
        if (!newRoundContainer) return;
        if (!gameState.gameInitialized && gameState.endRoundMessage) {
            const roundOverMessageDiv = document.getElementById('round-over-message');
            const newRoundBtn = document.getElementById('newRoundBtn');
            roundOverMessageDiv.innerText = gameState.endRoundMessage;
            newRoundContainer.style.display = 'block';
            const amIReady = gameState.readyPlayers.includes(myJugadorName);
            if (amIReady) {
                newRoundBtn.disabled = true;
                newRoundBtn.innerText = 'Esperano demas jugadores...';
            } else {
                newRoundBtn.disabled = false;
                newRoundBtn.innerText = 'Mano Nueva';
            }
        } else if (gameState.gameInitialized) {
            newRoundContainer.style.display = 'none';
        }
    });
    socket.on('playerHand', (hand) => myPlayerHand = hand || []);
    socket.on('gameError', (data) => showMessage(data.message));
    socket.on('moveSuccess', () => {
        selectedTileIndex = null;
        if (tileSound && tileSound.isLoaded()) {
            tileSound.play();
        }
    });
    socket.on('chatMessage', (data) => {
        const messagesDiv = document.getElementById('chat-messages');
        const messageElement = document.createElement('p');
        const myDisplayName = gameState.jugadoresInfo.find(p => p.name === myJugadorName)?.displayName;
        const senderName = data.sender === myDisplayName ? 'You' : data.sender;
        messageElement.innerHTML = `<b>${senderName}:</b> ${data.message}`;
        messagesDiv.appendChild(messageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
}


// =============================================================================
// == EVENT LISTENERS & USER INPUT HANDLING                                   ==
// =============================================================================

function setupButtonListeners() {
    document.getElementById('playLeftBtn').addEventListener('click', () => handlePlay('left'));
    document.getElementById('playRightBtn').addEventListener('click', () => handlePlay('right'));
    document.getElementById('passBtn').addEventListener('click', () => {
        if (clientHasValidMove()) {
            showMessage('Tiene una jugada valida, no puede pasar!');
        } else {
            socket.emit('passTurn');
            if (tileSound && tileSound.isLoaded()) {
                tileSound.play();
            }
        }
    });
    document.getElementById('newRoundBtn').addEventListener('click', () => {
        socket.emit('playerReadyForNewRound');
        newRoundBtn.disabled = true;
        newRoundBtn.innerText = 'Esperando por demas jugadores...';
    });
    const chatForm = document.getElementById('chat-input-form');
    const chatInput = document.getElementById('chat-input');
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const msg = chatInput.value.trim();
        if (msg && socket) {
            socket.emit('chatMessage', msg);
            chatInput.value = '';
        }
    });
}

function handlePlay(position) {
    if (selectedTileIndex === null) return;
    const tile = myPlayerHand[selectedTileIndex];
    socket.emit('placeTile', { tile, position });
    selectedTileIndex = null;
}

function mousePressed() {
    if (gameState.currentTurn !== myJugadorName) return;
    const tileWidth = 50, tileHeight = 100, gap = 10;
    const handWidth = myPlayerHand.length > 0 ? myPlayerHand.length * (tileWidth + gap) - gap : 0;
    const handStartY = height - tileHeight - 20;
    const handStartX = (width - handWidth) / 2;
    for (let i = 0; i < myPlayerHand.length; i++) {
        const x = handStartX + i * (tileWidth + gap);
        if (mouseX > x && mouseX < x + tileWidth && mouseY > handStartY && mouseY < handStartY + tileHeight) {
            selectedTileIndex = (selectedTileIndex === i) ? null : i;
            return;
        }
    }
}


// =============================================================================
// == UI & INFORMATION DISPLAY                                                ==
// =============================================================================

function showMessage(text) {
    messageDisplay = { text, time: millis() };
}

function updateUI() {
    const gameButtons = document.getElementById('game-buttons');
    if (!gameButtons) return;
    const isMyTurn = gameState.currentTurn === myJugadorName && gameState.gameInitialized;
    gameButtons.style.display = isMyTurn ? 'block' : 'none';
    if (isMyTurn) {
        document.getElementById('playLeftBtn').disabled = selectedTileIndex === null;
        document.getElementById('playRightBtn').disabled = selectedTileIndex === null;
    }
}

function setPlayerAvatar(imgElement, displayName, internalPlayerName) {
    const customAvatarSrc = `assets/icons/${displayName.toLowerCase()}_avatar.jpg`;
    const match = internalPlayerName.match(/\d+/);
    const playerNumber = match ? match[0] : 'default';
    const defaultAvatarSrc = `assets/icons/jugador${playerNumber}_avatar.jpg`;
    imgElement.onerror = function() {
        this.src = defaultAvatarSrc;
        this.onerror = null;
    };
    imgElement.src = customAvatarSrc;
}

function determinePlayerPositions(myPlayerName, teams) {
    if (!myPlayerName || !teams || !teams.teamA || !teams.teamA.length === 0) return {};
    const myTeam = teams.teamA.includes(myPlayerName) ? teams.teamA : teams.teamB;
    const otherTeam = teams.teamA.includes(myPlayerName) ? teams.teamB : teams.teamA;
    const myPartner = myTeam.find(p => p !== myPlayerName);
    if (!myPartner || otherTeam.length < 2) return { [myPlayerName]: 'bottom' };
    const turnOrder = ["Jugador 1", "Jugador 3", "Jugador 2", "Jugador 4"];
    const myTurnIndex = turnOrder.indexOf(myPlayerName);
    const leftPlayer = turnOrder[(myTurnIndex + 3) % 4];
    return {
        [myPlayerName]: 'bottom',
        [myPartner]: 'top',
        [leftPlayer]: 'left',
        [otherTeam.find(p => p !== leftPlayer)]: 'right',
    };
}

function updatePlayersUI() {
    if (!gameState || !gameState.jugadoresInfo || !myJugadorName) { return; }
    const playerPositions = determinePlayerPositions(myJugadorName, gameState.teams);
    if (Object.keys(playerPositions).length < 4) {
        ['top', 'bottom', 'left', 'right'].forEach(pos => {
            const div = document.getElementById(`player-display-${pos}`);
            if (div) div.style.display = 'none';
        });
        return;
    };
    Object.keys(playerPositions).forEach(playerName => {
        const position = playerPositions[playerName];
        const div = document.getElementById(`player-display-${position}`);
        if (!div) return;
        const playerData = gameState.jugadoresInfo.find(p => p.name === playerName);
        if (!playerData) return;
        div.innerHTML = '';
        div.style.display = 'flex';
        const img = document.createElement('img');
        img.alt = `${playerData.displayName} avatar`;
        setPlayerAvatar(img, playerData.displayName, playerData.name);
        const textDiv = document.createElement('div');
        textDiv.className = 'player-info-text';
        const finalDisplayName = `${playerData.displayName} (${playerData.name})`;
        textDiv.innerHTML = `
            <div class="player-name">${finalDisplayName} ${playerName === myJugadorName ? '(You)' : ''}</div>
            <div class="tile-count">Fichas: ${playerData.tileCount}</div>
        `;
        div.appendChild(img);
        div.appendChild(textDiv);
        if (playerData.name === gameState.currentTurn) {
            div.classList.add('current-turn');
        } else {
            div.classList.remove('current-turn');
        }
    });
}

function updateTeamInfo() {
    const teamInfoDiv = document.getElementById('team-info');
    if (!teamInfoDiv || !gameState.teams || !gameState.jugadoresInfo) return;
    const { teams, matchNumber } = gameState;
    const getDisplayName = (internalName) => {
        const player = gameState.jugadoresInfo.find(p => p.name === internalName);
        if (player && player.displayName && player.displayName !== player.name) {
            return `${player.displayName} (${player.name.slice(-1)})`;
        }
        return player ? player.displayName : internalName;
    };
    let teamsHtml = `<b>Match ${matchNumber || 1}</b><br>`;
    if (teams.teamA && teams.teamA.length > 0) { teamsHtml += `<b>Equipo A:</b> ${teams.teamA.map(getDisplayName).join(', ')}<br>`; }
    if (teams.teamB && teams.teamB.length > 0) { teamsHtml += `<b>Equipo B:</b> ${teams.teamB.map(getDisplayName).join(', ')}<br>`; }
    teamInfoDiv.innerHTML = teamsHtml;
}

function updateScoreboard() {
    const scoreboardDiv = document.getElementById('scoreboard');
    if (!scoreboardDiv || !gameState.teamScores) return;
    const { teamScores } = gameState;
    scoreboardDiv.innerHTML = `
        <b>Scores</b><br>
        Equipo A: ${teamScores.teamA || 0}<br>
        Equipo B: ${teamScores.teamB || 0}
    `;
}

function drawMessages() {
    const messageDiv = document.getElementById('message-display');
    if (!messageDiv) return;
    if (messageDisplay.text && millis() - messageDisplay.time < 5000) {
        messageDiv.innerText = messageDisplay.text;
    } else {
        messageDiv.innerText = '';
    }
}


// =============================================================================
// == CANVAS DRAWING FUNCTIONS                                                ==
// =============================================================================

function drawHand() {
    if (!myPlayerHand) return;
    const tileWidth = 50, tileHeight = 100, gap = 10;
    const handWidth = myPlayerHand.length > 0 ? myPlayerHand.length * (tileWidth + gap) - gap : 0;
    const handStartY = height - tileHeight - 20;
    const handStartX = (width - handWidth) / 2;
    myPlayerHand.forEach((tile, i) => {
        drawSingleDomino(tile, handStartX + i * (tileWidth + gap), handStartY, tileWidth, tileHeight, i === selectedTileIndex);
    });
}

function drawPips(pips, x, y, w, h, isHorizontal = false) {
    const patterns = {
      1: [[0.5, 0.5]],
      2: [[0.25, 0.25], [0.75, 0.75]],
      3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
      4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
      5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
      6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]]
    };
    if (pips === 0 || !patterns[pips]) return;
    push();
    translate(x + w / 2, y + h / 2);
    if (pips === 6 && isHorizontal) { rotate(PI / 2); }
    const currentPattern = patterns[pips];
    fill(0);
    noStroke();
    const pipSize = w / 6.5;
    currentPattern.forEach(p => {
        const pipX = (p[0] - 0.5) * w;
        const pipY = (p[1] - 0.5) * h;
        ellipse(pipX, pipY, pipSize, pipSize);
    });
    pop();
}

function drawSingleDomino(domino, x, y, w, h, isSelected, isReversed = false) {
    push();
    translate(x, y);
    strokeWeight(isSelected ? 3 : 1.5);
    stroke(isSelected ? 'yellow' : 'black');
    fill(245);
    rect(0, 0, w, h, 6);
    strokeWeight(1);
    stroke(0);
    const val1 = isReversed ? domino.right : domino.left;
    const val2 = isReversed ? domino.left : domino.right;
    if (w > h) { // Horizontal
        line(w / 2, 4, w / 2, h - 4);
        drawPips(val1, 0, 0, w / 2, h, true);
        drawPips(val2, w / 2, 0, w / 2, h, true);
    } else { // Vertical
        line(4, h / 2, w - 4, h / 2);
        drawPips(val1, 0, 0, w, h / 2, false);
        drawPips(val2, 0, h / 2, w, h / 2, false);
    }
    pop();
}

/**
 * Draws the entire board of played dominoes, handling the layout logic.
 * This is a complete, robust rewrite to finally fix all layout issues.
 */
function drawBoard() {
    if (!gameState.board || gameState.board.length === 0 || !gameState.spinnerTile) return;

    const { board, spinnerTile } = gameState;
    const long = 100, short = 50, gap = 4;
    const boardCenterY = height / 2 - 220;

    const spinnerIndex = board.findIndex(t => t.left === spinnerTile.left && t.right === spinnerTile.right);
    if (spinnerIndex === -1) return;

    let drawableTiles = new Array(board.length);

    const spinnerW = short, spinnerH = long;
    const spinnerX = width / 2 - spinnerW / 2;
    const spinnerY = boardCenterY - spinnerH / 2;
    drawableTiles[spinnerIndex] = { domino: spinnerTile, x: spinnerX, y: spinnerY, w: spinnerW, h: spinnerH, isReversed: false };

    // --- Right Side of Spinner ---
    let connR = { x: spinnerX + spinnerW, y: spinnerY + spinnerH / 2 };
    let dirR = { x: 1, y: 0 };
    let straightCountR = 0, turnCountR = 0;
    let turnAfterR = 5;

    for (let i = spinnerIndex + 1; i < board.length; i++) {
        const domino = board[i];
        const isDouble = domino.left === domino.right;
        let x, y, w, h;
        let applyOffset = false; // Flag to apply the offset for the second turn tile

if (turnCountR < 2 && straightCountR >= turnAfterR) {
    const oldDir = { ...dirR };
    dirR = { x: -oldDir.y, y: oldDir.x };
    w = (dirR.x !== 0) ? (isDouble ? short : long) : (isDouble ? long : short);
    h = (dirR.x !== 0) ? (isDouble ? long : short) : (isDouble ? short : long);
// This is the new line that prevents doubles from turning
if (turnCountR < 2 && straightCountR >= turnAfterR && !isDouble) {
}
    // This block handles the first turn (top corner)
    if (oldDir.x === 1) {
        y = connR.y - (isDouble ? long/2 : short/2);
        x = connR.x;
    }
    // This block handles the second turn (bottom corner)
    else if (oldDir.y === 1) {
        y = connR.y + gap;
        // This line is corrected to move the tile to the LEFT.
        x = connR.x - (isDouble ? short / 2 : long / 2) - (isDouble ? 0 : short / 2);
    }

    turnCountR++;
    turnAfterR = 4;
    straightCountR = 0;



        } else {
            w = (dirR.x !== 0) ? (isDouble ? short : long) : (isDouble ? long : short);
            h = (dirR.x !== 0) ? (isDouble ? long : short) : (isDouble ? short : long);
            if (dirR.x === 1) { x = connR.x + gap; y = connR.y - h / 2; }
            else if (dirR.y === 1) { y = connR.y + gap; x = connR.x - w / 2; }
            else { x = connR.x - w - gap; y = connR.y - h / 2; }
        }

        // Apply a 50px offset only when the flag is true
        const finalX = x + (applyOffset ? 50 : 0);
        drawableTiles[i] = { domino, x: finalX, y, w, h, isReversed: (dirR.x === -1 || dirR.y === -1) };

        // The rest of the logic uses the original 'x' to ensure other tiles are not affected
        if (dirR.x === 1) { connR = { x: x + w, y: y + h / 2 }; }
        else if (dirR.x === -1) { connR = { x: x, y: y + h / 2 }; }
        else if (dirR.y === 1) { connR = { x: x + w / 2, y: y + h }; }
        else { connR = { x: x + w / 2, y: y }; }
        straightCountR++;
    }

    // --- Left Side of Spinner ---
    let connL = { x: spinnerX, y: spinnerY + spinnerH / 2 };
    let dirL = { x: -1, y: 0 };
    let straightCountL = 0, turnCountL = 0;
    let turnAfterL = 5;

    for (let i = spinnerIndex - 1; i >= 0; i--) {
        const domino = board[i];
        const isDouble = domino.left === domino.right;
        let x, y, w, h;

if (turnCountL < 2 && straightCountL >= turnAfterL) {
    const oldDir = { ...dirL };
    dirL = { x: oldDir.y, y: -oldDir.x };
    w = (dirL.x !== 0) ? (isDouble ? short : long) : (isDouble ? long : short);
    h = (dirL.x !== 0) ? (isDouble ? long : short) : (isDouble ? short : long);

    // This handles the first turn on the left
    if (oldDir.x === -1) {
        const yOffset = -short / 2;
        y = connL.y + yOffset;
        x = connL.x - w;
    }
    // This handles the second turn on the left
    else if (oldDir.y === 1) {
        y = connL.y + gap;
        // This mirrors the working logic from the right side
        x = connL.x - w / 2 + (isDouble ? 0 : short / 2);
    }

    turnCountL++;
    turnAfterL = 3;
    straightCountL = 0;


        } else {
            w = (dirL.x !== 0) ? (isDouble ? short : long) : (isDouble ? long : short);
            h = (dirL.x !== 0) ? (isDouble ? long : short) : (isDouble ? short : long);
            if (dirL.x === -1) { x = connL.x - w - gap; y = connL.y - h / 2; }
            else if (dirL.y === 1) { y = connL.y + gap; x = connL.x - w / 2; }
            else { x = connL.x + gap; y = connL.y - h / 2; }
        }

        const isReversed = !(dirL.x === -1 || dirL.y === -1);
        drawableTiles[i] = { domino, x, y, w, h, isReversed };

        if (dirL.x === 1) { connL = { x: x + w, y: y + h / 2 }; }
        else if (dirL.x === -1) { connL = { x: x, y: y + h / 2 }; }
        else if (dirL.y === 1) { connL = { x: x + w / 2, y: y + h }; }
        else { connL = { x: x + w / 2, y: y }; }
        straightCountL++;
    }

    // --- Draw all tiles ---
    drawableTiles.forEach(t => {
        if (t) drawSingleDomino(t.domino, t.x, t.y, t.w, t.h, false, t.isReversed);
    });
}


function clientHasValidMove() {
    if (!myPlayerHand || myPlayerHand.length === 0) return false;
    if (gameState.isFirstMove) {
        if (gameState.isFirstRoundOfMatch) {
            return myPlayerHand.some(t => t.left === 6 && t.right === 6);
        }
        return true;
    }
    return myPlayerHand.some(t => t.left === gameState.leftEnd || t.right === gameState.leftEnd || t.left === gameState.rightEnd || t.right === gameState.rightEnd);
}