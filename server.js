
// =============================================================================
// == server.js                                                               ==
// =============================================================================
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const analytics = require('./analytics');

const app = express();
// Endpoint to get active rooms and their player counts
app.get('/active-rooms', (req, res) => {
    const rooms = [];
    for (let [roomId, room] of gameRooms) {
        const connectedCount = room.jugadores.filter(p => p.isConnected).length;
        rooms.push({
            roomId,
            connectedCount
        });
    }
    res.json({ rooms });
});

// Analytics endpoints
app.get('/analytics-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'analytics-dashboard.html'));
});

app.get('/analytics', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const analyticsData = await analytics.getAnalyticsData(days);
        const quickStats = await analytics.getQuickStats();
        
        res.json({
            success: true,
            data: analyticsData,
            quickStats: quickStats
        });
    } catch (error) {
        console.error('Analytics endpoint error:', error);
        res.status(500).json({ success: false, error: 'Analytics unavailable' });
    }
});
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));

// =============================================================================
// == GLOBAL VARIABLES & GAME STATE MANAGEMENT                                ==
// =============================================================================

const POINTS_TO_WIN_MATCH = 20;

// Room management system for multiple simultaneous games
const gameRooms = new Map(); // roomId -> { jugadores, gameState, roomId }
let nextRoomId = 1;

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
 * (ROUTINE) Creates a new game room with fresh state
 */
function createGameRoom(roomId) {
    const jugadores = createJugadores();
    const gameState = createNewGameState();
    return {
        roomId,
        jugadores,
        gameState,
        targetScore: 70 // default, can be overwritten on join
    };
}

/**
 * (ROUTINE) Finds an available room or creates a new one
 * Prioritizes rooms where the player was previously connected
 */
function findOrCreateRoom(playerName = null) {
    // First, if a player name is provided, look for their previous room
    if (playerName) {
        for (let [roomId, room] of gameRooms) {
            const wasInThisRoom = room.jugadores.find(p => p.assignedName === playerName);
            if (wasInThisRoom) {
                const connectedCount = room.jugadores.filter(p => p.isConnected).length;
                if (connectedCount < 4) {
                    console.log(`[ROOM PRIORITY] ${playerName} returning to previous room: ${roomId}`);
                    return room;
                }
            }
        }
    }
    
    // Look for existing rooms with space
    for (let [roomId, room] of gameRooms) {
        const connectedCount = room.jugadores.filter(p => p.isConnected).length;
        if (connectedCount < 4) {
            return room;
        }
    }
    
    // Create new room if all are full
    const newRoomId = `Sala-${nextRoomId++}`;
    const newRoom = createGameRoom(newRoomId);
    gameRooms.set(newRoomId, newRoom);
    console.log(`[ROOM SYSTEM] Created new room: ${newRoomId}`);
    
    // Track room creation for analytics
    analytics.trackRoomCreated(newRoomId, 70).catch(err => 
        console.error('Analytics room creation error:', err)
    );
    
    return newRoom;
}

/**
 * (ROUTINE) Finds the room that contains a specific player by socketId
 */
function findPlayerRoom(socketId) {
    for (let [roomId, room] of gameRooms) {
        const player = room.jugadores.find(p => p.socketId === socketId);
        if (player) {
            return room;
        }
    }
    return null;
}

/**
 * (ROUTINE) Creates or resets the main game state object to its default values.
 */
