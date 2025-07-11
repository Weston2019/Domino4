// =============================================================================
// == server.js                                                               ==
// =============================================================================
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));

// =============================================================================
// == GLOBAL VARIABLES & GAME STATE MANAGEMENT                                ==
// =============================================================================

const POINTS_TO_WIN_MATCH = 10;
let jugadores = createJugadores();
let gameState = createNewGameState(jugadores); // Pass players to the function

/**
 * (ROUTINE) Creates the initial array of four player slots for the game.
 */
function createJugadores() {
    return [
        { name: "Jugador 1", assignedName: null, socketId: null, isConnected: false },
        { name: "Jugador 2", assignedName: null, socketId: null, isConnected: false },
        { name: "Jugador 3", assignedName: null, socketId: null, isConnected: false },
        { name: "Jugador 4", assignedName: null, socketId: null, isConnected: false }
    ];
}

/**
 * (ROUTINE) Creates or resets the main game state object to its default values.
 */
function createNewGameState() {
    const initialStats = {};
    jugadores.forEach(p => {
        initialStats[p.name] = { matchesWon: 0 };
    });

    return {
        jugadoresInfo: [],
        board: [],
        currentTurn: null,
        gameInitialized: false,
        leftEnd: null,
        rightEnd: null,
        teamScores: { teamA: 0, teamB: 0 },
        isFirstMove: true,
        teams: { teamA: [], teamB: [] },
        hands: {},
        spinnerTile: null,
        lastWinner: null,
        isFirstRoundOfMatch: true,
        readyPlayers: new Set(),
        endRoundMessage: null,
        matchNumber: 1,
        playerStats: initialStats,
        lastPlayedTile: null // NEW: Track the last tile played for highlighting
    };
}


// =============================================================================
// == CORE GAME UTILITY FUNCTIONS                                             ==
// =============================================================================

/**
 * (ROUTINE) Generates a standard 28-tile set of dominoes.
 */
function generateDominoes() {
    const d = [];
    for (let i = 0; i <= 6; i++) { for (let j = i; j <= 6; j++) d.push({ left: i, right: j }); }
    return d;
}

/**
 * (ROUTINE) Shuffles an array in place.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/**
 * (ROUTINE) Calculates the total pip value of a player's hand.
 */
function calculateHandValue(hand) {
    if (!hand || hand.length === 0) return 0;
    return hand.reduce((sum, tile) => sum + tile.left + tile.right, 0);
}

/**
 * (ROUTINE) Broadcasts the current game state to ALL connected clients.
 */
function broadcastGameState() {
    gameState.jugadoresInfo = jugadores.map(p => ({
        name: p.name,
        displayName: p.assignedName || p.name,
        isConnected: p.isConnected,
        tileCount: gameState.hands[p.name] ? gameState.hands[p.name].length : 0,
    }));
    const stateToSend = { ...gameState };
    stateToSend.readyPlayers = Array.from(gameState.readyPlayers);
    const { hands, ...finalState } = stateToSend;
    io.emit('gameState', finalState);
}

// =============================================================================
// == CORE GAME LOGIC FUNCTIONS                                               ==
// =============================================================================

/**
 * (ROUTINE) Deals 7 dominoes to each connected player.
 */
function dealHands() {
    let dominoesPool = generateDominoes();
    shuffleArray(dominoesPool);
    const connectedPlayers = jugadores.filter(p => p.isConnected);
    connectedPlayers.forEach(player => {
        gameState.hands[player.name] = dominoesPool.splice(0, 7);
        if (player.socketId) {
            io.to(player.socketId).emit('playerHand', gameState.hands[player.name]);
        }
    });
}

/**
 * (ROUTINE) Checks if a player has any valid moves in their hand.
 */
