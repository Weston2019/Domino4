// =============================================================================
// == FINAL LABELED client.js        7/10/2025                                         ==
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
let lastPlayedHighlight = { tile: null, timestamp: 0 }; // NEW: For the highlight effect.


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
        updateUI(); // Restored this function call
        updatePlayersUI();
        updateTeamInfo();
        updateScoreboard();
        updateMatchesWon();
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

/**
 * Sets up the initial name-entry lobby screen.
 */
function setupLobby() {
    const newRoundContainer = document.getElementById('new-round-container');
    if (newRoundContainer) newRoundContainer.style.display = 'none';
    const lobbyContainer = document.getElementById('lobby-container');
    const nameInput = document.getElementById('name-input');
    const setNameBtn = document.getElementById('set-name-btn');
    nameInput.focus(); 
    setNameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (name) {
            // NOTE: The hasJoinedGame flag system has been removed to prevent UI conflicts.
            // Visibility is now handled directly by the server's game state.
            lobbyContainer.style.display = 'none';
            connectToServer(name); 
        }
    });
}

/**
 * Establishes the connection to the server via Socket.IO and sets up listeners.
 */
function connectToServer(playerName) {
    socket = io();

    socket.on('connect', () => {
        console.log("Connected to server.");
        socket.emit('setPlayerName', playerName);
    });

    socket.on('playerAssigned', (name) => { myJugadorName = name; });

    socket.on('gameState', (state) => {
        // NEW: Check if a new tile has been played and update the highlight info.
        if (state.lastPlayedTile && 
            (!gameState.lastPlayedTile || JSON.stringify(state.lastPlayedTile) !== JSON.stringify(gameState.lastPlayedTile))) {
            lastPlayedHighlight = { tile: state.lastPlayedTile, timestamp: millis() };
        }
        gameState = state;
        
        // This handles showing the "New Round" dialog
        const newRoundContainer = document.getElementById('new-round-container');
        if (!newRoundContainer) return;

        if (!gameState.gameInitialized && gameState.endRoundMessage) {
            const roundOverMessageDiv = document.getElementById('round-over-message');
            const newRoundBtn = document.getElementById('newRoundBtn');
            roundOverMessageDiv.innerText = gameState.endRoundMessage;
            newRoundContainer.style.display = 'block';

            const amIReady = gameState.readyPlayers && gameState.readyPlayers.includes(myJugadorName);
            newRoundBtn.disabled = amIReady;
            newRoundBtn.innerText = amIReady ? 'Esperando por los demas...' : 'Mano Nueva';
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
            showMessage('You have a valid move, you cannot pass!');
        } else {
            socket.emit('passTurn');
            if (tileSound && tileSound.isLoaded()) {
                tileSound.play();
            }
        }
    });

    document.getElementById('newRoundBtn').addEventListener('click', () => {
        socket.emit('playerReadyForNewRound');
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

function showMessage(text) {
    messageDisplay = { text, time: millis() };
}

function getPlayerIcon(imgElement, displayName, internalPlayerName) {
    if (!internalPlayerName) return; 
    const customAvatarSrc = `assets/icons/${displayName}_avatar.jpg`;
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
    if (!myPlayerName || !teams || !teams.teamA || !teams.teamA.length) return {};
    const myTeam = teams.teamA.includes(myPlayerName) ? teams.teamA : teams.teamB;
    const otherTeam = teams.teamA.includes(myPlayerName) ? teams.teamB : teams.teamA;
    const myPartner = myTeam.find(p => p !== myPlayerName);
    if (!myPartner || !otherTeam || otherTeam.length < 2) return { [myPlayerName]: 'bottom' };
    const turnOrder = ["Jugador 1", "Jugador 3", "Jugador 2", "Jugador 4"];
    const myTurnIndex = turnOrder.indexOf(myPlayerName);
    if (myTurnIndex === -1) return {};
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

        div.style.display = 'flex';
        div.innerHTML = ''; 

        const imgElement = document.createElement('img');
        imgElement.alt = `${playerData.displayName} avatar`;
        getPlayerIcon(imgElement, playerData.displayName, playerData.name);

        const infoDiv = document.createElement('div');
        infoDiv.className = 'player-info-text';

        const finalDisplayName = `${playerData.displayName} (${playerData.name})`;
        infoDiv.innerHTML = `
            <div class="player-name">${finalDisplayName} ${playerName === myJugadorName ? '(You)' : ''}</div>
            <div class="tile-count">Fichas: ${playerData.tileCount}</div>`;

        div.appendChild(imgElement);
        div.appendChild(infoDiv);

        div.classList.toggle('current-turn', playerData.name === gameState.currentTurn);
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
        drawSingleDomino(tile, handStartX + i * (tileWidth + gap), handStartY, tileWidth, tileHeight, i === selectedTileIndex, false);
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
    if (pips === 6 && isHorizontal) {
        rotate(PI / 2);
    }

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

// NEW: Added isHighlighted parameter
function drawSingleDomino(domino, x, y, w, h, isSelected, isReversed, isHighlighted = false) {
    push();
    translate(x, y);

    if (isHighlighted) {
        strokeWeight(4);
        stroke(0, 255, 255); // Bright cyan color for the glow
    } else {
        strokeWeight(isSelected ? 3 : 1.5);
        stroke(isSelected ? 'yellow' : 'black');
    }

    fill(245);
    rect(0, 0, w, h, 6);
    strokeWeight(1);
    stroke(0);
    
    const val1 = isReversed ? domino.right : domino.left;
    const val2 = isReversed ? domino.left : domino.right;

    if (w > h) { // Horizontal Tile
        line(w / 2, 4, w / 2, h - 4);
        drawPips(val1, 0, 0, w / 2, h, true);
        drawPips(val2, w / 2, 0, w / 2, h, true);
    } else { // Vertical Tile
        line(4, h / 2, w - 4, h / 2);
        drawPips(val1, 0, 0, w, h / 2, false);
        drawPips(val2, 0, h / 2, w, h / 2, false);
    }
    pop();
}

function updateMatchesWon() {
    const container = document.getElementById('matches-won-container');
    if (!container) return;

    if (!gameState.jugadoresInfo || gameState.jugadoresInfo.length === 0) {
        container.innerHTML = ''; 
        return;
    }

    container.style.display = 'block';
    let matchesWonHtml = '';

    gameState.jugadoresInfo.forEach(playerInfo => {
        const stats = gameState.playerStats ? gameState.playerStats[playerInfo.name] : null;
        const wins = stats ? stats.matchesWon : 0;
        matchesWonHtml += `<p>${playerInfo.displayName}: ${wins}</p>`;
    });

    container.innerHTML = matchesWonHtml;
}


/**
 * Draws the entire board of played dominoes, handling the layout logic.
 * This is your original function, with the glow logic integrated.
 */
function drawBoard() {
    if (!gameState.board || gameState.board.length === 0 || !gameState.spinnerTile) return;

    const { board, spinnerTile } = gameState;
    const long = 100, short = 50, gap = 2;
    const boardCenterY = height / 2 - 225;

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

        if (turnCountR < 2 && straightCountR >= turnAfterR) {
            const oldDir = { ...dirR };
            dirR = { x: -oldDir.y, y: oldDir.x };

            w = (dirR.x !== 0) ? long : short;
            h = (dirR.x !== 0) ? short : long;
            
            if (oldDir.x === 1) {
                y = connR.y - short / 2;
                x = connR.x + gap;
            } else if (oldDir.y === 1) {
                y = connR.y + gap;
                x = connR.x + (short / 2) - w;
            }
            
            turnCountR++;
            turnAfterR = 4;
            straightCountR = 0;

        } else {
            // THIS IS THE SECTION TO MODIFY FOR THE DOUBLES ON DOWN BRANCHES
            if (dirR.x !== 0) { // Horizontal line
                w = isDouble ? short : long;
                h = isDouble ? long : short;
            } else { // Vertical line (down branch)
                // If it's a double on a vertical run, make it horizontal
                w = isDouble ? long : short;
                h = isDouble ? short : long;
            }
            
            if (dirR.x === 1) { x = connR.x + gap; y = connR.y - h / 2; }
            else if (dirR.y === 1) { y = connR.y + gap; x = connR.x - w / 2; }
            else { x = connR.x - w - gap; y = connR.y - h / 2; }
        }

        drawableTiles[i] = { domino, x, y, w, h, isReversed: (dirR.x === -1 || dirR.y === -1) };
        
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

            w = (dirL.x !== 0) ? long : short;
            h = (dirL.x !== 0) ? short : long;
            
            if (oldDir.x === -1) {
                y = connL.y - short / 2;
                x = connL.x - w - gap;
            } else if (oldDir.y === 1) {
                y = connL.y + gap;
                x = connL.x - (short / 2);
            }

            turnCountL++;
            turnAfterL = 3;
            straightCountL = 0;

        } else {
            // THIS IS THE SECTION TO MODIFY FOR THE DOUBLES ON DOWN BRANCHES
            if (dirL.x !== 0) { // Horizontal line
                w = isDouble ? short : long;
                h = isDouble ? long : short;
            } else { // Vertical line (down branch)
                // If it's a double on a vertical run, make it horizontal
                w = isDouble ? long : short;
                h = isDouble ? short : long;
            }

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
        if (t) {
            let isHighlighted = false;
            if (lastPlayedHighlight.tile && 
                millis() - lastPlayedHighlight.timestamp < 2500 &&
                t.domino.left === lastPlayedHighlight.tile.left && 
                t.domino.right === lastPlayedHighlight.tile.right) {
                isHighlighted = true;
            }
            drawSingleDomino(t.domino, t.x, t.y, t.w, t.h, false, t.isReversed, isHighlighted);
        }
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