function createNewGameState() {
    const initialStats = {
        "Jugador 1": { matchesWon: 0 },
        "Jugador 2": { matchesWon: 0 },
        "Jugador 3": { matchesWon: 0 },
        "Jugador 4": { matchesWon: 0 }
    };

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
        lastPlayedTile: null,
        matchOver: false, // Explicitly track match-over state
        endMatchMessage: null,
        seating: [], // Added to manage dynamic turn order
        isAfterTiedBlockedGame: false, // Flag for tied blocked game rule
        isTiedBlockedGame: false, // Flag for display messages
        gameBlocked: false // Flag to indicate blocked game state
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
 * (ROUTINE) Finds the player who has the double 6 tile.
 */
function findDouble6Holder(room) {
    const connectedPlayers = room.jugadores.filter(p => p.isConnected);
    for (let player of connectedPlayers) {
        const hand = room.gameState.hands[player.name];
        if (hand && hand.some(tile => tile.left === 6 && tile.right === 6)) {
            return player.name;
        }
    }
    return null;
}

/**
 * (ROUTINE) Broadcasts the current game state to ALL connected clients in a room.
 */
function broadcastGameState(room) {
    room.gameState.jugadoresInfo = room.jugadores.map(p => ({
        name: p.name,
        displayName: p.assignedName || p.name,
        isConnected: p.isConnected,
        tileCount: room.gameState.hands[p.name] ? room.gameState.hands[p.name].length : 0,
        avatar: p.avatar || { type: 'emoji', data: '👤' }
    }));
    const stateToSend = { ...room.gameState };
    stateToSend.readyPlayers = Array.from(room.gameState.readyPlayers);
    stateToSend.roomId = room.roomId; // Add room info
    stateToSend.targetScore = room.targetScore || 70; // Always include targetScore
    const { hands, ...finalState } = stateToSend;

    // Emit only to players in this room
    room.jugadores.forEach(player => {
        if (player.isConnected && player.socketId) {
            io.to(player.socketId).emit('gameState', finalState);
        }
    });
}

// =============================================================================
// == CORE GAME LOGIC FUNCTIONS                                               ==
// =============================================================================

/**
 * (ROUTINE) Deals 7 dominoes to each connected player.
 */
function dealHands(room) {
    let dominoesPool = generateDominoes();
    shuffleArray(dominoesPool);
    const connectedPlayers = room.jugadores.filter(p => p.isConnected);
    connectedPlayers.forEach(player => {
        room.gameState.hands[player.name] = dominoesPool.splice(0, 7);
        if (player.socketId) {
            io.to(player.socketId).emit('playerHand', room.gameState.hands[player.name]);
        }
    });
}

/**
 * (ROUTINE) Checks if a player has any valid moves in their hand.
 */
function hasValidMove(room, playerName) {
    const hand = room.gameState.hands[playerName];
    if (!hand) return false;
    if (room.gameState.isFirstMove) {
        if (room.gameState.isFirstRoundOfMatch) {
            // First round of match: must have double 6
            return hand.some(t => t.left === 6 && t.right === 6);
        } else if (room.gameState.isAfterTiedBlockedGame) {
            // After tied blocked game: player with double 6 can play any tile
            return hand.length > 0;
        } else {
            // Regular first move: any tile is valid
            return true;
        }
    }
    return hand.some(t => t.left === room.gameState.leftEnd || t.right === room.gameState.leftEnd || t.left === room.gameState.rightEnd || t.right === room.gameState.rightEnd);
}

/**
 * (ROUTINE) Advances the turn to the next player based on dynamic seating.
 */
function nextTurn(room) {
    if (!room.gameState.currentTurn || !room.gameState.seating || room.gameState.seating.length === 0) return;
    const currentIndex = room.gameState.seating.indexOf(room.gameState.currentTurn);
    if (currentIndex === -1) {
        console.error("Current player not in seating order!");
        return;
    }
    const nextIndex = (currentIndex + 1) % 4;
    room.gameState.currentTurn = room.gameState.seating[nextIndex];
}

/**
 * (ROUTINE) Initializes all state variables for a new round of play.
 */
function initializeRound(room) {
    room.gameState.gameInitialized = true;
    room.gameState.isFirstMove = true;
    room.gameState.board = [];
    room.gameState.leftEnd = null;
    room.gameState.rightEnd = null;
    room.gameState.spinnerTile = null;
    room.gameState.endRoundMessage = null;
    room.gameState.lastPlayedTile = null;
    room.gameState.matchOver = false;
    room.gameState.endMatchMessage = null;
    room.gameState.gameBlocked = false;
    room.gameState.isTiedBlockedGame = false;

    const playerNames = ["Jugador 1", "Jugador 2", "Jugador 3", "Jugador 4"];
    const rotation = (room.gameState.matchNumber - 1) % 3;
    if (rotation === 0) { // Match 1: (1,2) vs (3,4)
        room.gameState.teams.teamA = [playerNames[0], playerNames[1]];
        room.gameState.teams.teamB = [playerNames[2], playerNames[3]];
    } else if (rotation === 1) { // Match 2: (1,3) vs (2,4)
        room.gameState.teams.teamA = [playerNames[0], playerNames[2]];
        room.gameState.teams.teamB = [playerNames[1], playerNames[3]];
    } else { // Match 3: (1,4) vs (2,3)
        room.gameState.teams.teamA = [playerNames[0], playerNames[3]];
        room.gameState.teams.teamB = [playerNames[1], playerNames[2]];
    }

    // Set seating order for turns: [p1, p2, p1_partner, p2_partner]
    const teamA = room.gameState.teams.teamA;
    const teamB = room.gameState.teams.teamB;
    room.gameState.seating = [teamA[0], teamB[0], teamA[1], teamB[1]];

    dealHands(room);
    const connectedPlayerNames = room.jugadores.filter(p => p.isConnected).map(p => p.name);

    if (room.gameState.isFirstRoundOfMatch) {
        const startingPlayer = connectedPlayerNames.find(p => room.gameState.hands[p] && room.gameState.hands[p].some(t => t.left === 6 && t.right === 6));
        room.gameState.currentTurn = startingPlayer || "Jugador 1";
        room.gameState.isAfterTiedBlockedGame = false;
    } else if (room.gameState.isAfterTiedBlockedGame) {
        // After tied blocked game: find who has double 6
        const double6Holder = findDouble6Holder(room);
        room.gameState.currentTurn = double6Holder || room.gameState.lastWinner || room.gameState.seating[0] || "Jugador 1";
        console.log(`[TIE RULE] Double 6 holder ${room.gameState.currentTurn} starts the round and can play any tile.`);
    } else {
        room.gameState.currentTurn = room.gameState.lastWinner && connectedPlayerNames.includes(room.gameState.lastWinner) ? room.gameState.lastWinner : (room.gameState.seating[0] || "Jugador 1");
        room.gameState.isAfterTiedBlockedGame = false;
    }
    broadcastGameState(room);
}


/**
 * (ROUTINE) Ends the current round, calculates scores, and checks for a match winner.
 */
function endRound(room, outcome) {
    let endMessage = "Mano finalizada!";
    let matchOverMessage = "";

    try {
        if (outcome.winner) {
            const winner = outcome.winner;
            room.gameState.lastWinner = winner;
            const winnerTeam = room.gameState.teams.teamA.includes(winner) ? 'teamA' : 'teamB';
            const loserTeamKey = winnerTeam === 'teamA' ? 'teamB' : 'teamA';
            const points = room.gameState.teams[loserTeamKey].reduce((total, p) => total + calculateHandValue(room.gameState.hands[p]), 0);
            room.gameState.teamScores[winnerTeam] += points;
            const winnerDisplayName = room.gameState.jugadoresInfo.find(p => p.name === winner).displayName;
            endMessage = `${winnerDisplayName} domino! Equipo ${winnerTeam.slice(-1)} gana ${points} puntos!`;
            
            // Broadcast domino win bell sound to ALL players in room
            room.jugadores.forEach(player => {
                if (player.isConnected && player.socketId) {
                    io.to(player.socketId).emit('playerWonHand', { 
                        playerName: winner, 
                        displayName: winnerDisplayName,
                        points: points 
                    });
                }
            });
        } else if (outcome.blocked) {
            room.gameState.gameBlocked = true;
            const scoreA = room.gameState.teams.teamA.reduce((total, p) => total + calculateHandValue(room.gameState.hands[p]), 0);
            const scoreB = room.gameState.teams.teamB.reduce((total, p) => total + calculateHandValue(room.gameState.hands[p]), 0);

            if (scoreA !== scoreB) {
                const winningTeamKey = scoreA < scoreB ? 'teamA' : 'teamB';
                const points = scoreA < scoreB ? scoreB : scoreA;
                room.gameState.teamScores[winningTeamKey] += points;
                endMessage = `Juego Cerrado! Equipo ${winningTeamKey.slice(-1)} gana con menos puntos, gana ${points} puntos.`;
                // Determine next leader for blocked game
                const allPipCounts = room.jugadores
                    .filter(p => p.isConnected)
                    .map(p => ({ player: p.name, score: calculateHandValue(room.gameState.hands[p.name]) }))
                    .sort((a, b) => a.score - b.score);
                if(allPipCounts.length > 0) room.gameState.lastWinner = allPipCounts[0].player;
                room.gameState.isAfterTiedBlockedGame = false;
                room.gameState.isTiedBlockedGame = false;

            } else {
                // TIED BLOCKED GAME - Special rule implementation
                endMessage = `Juego Cerrado! Empate - nadie gana puntos.`;
                room.gameState.isTiedBlockedGame = true;
                room.gameState.isAfterTiedBlockedGame = true;
                
                // Find who has the double 6 for next round
                const double6Holder = findDouble6Holder(room);
                if (double6Holder) {
                    room.gameState.lastWinner = double6Holder;
                    const holderDisplayName = room.gameState.jugadoresInfo.find(p => p.name === double6Holder)?.displayName || double6Holder;
                    endMessage += `\nPróxima mano: ${holderDisplayName} (tiene doble 6) puede jugar cualquier ficha.`;
                } else {
                    // Fallback: lowest pip count starts
                    const allPipCounts = room.jugadores
                        .filter(p => p.isConnected)
                        .map(p => ({ player: p.name, score: calculateHandValue(room.gameState.hands[p.name]) }))
                        .sort((a, b) => a.score - b.score);
                    if(allPipCounts.length > 0) room.gameState.lastWinner = allPipCounts[0].player;
                    room.gameState.isAfterTiedBlockedGame = false;
                }
            }
        }
    } catch (error) { console.error("[SERVER] FATAL ERROR in endRound:", error); }

    const scoreA = room.gameState.teamScores.teamA;
    const scoreB = room.gameState.teamScores.teamB;

    const targetScore = room.targetScore || 70;
    if (scoreA >= targetScore || scoreB >= targetScore) {
        const winningTeamName = scoreA > scoreB ? 'Team A' : 'Team B';
        const winningTeamKey = scoreA > scoreB ? 'teamA' : 'teamB';
        const losingTeamScore = scoreA > scoreB ? scoreB : scoreA;
        
        // Implement shutout rule: 2 points if opposing team has 0 points, otherwise 1 point
        const matchPoints = losingTeamScore === 0 ? 2 : 1;
        
        room.gameState.teams[winningTeamKey].forEach(playerName => {
            if (room.gameState.playerStats[playerName]) {
                room.gameState.playerStats[playerName].matchesWon += matchPoints;
            }
        });
        
        const shutoutMessage = losingTeamScore === 0 ? ` (Zapato: +${matchPoints} puntos!)` : '';
        matchOverMessage = `\n${winningTeamName} gana el match ${scoreA} a ${scoreB}!${shutoutMessage}`;

        // DO NOT RESET STATE HERE. Wait for players to be ready.
        // Set flags to show the match over screen on the client.
        room.gameState.matchOver = true;
        room.gameState.endMatchMessage = matchOverMessage;
        room.gameState.endRoundMessage = endMessage + matchOverMessage;
        room.gameState.gameInitialized = false; 
        room.gameState.readyPlayers.clear();
        
        // Track match completion for analytics
        const matchStats = {
            duration: Date.now() - (room.gameCreatedAt || Date.now()),
            totalMoves: 0, // Could track this separately if needed
            playerCount: room.jugadores.filter(p => p.isConnected).length
        };
        analytics.trackGameEnd(room.roomId, winningTeamName, matchStats).catch(err =>
            console.error('Analytics game end error:', err)
        );
        
        broadcastGameState(room);
        return; // Stop further execution until players are ready.
    }

    // Standard end of round (not end of match)
    room.gameState.isFirstRoundOfMatch = false;
    room.gameState.matchOver = false;
    room.gameState.endMatchMessage = null;
    room.gameState.gameInitialized = false;
    room.gameState.endRoundMessage = endMessage;
    room.gameState.readyPlayers.clear();
    broadcastGameState(room);
}
/**
 * (ROUTINE) Checks if the round should end after a move has been made.
 */
function checkRoundEnd(room) {
    if (!room.gameState.gameInitialized) return;
    const connectedPlayers = room.jugadores.filter(p => p.isConnected).map(p => p.name);
    const winner = connectedPlayers.find(p => room.gameState.hands[p] && room.gameState.hands[p].length === 0);
    if (winner) { return endRound(room, { winner }); }
    const canAnyPlayerMove = connectedPlayers.some(p => hasValidMove(room, p));
    if (!canAnyPlayerMove) { return endRound(room, { blocked: true }); }
    broadcastGameState(room);
}


// =============================================================================
// == SOCKET.IO CONNECTION & EVENT LISTENERS (MODIFIED)                       ==
// =============================================================================

io.on('connection', (socket) => {

    socket.on('setPlayerName', async (data) => {
        console.log('🎯 Received setPlayerName data:', data);

        // Handle both old string format and new object format
        let displayName, avatarData, roomId, targetScore;

        if (typeof data === 'string') {
            displayName = data.trim().substring(0, 12);
            avatarData = { type: 'emoji', data: '👤' };
            roomId = null;
            targetScore = 70;
        } else if (data.avatar === null) {
            displayName = data.name.trim().substring(0, 12);
            avatarData = { type: 'file', data: displayName };
            roomId = data.roomId || null;
            targetScore = data.targetScore || 70;
        } else {
            displayName = data.name.trim().substring(0, 12);
            avatarData = data.avatar || { type: 'emoji', data: '👤' };
            roomId = data.roomId || null;
            targetScore = data.targetScore || 70;
        }

        console.log('🎯 Processed - Name:', displayName, 'Avatar:', avatarData, 'Room:', roomId, 'TargetScore:', targetScore);

        if (!displayName) return;

        // Try to reconnect to existing room first
        let reconnectedToRoom = null;
        for (let [rid, room] of gameRooms) {
            const reconnectingPlayer = room.jugadores.find(
                p => p.assignedName && p.assignedName.trim() === displayName && !p.isConnected
            );
            if (reconnectingPlayer) {
                reconnectingPlayer.socketId = socket.id;
                reconnectingPlayer.isConnected = true;
                if (typeof data === 'object' && data.avatar) {
                    reconnectingPlayer.avatar = data.avatar;
                    console.log(`[RECONNECT] ${displayName} reconnected to ${rid} with updated avatar ${data.avatar.type === 'emoji' ? data.avatar.data : 'custom'}.`);
                } else {
                    console.log(`[RECONNECT] ${displayName} reconnected to ${rid} with existing avatar ${reconnectingPlayer.avatar ? (reconnectingPlayer.avatar.type === 'emoji' ? reconnectingPlayer.avatar.data : 'custom') : 'default'}.`);
                }
                socket.jugadorName = reconnectingPlayer.name;
                socket.roomId = rid;
                socket.join(rid);
                socket.emit('playerAssigned', reconnectingPlayer.name);
                if (room.gameState.gameInitialized) {
                    const playerHand = room.gameState.hands[reconnectingPlayer.name];
                    io.to(socket.id).emit('playerHand', playerHand);
                }
                broadcastGameState(room);
                reconnectedToRoom = room;
                break;
            }
        }
        if (reconnectedToRoom) return;

        // Room selection logic: if roomId provided, use it or create it if missing
        let room = null;
        if (roomId) {
            if (!gameRooms.has(roomId)) {
                // Create new room with this id
                const newRoom = createGameRoom(roomId);
                gameRooms.set(roomId, newRoom);
                console.log(`[ROOM SYSTEM] Created new room by user: ${roomId}`);
            }
            room = gameRooms.get(roomId);
        } else {
            // Fallback to default logic
            room = findOrCreateRoom(displayName);
        }

        // Set the room's targetScore if provided (only if not already set or if this is a new room)
        // Only set targetScore if not already set (prevents last player from overwriting)
        if ((typeof room.targetScore !== 'number' || room.targetScore === 70) && typeof targetScore === 'number' && targetScore > 0) {
            room.targetScore = targetScore;
        }

        // Join the socket to the room (for socket.io room broadcasts)
        if (room && room.roomId) {
            socket.join(room.roomId);
        }

        // Check if name is already taken ONLY within this specific room
        const nameInUseInRoom = room.jugadores.find(p => p.isConnected && p.assignedName && p.assignedName.trim() === displayName);
        if (nameInUseInRoom) {
            socket.emit('gameError', { message: `Name "${displayName}" is already taken in this room. Please choose another.` });
            return;
        }

        const availableSlot = room.jugadores.find(p => !p.isConnected);
        if (availableSlot) {
            availableSlot.socketId = socket.id;
            availableSlot.isConnected = true;
            availableSlot.assignedName = displayName;
            availableSlot.avatar = avatarData;
            socket.jugadorName = availableSlot.name;
            socket.roomId = room.roomId;
            socket.join(room.roomId);
            socket.emit('playerAssigned', availableSlot.name);
            console.log(`[NEW PLAYER] ${displayName} connected as ${availableSlot.name} in ${room.roomId} with avatar ${avatarData.type === 'emoji' ? avatarData.data : 'custom'}.`);

            // Track player join for analytics
            await analytics.trackPlayerJoin(
                availableSlot.name,
                room.roomId,
                displayName,
                socket.request.headers['user-agent'] || 'Unknown'
            );

            const connectedCount = room.jugadores.filter(p => p.isConnected).length;
            if (connectedCount === 4 && !room.gameState.gameInitialized && !room.gameState.endRoundMessage && !room.gameState.matchOver) {
                initializeRound(room);
            } else {
                broadcastGameState(room);
            }
        } else {
            socket.emit('gameError', { message: 'Room is full. Looking for another room...' });
            socket.disconnect();
        }
    });
    
    socket.on('placeTile', async ({ tile, position }) => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        const player = socket.jugadorName;
        if (!room.gameState.gameInitialized || room.gameState.currentTurn !== player) return;
        const hand = room.gameState.hands[player];
        
        const tileIndex = hand.findIndex(t => (t.left === tile.left && t.right === tile.right) || (t.left === tile.right && t.right === tile.left));
        if (tileIndex === -1) return;
        
        let validMove = false;
        let playedTileForHighlight = null; 

        if (room.gameState.isFirstMove) {
            if (room.gameState.isFirstRoundOfMatch && (tile.left !== 6 || tile.right !== 6)) {
                return socket.emit('gameError', { message: 'Primera ficha debe ser 6|6!' });
            } else if (room.gameState.isAfterTiedBlockedGame) {
                // After tied blocked game: player with double 6 can play any tile
                console.log(`[TIE RULE] ${player} playing any tile after tied blocked game: ${tile.left}|${tile.right}`);
            }
            const firstTile = hand[tileIndex];
            room.gameState.board.push(firstTile);
            room.gameState.leftEnd = firstTile.left;
            room.gameState.rightEnd = firstTile.right;
            room.gameState.spinnerTile = firstTile;
            playedTileForHighlight = firstTile;
            validMove = true;
            room.gameState.isFirstMove = false;
            // Reset the tied blocked game flag after first move
            room.gameState.isAfterTiedBlockedGame = false;
        } else {
            const playedTile = hand[tileIndex];
            if (position === 'left' && (playedTile.left === room.gameState.leftEnd || playedTile.right === room.gameState.leftEnd)) {
                const oriented = playedTile.right === room.gameState.leftEnd ? playedTile : { left: playedTile.right, right: playedTile.left };
                room.gameState.board.unshift(oriented);
                room.gameState.leftEnd = oriented.left;
                playedTileForHighlight = oriented;
                validMove = true;
            } else if (position === 'right' && (playedTile.left === room.gameState.rightEnd || playedTile.right === room.gameState.rightEnd)) {
                const oriented = playedTile.left === room.gameState.rightEnd ? playedTile : { left: playedTile.right, right: playedTile.left };
                room.gameState.board.push(oriented);
                room.gameState.rightEnd = oriented.right;
                playedTileForHighlight = oriented;
                validMove = true;
            }
        }
        if (validMove) {
            hand.splice(tileIndex, 1);
            room.gameState.lastPlayedTile = playedTileForHighlight;
            socket.emit('playerHand', room.gameState.hands[player]);
            socket.emit('moveSuccess', { tile: playedTileForHighlight });
            
            // Broadcast tile placement sound to ALL players in room
            room.jugadores.forEach(p => {
                if (p.isConnected && p.socketId) {
                    io.to(p.socketId).emit('tilePlaced', { 
                        playerName: player, 
                        tile: playedTileForHighlight 
                    });
                }
            });
            
            // Track tile placement for analytics
            await analytics.trackTilePlaced(
                room.roomId,
                player,
                playedTileForHighlight,
                position
            );
            
            nextTurn(room);
            checkRoundEnd(room);
        } else {
            socket.emit('gameError', { message: 'Jugada inválida!' });
        }
    });

    socket.on('passTurn', () => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        const player = socket.jugadorName;
        if (!room.gameState.gameInitialized || room.gameState.currentTurn !== player || hasValidMove(room, player)) return;
        
        // Broadcast pass turn sound to ALL players in room
        room.jugadores.forEach(p => {
            if (p.isConnected && p.socketId) {
                io.to(p.socketId).emit('playerPassed', { 
                    playerName: player 
                });
            }
        });
        
        nextTurn(room);
        checkRoundEnd(room);
    });

    socket.on('playerReadyForNewRound', () => {
        const room = findPlayerRoom(socket.id);
        if (!room || !socket.jugadorName) return;
        
        room.gameState.readyPlayers.add(socket.jugadorName);
        broadcastGameState(room);

        const connectedPlayers = room.jugadores.filter(p => p.isConnected);
        if (room.gameState.readyPlayers.size === connectedPlayers.length && connectedPlayers.length === 4) { // Ensure 4 players are ready
            if (room.gameState.matchOver) {
                // --- RESET STATE FOR NEW MATCH ---
                const savedPlayerStats = { ...room.gameState.playerStats };
                const nextMatchNumber = room.gameState.matchNumber + 1;
                const lastWinnerOfMatch = room.gameState.lastWinner;

                const newGameState = createNewGameState();
                newGameState.playerStats = savedPlayerStats;
                newGameState.matchNumber = nextMatchNumber;
                newGameState.lastWinner = lastWinnerOfMatch;
                newGameState.isFirstRoundOfMatch = true; 
                room.gameState = newGameState;
            }

            room.gameState.readyPlayers.clear();
            initializeRound(room);
        }
    });

// Add this to your server.js socket event handlers
socket.on('voiceMessage', async (data) => {
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    
    // Track voice message for analytics
    await analytics.trackVoiceMessage(room.roomId, data.sender);
    
    // Broadcast voice message to all other players in room
    room.jugadores.forEach(p => {
        if (p.isConnected && p.socketId && p.socketId !== socket.id) {
            io.to(p.socketId).emit('voiceMessage', {
                audio: data.audio,
                sender: data.sender,
                timestamp: data.timestamp
            });
        }
    });
});

    socket.on('restartGame', () => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        const player = room.jugadores.find(p => p.socketId === socket.id);
        if (!player) return;

        console.log(`[RESTART GAME] ${player.assignedName || player.name} initiated game restart in ${room.roomId}.`);
        
        // Reset all game state while keeping connected players
        const connectedPlayers = room.jugadores.filter(p => p.isConnected);
        
        // Create fresh game state
        room.gameState = createNewGameState();
        
        // Preserve player connections but reset their assigned names
        connectedPlayers.forEach(p => {
            room.gameState.playerStats[p.name] = { matchesWon: 0 };
        });
        
        // Clear ready players
        room.gameState.readyPlayers.clear();
        
        // Broadcast restart message to room
        room.jugadores.forEach(p => {
            if (p.isConnected && p.socketId) {
                io.to(p.socketId).emit('gameRestarted', { 
                    message: `${player.assignedName || player.name} reinició el juego`,
                    restartedBy: player.assignedName || player.name
                });
            }
        });
        
        // Broadcast fresh game state
        broadcastGameState(room);
        
        // Start a new round if we have 4 players
        if (connectedPlayers.length === 4) {
            setTimeout(() => {
                initializeRound(room);
            }, 2000); // Give players 2 seconds to see the restart message
        }
    });

    socket.on('chatMessage', (msg) => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        const player = room.jugadores.find(p => p.socketId === socket.id);
        if (player && msg) {
            // Broadcast to all players in room
            room.jugadores.forEach(p => {
                if (p.isConnected && p.socketId) {
                    io.to(p.socketId).emit('chatMessage', { 
                        sender: player.assignedName || player.name, 
                        message: msg.substring(0, 100) 
                    });
                }
            });
        }
    });
    
    socket.on('disconnect', () => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        const playerSlot = room.jugadores.find(p => p.socketId === socket.id);
        if (playerSlot) {
            console.log(`[DISCONNECTED] ${playerSlot.name} (${playerSlot.assignedName}) from ${room.roomId}.`);
            playerSlot.socketId = null;
            playerSlot.isConnected = false;
            room.gameState.readyPlayers.delete(playerSlot.name);
            
            const connectedCount = room.jugadores.filter(p => p.isConnected).length;
            if (connectedCount < 4 && room.gameState.gameInitialized) {
                // If a player disconnects mid-game, pause or handle accordingly
                console.log(`[SERVER] A player disconnected mid-game in ${room.roomId}. Pausing.`);
                // For now, we just update clients. A more robust solution could pause the turn timer.
                broadcastGameState(room);
            } else if (connectedCount === 0) {
                console.log(`[SERVER] All players disconnected from ${room.roomId}. Removing room.`);
                gameRooms.delete(room.roomId);
            } else {
                broadcastGameState(room);
            }
        }
    });
});