function hasValidMove(playerName) {
    const hand = gameState.hands[playerName];
    if (!hand) return false;
    if (gameState.isFirstMove) {
        if (gameState.isFirstRoundOfMatch) {
            return hand.some(t => t.left === 6 && t.right === 6);
        }
        return true;
    }
    return hand.some(t => t.left === gameState.leftEnd || t.right === gameState.leftEnd || t.left === gameState.rightEnd || t.right === gameState.rightEnd);
}

/**
 * (ROUTINE) Advances the turn to the next player.
 */
function nextTurn() {
    if (!gameState.currentTurn) return;
    const turnOrder = { "Jugador 1": "Jugador 3", "Jugador 3": "Jugador 2", "Jugador 2": "Jugador 4", "Jugador 4": "Jugador 1" };
    gameState.currentTurn = turnOrder[gameState.currentTurn];
}

/**
 * (ROUTINE) Initializes all state variables for a new round of play.
 */
function initializeRound() {
    gameState.gameInitialized = true;
    gameState.isFirstMove = true;
    gameState.board = [];
    gameState.leftEnd = null;
    gameState.rightEnd = null;
    gameState.spinnerTile = null;
    gameState.endRoundMessage = null;
    gameState.lastPlayedTile = null; // NEW: Reset for the new round.

    const playerNames = ["Jugador 1", "Jugador 2", "Jugador 3", "Jugador 4"];
    const rotation = (gameState.matchNumber - 1) % 3;
    if (rotation === 0) {
        gameState.teams.teamA = [playerNames[0], playerNames[1]];
        gameState.teams.teamB = [playerNames[2], playerNames[3]];
    } else if (rotation === 1) {
        gameState.teams.teamA = [playerNames[0], playerNames[2]];
        gameState.teams.teamB = [playerNames[1], playerNames[3]];
    } else {
        gameState.teams.teamA = [playerNames[0], playerNames[3]];
        gameState.teams.teamB = [playerNames[1], playerNames[2]];
    }
    
    dealHands();
    const connectedPlayerNames = jugadores.filter(p => p.isConnected).map(p => p.name);

    if (gameState.isFirstRoundOfMatch) {
        const startingPlayer = connectedPlayerNames.find(p => gameState.hands[p] && gameState.hands[p].some(t => t.left === 6 && t.right === 6));
        gameState.currentTurn = startingPlayer || "Jugador 1";
    } else {
        gameState.currentTurn = gameState.lastWinner && connectedPlayerNames.includes(gameState.lastWinner) ? gameState.lastWinner : "Jugador 1";
    }
    broadcastGameState();
}

/**
 * (ROUTINE) Ends the current round, calculates scores, and checks for a match winner.
 */