// =============================================================================
// == START THE SERVER                                                        ==
// =============================================================================

// Add endpoint to save custom avatars as files
app.post('/save-avatar', express.json({ limit: '1mb' }), (req, res) => {
    const { playerName, avatarData } = req.body;
    
    if (!playerName || !avatarData) {
        return res.status(400).json({ error: 'Missing playerName or avatarData' });
    }
    
    // Extract the base64 image data
    const matches = avatarData.match(/^data:image\/([a-zA-Z]*);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        return res.status(400).json({ error: 'Invalid image data format' });
    }
    
    const imageType = matches[1]; // jpg, png, etc.
    const imageBuffer = Buffer.from(matches[2], 'base64');
    
    // Create the filename (always save as .jpg for consistency)
    const filename = `${playerName}_avatar.jpg`;
    const filepath = path.join(__dirname, 'assets', 'icons', filename);
    
    // Save the file
    fs.writeFile(filepath, imageBuffer, (err) => {
        if (err) {
            console.error('Error saving avatar file:', err);
            return res.status(500).json({ error: 'Failed to save avatar file' });
        }
        
        console.log(`✅ Avatar saved as file: ${filename}`);
        res.json({ success: true, filename: filename });
    });
});

// =============================================================================
// == ANALYTICS LOGGING                                                       ==
// =============================================================================

// Log daily stats every 24 hours
setInterval(async () => {
    try {
        const dailyStats = analytics.getDailySummary();
        console.log('📊 Daily Stats:', dailyStats);
    } catch (error) {
        console.error('Analytics daily stats error:', error);
    }
}, 24 * 60 * 60 * 1000); // Every 24 hours

// Log quick stats every hour
setInterval(async () => {
    try {
        const quickStats = await analytics.getQuickStats();
        console.log('📊 Hourly Update:', quickStats.today);
    } catch (error) {
        console.error('Analytics hourly stats error:', error);
    }
}, 60 * 60 * 1000); // Every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[SERVER] Server listening on port ${PORT}`));