function endRound(outcome) {
    let endMessage = "Round Over!";
    let matchOverMessage = "";

    try {
        let winningTeamKeyThisRound = null;
        if (outcome.winner) {
            const winner = outcome.winner;
            gameState.lastWinner = winner;
            const winnerTeam = gameState.teams.teamA.includes(winner) ? 'teamA' : 'teamB';
            winningTeamKeyThisRound = winnerTeam;
            const loserTeamKey = winnerTeam === 'teamA' ? 'teamB' : 'teamA';
            const points = gameState.teams[loserTeamKey].reduce((total, p) => total + calculateHandValue(gameState.hands[p]), 0);
            gameState.teamScores[winnerTeam] += points;
            const winnerDisplayName = gameState.jugadoresInfo.find(p => p.name === winner).displayName;
            endMessage = `${winnerDisplayName} domino! Equipo ${winnerTeam.slice(-1)} gana ${points} puntos!`;
        } else if (outcome.blocked) {
            const scoreA = gameState.teams.teamA.reduce((total, p) => total + calculateHandValue(gameState.hands[p]), 0);
            const scoreB = gameState.teams.teamB.reduce((total, p) => total + calculateHandValue(gameState.hands[p]), 0);
            let points;
            if (scoreA < scoreB) { winningTeamKeyThisRound = 'teamA'; points = scoreB; } 
            else if (scoreB < scoreA) { winningTeamKeyThisRound = 'teamB'; points = scoreA; }
            else { winningTeamKeyThisRound = null; points = 0; endMessage = `Juego Cerrado! Empata nadie gana.`; }
            
            if (winningTeamKeyThisRound) {
                gameState.teamScores[winningTeamKeyThisRound] += points;
                endMessage = `Juego Cerrado! Equipo ${winningTeamKeyThisRound.slice(-1)} gana con menos puntos, gana ${points} puntos.`;
            }
            const allPipCounts = jugadores.map(p => p.isConnected ? { player: p.name, score: calculateHandValue(gameState.hands[p.name]) } : {player: p.name, score: Infinity});
            allPipCounts.sort((a, b) => a.score - b.score);
            if(allPipCounts.length > 0) gameState.lastWinner = allPipCounts[0].player;
        }
    } catch (error) { console.error("[SERVER] FATAL ERROR in endRound:", error); }

    const scoreA = gameState.teamScores.teamA;
    const scoreB = gameState.teamScores.teamB;

    if (scoreA >= POINTS_TO_WIN_MATCH || scoreB >= POINTS_TO_WIN_MATCH) {
        const winningTeamName = scoreA > scoreB ? 'Team A' : 'Team B';
        const winningTeamKey = scoreA > scoreB ? 'teamA' : 'teamB';
        const winningPlayers = gameState.teams[winningTeamKey];
        
        winningPlayers.forEach(playerName => {
            if (gameState.playerStats[playerName]) {
                gameState.playerStats[playerName].matchesWon++;
            }
        });
        
        matchOverMessage = `\n${winningTeamName} gana el match ${scoreA} a ${scoreB}!`;
        const savedPlayerStats = { ...gameState.playerStats };
        const nextMatchNumber = gameState.matchNumber + 1;
        gameState.teamScores = { teamA: 0, teamB: 0 };
        gameState.isFirstRoundOfMatch = true;
        gameState.matchNumber = nextMatchNumber;
        gameState.playerStats = savedPlayerStats;
    } else {
        gameState.isFirstRoundOfMatch = false;
    }

    gameState.gameInitialized = false;
    gameState.endRoundMessage = endMessage + matchOverMessage;
    gameState.readyPlayers.clear();
    broadcastGameState();
}

/**
 * (ROUTINE) Checks if the round should end after a move has been made.
 */
function checkRoundEnd() {
    if (!gameState.gameInitialized) return;
    const connectedPlayers = jugadores.filter(p => p.isConnected).map(p => p.name);
    const winner = connectedPlayers.find(p => gameState.hands[p] && gameState.hands[p].length === 0);
    if (winner) { return endRound({ winner }); }
    const canAnyPlayerMove = connectedPlayers.some(p => hasValidMove(p));
    if (!canAnyPlayerMove) { return endRound({ blocked: true }); }
    broadcastGameState();
}


// =============================================================================
// == SOCKET.IO CONNECTION & EVENT LISTENERS                                  ==
// =============================================================================

io.on('connection', (socket) => {
    // --- Handle New Player Connection ---
    const availableSlot = jugadores.find(p => !p.isConnected);
    if (!availableSlot) {
        socket.emit('gameError', { message: 'Game is full.' });
        socket.disconnect();
        return;
    }
    availableSlot.socketId = socket.id;
    availableSlot.isConnected = true;
    socket.jugadorName = availableSlot.name;
    socket.emit('playerAssigned', availableSlot.name);

    socket.on('setPlayerName', (name) => {
        const player = jugadores.find(p => p.socketId === socket.id);
        if (player) {
            player.assignedName = name.substring(0, 12) || player.name;
            broadcastGameState();
        }
    });

    const connectedCount = jugadores.filter(p => p.isConnected).length;
    if (connectedCount === 4 && !gameState.gameInitialized) {
        gameState = createNewGameState(jugadores);
        initializeRound();
    } else {
        broadcastGameState();
    }
    
    socket.on('placeTile', ({ tile, position }) => {
        const player = socket.jugadorName;
        if (!gameState.gameInitialized || gameState.currentTurn !== player) return;
        const hand = gameState.hands[player];
        
        const tileIndex = hand.findIndex(t => (t.left === tile.left && t.right === tile.right) || (t.left === tile.right && t.right === tile.left));
        if (tileIndex === -1) return;
        
        let validMove = false;
        let playedTileForHighlight = null; // NEW: Variable to store the tile for highlighting

        if (gameState.isFirstMove) {
            if (gameState.isFirstRoundOfMatch && (tile.left !== 6 || tile.right !== 6)) {
                return socket.emit('gameError', { message: 'First move must be 6|6!' });
            }
            const firstTile = hand[tileIndex];
            gameState.board.push(firstTile);
            gameState.leftEnd = firstTile.left;
            gameState.rightEnd = firstTile.right;
            gameState.spinnerTile = firstTile;
            playedTileForHighlight = firstTile;
            validMove = true;
            gameState.isFirstMove = false;
        } else {
            const playedTile = hand[tileIndex];
            if (position === 'left' && (playedTile.left === gameState.leftEnd || playedTile.right === gameState.leftEnd)) {
                const oriented = playedTile.right === gameState.leftEnd ? playedTile : { left: playedTile.right, right: playedTile.left };
                gameState.board.unshift(oriented);
                gameState.leftEnd = oriented.left;
                playedTileForHighlight = oriented;
                validMove = true;
            } else if (position === 'right' && (playedTile.left === gameState.rightEnd || playedTile.right === gameState.rightEnd)) {
                const oriented = playedTile.left === gameState.rightEnd ? playedTile : { left: playedTile.right, right: playedTile.left };
                gameState.board.push(oriented);
                gameState.rightEnd = oriented.right;
                playedTileForHighlight = oriented;
                validMove = true;
            }
        }
        if (validMove) {
            hand.splice(tileIndex, 1);
            gameState.lastPlayedTile = playedTileForHighlight; // NEW: Set the last played tile
            socket.emit('playerHand', gameState.hands[player]);
            socket.emit('moveSuccess');
            nextTurn();
            checkRoundEnd();
        } else {
            socket.emit('gameError', { message: 'Invalid move!' });
        }
    });

    socket.on('passTurn', () => {
        const player = socket.jugadorName;
        if (!gameState.gameInitialized || gameState.currentTurn !== player || hasValidMove(player)) return;
        nextTurn();
        checkRoundEnd();
    });

    socket.on('playerReadyForNewRound', () => {
        if (!socket.jugadorName) return;
        gameState.readyPlayers.add(socket.jugadorName);
        broadcastGameState();
        const connectedPlayers = jugadores.filter(p => p.isConnected);
        if (gameState.readyPlayers.size === connectedPlayers.length && connectedPlayers.length === 4) {
            gameState.readyPlayers.clear();
            initializeRound();
        }
    });

    socket.on('chatMessage', (msg) => {
        const player = jugadores.find(p => p.socketId === socket.id);
        if (player && msg) {
            io.emit('chatMessage', { sender: player.assignedName || player.name, message: msg.substring(0, 100) });
        }
    });

    socket.on('disconnect', () => {
        const playerSlot = jugadores.find(p => p.socketId === socket.id);
        if (playerSlot) {
            console.log(`${playerSlot.name} (${playerSlot.assignedName}) disconnected.`);
            playerSlot.socketId = null;
            playerSlot.isConnected = false;
            gameState = createNewGameState(jugadores);
            broadcastGameState();
        }
    });
});


// =============================================================================
// == START THE SERVER                                                        ==
// =============================================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[SERVER] Server listening on port ${PORT}`));
