// =============================================================================
// == FINAL LABELED client.js        7/31/2025                                         ==
// =============================================================================
// This file handles all client-side logic, including rendering the game with
// p5.js, communicating with the server via Socket.IO, and managing user input.
// =============================================================================


// Fetch and display available rooms in the sign-in page
function fetchAndShowRooms() {
  fetch('/active-rooms')
    .then(res => res.json())
    .then(data => {
      const container = document.getElementById('available-rooms');
      if (!container) return;
      if (!data.rooms || data.rooms.length === 0) {
        container.innerHTML = '<span style="color:#888;">No hay salas activas</span>';
        return;
      }
      container.innerHTML = '<b>Salas Disponibles:</b> ' + data.rooms.map(room => {
        const isFull = room.connectedCount >= 4;
        const roomLabel = room.roomId.replace(' ', '-');
        if (isFull) {
          return `<span class="room-chip room-full" data-room="${room.roomId}" style="background:#888;color:#fff;opacity:0.5;cursor:not-allowed;pointer-events:none;">${roomLabel} (Llena)</span>`;
        } else {
          return `<span class="room-chip" data-room="${room.roomId}">${roomLabel} (${room.connectedCount}/4)</span>`;
        }
      }).join(' ');
      // Add click handler to fill room input
      Array.from(container.getElementsByClassName('room-chip')).forEach(el => {
        if (!el.classList.contains('room-full')) {
          el.onclick = function() {
            const input = document.getElementById('room-input');
            if (input) input.value = this.getAttribute('data-room');
          };
        }
      });
    });
}
document.addEventListener('DOMContentLoaded', fetchAndShowRooms);


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
let avatarCache = {}; // Cache to prevent repeated avatar loading attempts
let dialogShownTimestamp = 0; // Prevent dialog from being hidden too quickly
let passSound; // Sound played when a player passes their turn
let winSound; // Sound played when a player wins the hand (domino)

// Voice chat variables
let mediaRecorder;
let audioChunks = [];
let isRecording = false;


// =============================================================================
// == P5.JS CORE FUNCTIONS (PRELOAD, SETUP, DRAW)                             ==
// =============================================================================

/**
 * (p5.js function) Preloads assets before the main setup.
 */
function preload() {
    soundFormats('mp3');
    tileSound = loadSound('assets/sounds/tile_place.mp3');
    passSound = loadSound('assets/sounds/pass_turn.mp3'); 
    winSound = loadSound('assets/sounds/win_bell.mp3');
    
    // Set volume levels (0.0 to 1.0, where 1.0 is maximum)
    if (passSound) passSound.setVolume(1.0); // Increase pass sound volume
    if (tileSound) tileSound.setVolume(0.6); // Optional: adjust tile sound
    if (winSound) winSound.setVolume(0.7);   // Optional: adjust win sound
}
/**
 * (p5.js function) Automatically called when the browser window is resized.
 */
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}
/**
 * (p5.js function) Runs once when the program starts.
 */
function setup() {
    const canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-container');
    
    // AGGRESSIVE: Hide new round container immediately on page load
    const newRoundContainer = document.getElementById('new-round-container');
    if (newRoundContainer) {
        newRoundContainer.style.display = 'none !important';
        newRoundContainer.style.visibility = 'hidden !important';
        newRoundContainer.style.opacity = '0';
        newRoundContainer.style.zIndex = '-9999';
    }
    
    setupLobby();
    setupButtonListeners();
}

/**
 * (p5.js function) The main rendering loop, runs continuously.
 */
function draw() {
    try {
        background(0, 100, 0);
        // (Removed points-objective update here; now handled by updateRoomInfo for compact legend)
        updateUI();
        updatePlayersUI();
        updateTeamInfo();
        updateRoomInfo();
        updateScoreboard();
        updateMatchesWon();
        if (gameState.board && gameState.board.length > 0) {
            drawBoard();
        }
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
 * Sets up the initial name-entry lobby screen with avatar selection.
 */
function setupLobby() {
    // Hide the room-points-legend if present (so it doesn't overlap the lobby)
    const legendDiv = document.getElementById('room-points-legend');
    if (legendDiv) legendDiv.style.display = 'none';
    const lobbyContainer = document.getElementById('lobby-container');
    const nameInput = document.getElementById('name-input');

    // (Old activeRoomsDiv and fetch logic removed)
    // SUPER AGGRESSIVE: Hide all possible dialog containers
    const elementsToHide = [
        'new-round-container',
        'round-over-message', 
        'newRoundBtn'
    ];
    
    elementsToHide.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.style.display = 'none !important';
            element.style.visibility = 'hidden !important';
            element.style.opacity = '0';
            element.style.zIndex = '-9999';
            element.style.pointerEvents = 'none';
        }
    });
    
    // (already declared above)
    const setNameBtn = document.getElementById('set-name-btn');
    const avatarOptions = document.querySelectorAll('.avatar-option');
    const avatarUpload = document.getElementById('avatar-upload');
    const customAvatarPreview = document.getElementById('custom-avatar-preview');
    // Room selection input (add this to your HTML if not present)
    let roomInput = document.getElementById('room-input');
    if (!roomInput) {
        // Dynamically add if missing (for backward compatibility)
        roomInput = document.createElement('input');
        roomInput.type = 'text';
        roomInput.id = 'room-input';
        roomInput.placeholder = 'Sala nombre (opcional)';
        roomInput.style.marginTop = '10px';
        roomInput.style.width = '56%'; // 30% less than 80%
        roomInput.style.minWidth = '180px';
        // Only insertBefore if setNameBtn is a child of lobbyContainer
        if (setNameBtn && setNameBtn.parentNode === lobbyContainer) {
            lobbyContainer.insertBefore(roomInput, setNameBtn);
        } else {
            lobbyContainer.appendChild(roomInput);
        }
    } else {
        roomInput.placeholder = 'Sala nombre (opcional)';
        roomInput.style.width = '56%';
        roomInput.style.minWidth = '190px';
    }
    
    // ALWAYS start with empty name field (don't auto-fill old names)
    nameInput.value = '';
    nameInput.defaultValue = '';
    nameInput.setAttribute('value', '');
    console.log('✅ Cleared name input field');
    
    // Force clear any cached form data multiple times
    setTimeout(() => {
        nameInput.value = '';
        nameInput.defaultValue = '';
        nameInput.setAttribute('value', '');
        console.log('✅ Double-cleared name input field');
    }, 100);
    
    setTimeout(() => {
        nameInput.value = '';
        nameInput.defaultValue = '';
        nameInput.setAttribute('value', '');
        console.log('✅ Triple-cleared name input field');
    }, 300);
    
    // Load saved avatar from localStorage (but NOT the name - keep it empty)
    const savedAvatar = localStorage.getItem('domino_player_avatar');
    
    let selectedAvatar = '🎯'; // Default avatar (target emoji)
    let customAvatarData = null;
    
    // Don't restore saved name - always start fresh
    // if (savedName) {
    //     nameInput.value = savedName;
    // }
    
    // Reset all avatar selections first
    avatarOptions.forEach(opt => opt.classList.remove('selected'));
    customAvatarPreview.style.display = 'none';
    
    // PRIORITY 1: Check if user has an avatar file with their name first
    const currentName = nameInput.value.trim();
    if (currentName) {
        // Try to find avatar file for this user
        const testImg = new Image();
        const avatarFilePath = `assets/icons/${currentName}_avatar.jpg`;
        
        testImg.onload = function() {
            console.log('✅ Found avatar file for', currentName);
            // Don't use localStorage - user has their own avatar file
            selectedAvatar = null;
            customAvatarData = null;
            // The getPlayerIcon function will handle this
        };
        
        testImg.onerror = function() {
            console.log('ℹ️ No avatar file found for', currentName, ', using localStorage or default');
            // PRIORITY 2: Restore saved avatar from localStorage
            if (savedAvatar) {
                try {
                    const avatarData = JSON.parse(savedAvatar);
                    if (avatarData.type === 'custom') {
                        customAvatarData = avatarData.data;
                        selectedAvatar = null;
                        // Show preview
                        customAvatarPreview.innerHTML = `<img src="${customAvatarData}" alt="Custom Avatar">`;
                        customAvatarPreview.style.display = 'block';
                        console.log('Restored custom avatar from localStorage');
                    } else {
                        selectedAvatar = avatarData.data;
                        customAvatarData = null;
                        // Select the correct emoji option
                        avatarOptions.forEach(opt => {
                            if (opt.dataset.avatar === selectedAvatar) {
                                opt.classList.add('selected');
                            }
                        });
                        console.log('Restored emoji avatar from localStorage:', selectedAvatar);
                    }
                } catch (e) {
                    console.log('Could not restore saved avatar, using default');
                    useDefaultAvatar();
                }
            } else {
                useDefaultAvatar();
            }
        };
        
        testImg.src = avatarFilePath;
    } else {
        // No name entered yet, use localStorage or default
        if (savedAvatar) {
            try {
                const avatarData = JSON.parse(savedAvatar);
                if (avatarData.type === 'custom') {
                    customAvatarData = avatarData.data;
                    selectedAvatar = null;
                    customAvatarPreview.innerHTML = `<img src="${customAvatarData}" alt="Custom Avatar">`;
                    customAvatarPreview.style.display = 'block';
                    console.log('Restored custom avatar from localStorage');
                } else {
                    selectedAvatar = avatarData.data;
                    customAvatarData = null;
                    avatarOptions.forEach(opt => {
                        if (opt.dataset.avatar === selectedAvatar) {
                            opt.classList.add('selected');
                        }
                    });
                    console.log('Restored emoji avatar from localStorage:', selectedAvatar);
                }
            } catch (e) {
                console.log('Could not restore saved avatar, using default');
                useDefaultAvatar();
            }
        } else {
            useDefaultAvatar();
        }
    }
    
    function useDefaultAvatar() {
        // No saved avatar - select default target emoji
        const defaultOption = document.querySelector('[data-avatar="🎯"]');
        if (defaultOption) {
            defaultOption.classList.add('selected');
            console.log('Set default target emoji avatar');
        }
    }
    
    nameInput.focus(); 
    
    // Handle avatar selection from grid
    avatarOptions.forEach(option => {
        option.addEventListener('click', () => {
            console.log('Avatar option clicked:', option.dataset.avatar);
            // Remove selected class from all options
            avatarOptions.forEach(opt => opt.classList.remove('selected'));
            // Add selected class to clicked option
            option.classList.add('selected');
            // Update selected avatar
            selectedAvatar = option.dataset.avatar;
            customAvatarData = null; // Clear custom avatar if emoji selected
            customAvatarPreview.style.display = 'none';
            console.log('✅ Avatar updated to:', selectedAvatar);
            
            // Save to localStorage
            localStorage.setItem('domino_player_avatar', JSON.stringify({
                type: 'emoji',
                data: selectedAvatar
            }));
            console.log('✅ Avatar saved to localStorage');
        });
    });
    
    // Handle custom avatar upload
    avatarUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file && file.type.startsWith('image/')) {
            // Check file size (limit to 500KB)
            if (file.size > 500 * 1024) {
                alert('Image too large! Please choose an image smaller than 500KB.');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = (e) => {
                // Create an image element to compress the image
                const img = new Image();
                img.onload = () => {
                    // Create canvas for compression
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    // Set maximum dimensions (keep it small for Socket.IO)
                    const maxSize = 64; // 64x64 pixels maximum
                    let { width, height } = img;
                    
                    // Calculate new dimensions maintaining aspect ratio
                    if (width > height) {
                        if (width > maxSize) {
                            height = (height * maxSize) / width;
                            width = maxSize;
                        }
                    } else {
                        if (height > maxSize) {
                            width = (width * maxSize) / height;
                            height = maxSize;
                        }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    
                    // Draw and compress the image
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Convert to compressed data URL (JPEG with 70% quality)
                    customAvatarData = canvas.toDataURL('image/jpeg', 0.7);
                    selectedAvatar = null; // Clear emoji selection
                    
                    // Remove selected class from all emoji options
                    avatarOptions.forEach(opt => opt.classList.remove('selected'));
                    
                    // Show preview
                    customAvatarPreview.innerHTML = `<img src="${customAvatarData}" alt="Custom Avatar">`;
                    customAvatarPreview.style.display = 'block';
                    console.log('Custom avatar uploaded and compressed');
                    
                    // Save to localStorage
                    localStorage.setItem('domino_player_avatar', JSON.stringify({
                        type: 'custom',
                        data: customAvatarData
                    }));
                    
                    // NEW: Also save as file for permanent storage
                    const currentPlayerName = nameInput.value.trim();
                    if (currentPlayerName) {
                        saveAvatarAsFile(currentPlayerName, customAvatarData);
                    } else {
                        // Show message to encourage entering name for permanent save
                        const statusDiv = document.getElementById('profile-status');
                        if (statusDiv) {
                            statusDiv.innerHTML = '💡 Enter your name to save avatar permanently!';
                            statusDiv.style.color = 'orange';
                            statusDiv.style.fontWeight = 'bold';
                        }
                        console.log('⚠️ Enter name to save avatar as permanent file');
                    }
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Function to handle name submission
    const submitName = () => {
        const name = nameInput.value.trim();
        const roomId = roomInput.value.trim();
        const targetScoreSelect = document.getElementById('target-score');
        const targetScore = targetScoreSelect ? parseInt(targetScoreSelect.value, 10) : 70;
        if (name) {
            // Hide lobby and show game UI immediately
            const lobby = document.getElementById('lobby-container');
            const gameUI = document.getElementById('game-ui');
            if (lobby) lobby.style.display = 'none';
            if (gameUI) gameUI.style.display = 'block';

            // Don't save name to localStorage - keep it fresh each session
            // localStorage.setItem('domino_player_name', name);
            // ALWAYS check for avatar file FIRST - highest priority
            const testImg = new Image();
            const avatarFilePath = `assets/icons/${name}_avatar.jpg`;
            testImg.onload = function() {
                console.log('🎯 PRIORITY 1: Found avatar file for', name, '- using file (ignoring localStorage)');
                connectToServer(name, null, roomId, targetScore); 
            };
            testImg.onerror = function() {
                console.log('ℹ️ No avatar file for', name, '- checking localStorage and selections');
                // PRIORITY 2: Use selected avatar (custom upload or emoji)
                const avatarData = {
                    type: customAvatarData ? 'custom' : 'emoji',
                    data: customAvatarData || selectedAvatar
                };
                console.log('PRIORITY 2: Using selected avatar:', avatarData);
                connectToServer(name, avatarData, roomId, targetScore); 
            };
            // Always test for the file first
            testImg.src = avatarFilePath;
        }
    };
    
    // Handle button click
    setNameBtn.addEventListener('click', submitName);
    
    // Handle clear profile button
    const clearProfileBtn = document.getElementById('clear-profile-btn');
    if (clearProfileBtn) {
        clearProfileBtn.addEventListener('click', () => {
            // Clear localStorage
            localStorage.removeItem('domino_player_name');
            localStorage.removeItem('domino_player_avatar');
            
            // Reset form
            nameInput.value = '';
            customAvatarData = null;
            selectedAvatar = '🎯';
            customAvatarPreview.style.display = 'none';
            
            // Reset avatar selection to default
            avatarOptions.forEach(opt => opt.classList.remove('selected'));
            const defaultOption = document.querySelector('[data-avatar="🎯"]');
            if (defaultOption) {
                defaultOption.classList.add('selected');
            }
            
            // Hide status message
            const profileStatus = document.getElementById('profile-status');
            if (profileStatus) {
                profileStatus.style.display = 'none';
            }
            
            console.log('Profile cleared - large avatar data removed');
            nameInput.focus();
        });
    }
    
    // Add emergency function to clear large avatar data
    window.clearLargeAvatarData = () => {
        localStorage.removeItem('domino_player_avatar');
        console.log('Large avatar data cleared from localStorage');
        location.reload();
    };
    
    // Function to save avatar as permanent file
    function saveAvatarAsFile(playerName, avatarData) {
        fetch('/save-avatar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                playerName: playerName,
                avatarData: avatarData
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('✅ Avatar saved as permanent file:', data.filename);
                
                // Show success message to user
                const statusDiv = document.getElementById('profile-status');
                if (statusDiv) {
                    statusDiv.innerHTML = `✅ Avatar saved permanently as ${data.filename}`;
                    statusDiv.style.color = 'green';
                    statusDiv.style.fontWeight = 'bold';
                }
                
                // Clear localStorage since we now have a file
                localStorage.removeItem('domino_player_avatar');
                console.log('🗑️ Cleared localStorage - using file instead');
            } else {
                console.error('❌ Failed to save avatar file:', data.error);
            }
        })
        .catch(error => {
            console.error('❌ Error saving avatar file:', error);
        });
    }
    
    // Handle Enter key press
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            submitName();
        }
    });
    
    // Auto-save custom avatar as file when name is entered
    nameInput.addEventListener('input', () => {
        const currentName = nameInput.value.trim();
        if (currentName.length >= 2 && customAvatarData) {
            saveAvatarAsFile(currentName, customAvatarData);
        }
    });
}

/**
 * Establishes the connection to the server via Socket.IO and sets up listeners.
 */
function connectToServer(playerName, avatarData, roomId) {
    let targetScore = 70;
    // Try to get targetScore from arguments (if passed)
    if (arguments.length > 3 && arguments[3]) {
        targetScore = arguments[3];
    } else {
        const targetScoreSelect = document.getElementById('target-score');
        if (targetScoreSelect) {
            targetScore = parseInt(targetScoreSelect.value, 10) || 70;
        }
    }
    socket = io();

    socket.on('connect', () => {
        console.log("Connected to server.");
        socket.emit('setPlayerName', { name: playerName, avatar: avatarData, roomId: roomId, targetScore: targetScore });

        // Hide lobby and show game UI when connected
        const lobby = document.getElementById('lobby-container');
        const gameUI = document.getElementById('game-ui');
        if (lobby) lobby.style.display = 'none';
        if (gameUI) gameUI.style.display = 'block';
    });

    socket.on('playerAssigned', (name) => { myJugadorName = name; });

    socket.on('gameState', (state) => {
        gameState = state;
        // (Removed points-objective update here; now handled by updateRoomInfo for compact legend)
        const newRoundContainer = document.getElementById('new-round-container');
        if (!newRoundContainer) return;
        // TRIPLE CHECK: Only show round dialogs if we have a player assigned AND are connected
        if (!myJugadorName || !socket || !socket.connected) {
            // Force hide with multiple methods
            newRoundContainer.style.display = 'none !important';
            newRoundContainer.style.visibility = 'hidden !important';
            newRoundContainer.style.opacity = '0';
            newRoundContainer.style.zIndex = '-9999';
            return;
        }
        // ...existing code for dialog logic...
        let isClientDetectedBlock = false;
        if (gameState.jugadoresInfo && gameState.jugadoresInfo.length > 0 && !gameState.gameInitialized) {
            const playersWithTiles = gameState.jugadoresInfo.filter(player => player.tileCount > 0);
            const playersWithNoTiles = gameState.jugadoresInfo.filter(player => player.tileCount === 0);
            const hasWinMessage = gameState.endRoundMessage && gameState.endRoundMessage.toLowerCase().includes('domino');
            const hasBlockedMessage = gameState.endRoundMessage && gameState.endRoundMessage.toLowerCase().includes('juego cerrado');
            if (hasBlockedMessage) {
                isClientDetectedBlock = true;
            } else if (playersWithTiles.length > 1 && playersWithNoTiles.length === 0 && !hasWinMessage) {
                isClientDetectedBlock = true;
            }
        }
        const shouldShowDialog = (
            (!gameState.gameInitialized && (
                !!gameState.endRoundMessage || 
                !!gameState.endMatchMessage ||
                !!gameState.matchOver || 
                !!gameState.roundOver ||
                !!gameState.gameOver ||
                isClientDetectedBlock
            )) ||
            !!gameState.gameBlocked
        );
        if (shouldShowDialog) {
            const roundOverMessageDiv = document.getElementById('round-over-message');
            const newRoundBtn = document.getElementById('newRoundBtn');
            if (!roundOverMessageDiv || !newRoundBtn) return;
            let message = "Mano Finalizada";
            if (gameState.gameBlocked) {
                message = "Juego cerrado ! Nadie puede jugar!";
                if (gameState.endRoundMessage) {
                    message = gameState.endRoundMessage + "\n(Juego cerrado)";
                }
                if (gameState.isTiedBlockedGame) {
                    message += "\n¡Empate! El próximo juego lo inicia quien tenga el doble 6";
                }
            } else if (gameState.endRoundMessage && gameState.jugadoresInfo) {
                const playersWithTiles = gameState.jugadoresInfo.filter(player => player.tileCount > 0);
                const playersWithNoTiles = gameState.jugadoresInfo.filter(player => player.tileCount === 0);
                const hasWinMessage = gameState.endRoundMessage.toLowerCase().includes('domino');
                const hasBlockedMessage = gameState.endRoundMessage.toLowerCase().includes('juego cerrado');
                if (hasBlockedMessage || (playersWithTiles.length > 1 && playersWithNoTiles.length === 0 && !hasWinMessage)) {
                    message = gameState.endRoundMessage;
                    if (gameState.isTiedBlockedGame) {
                        message += "\n¡Empate! El próximo juego lo inicia quien tenga el doble 6";
                    }
                } else {
                    message = gameState.endRoundMessage;
                }
            } else if (isClientDetectedBlock) {
                const playersWithTiles = gameState.jugadoresInfo.filter(player => player.tileCount > 0);
                message = `Juego Cerrado!\nNo quedan jugadas validas\nPlayers with tiles: ${playersWithTiles.map(p => `${p.displayName}(${p.tileCount})`).join(', ')}`;
            } else if (gameState.endRoundMessage && gameState.endMatchMessage) {
                message = gameState.endRoundMessage + "\n" + gameState.endMatchMessage;
            } else if (gameState.endMatchMessage) {
                message = gameState.endMatchMessage;
            } else if (gameState.endRoundMessage) {
                message = gameState.endRoundMessage;
            } else if (gameState.gameOver) {
                message = "Game Over";
            } else if (gameState.roundOver) {
                message = "Round Over";
            }
            roundOverMessageDiv.innerText = message;
            roundOverMessageDiv.style.setProperty('display', 'block', 'important');
            roundOverMessageDiv.style.setProperty('visibility', 'visible', 'important');
            roundOverMessageDiv.style.setProperty('opacity', '1', 'important');
            roundOverMessageDiv.style.setProperty('color', 'white', 'important');
            roundOverMessageDiv.style.setProperty('font-size', '16px', 'important');
            roundOverMessageDiv.style.setProperty('text-align', 'center', 'important');
            roundOverMessageDiv.style.setProperty('padding', '20px', 'important');
            newRoundContainer.style.setProperty('display', 'block', 'important');
            newRoundContainer.style.setProperty('visibility', 'visible', 'important');
            newRoundContainer.style.setProperty('opacity', '1', 'important');
            newRoundContainer.style.setProperty('z-index', '9999', 'important');
            newRoundContainer.style.setProperty('position', 'fixed', 'important');
            newRoundContainer.style.setProperty('pointer-events', 'auto', 'important');
            const body = document.body;
            const html = document.documentElement;
            body.style.setProperty('overflow', 'hidden', 'important');
            html.style.setProperty('overflow', 'hidden', 'important');
            const amIReady = gameState.readyPlayers && gameState.readyPlayers.includes(myJugadorName);
            newRoundBtn.disabled = amIReady;
            newRoundBtn.innerText = amIReady ? 'Esperando por los demas...' : (gameState.matchOver ? 'Jugar Match Nuevo' : 'Empezar Mano Nueva');
            newRoundBtn.style.setProperty('display', 'block', 'important');
            newRoundBtn.style.setProperty('visibility', 'visible', 'important');
            newRoundBtn.style.setProperty('opacity', '1', 'important');
            newRoundBtn.style.setProperty('pointer-events', 'auto', 'important');
            if (dialogShownTimestamp === 0) {
                dialogShownTimestamp = Date.now();
            }
        } else {
            const timeSinceShown = Date.now() - dialogShownTimestamp;
            const gameHasRestarted = gameState.gameInitialized && gameState.board && gameState.board.length > 0;
            const allPlayersReady = gameState.readyPlayers && gameState.jugadoresInfo && 
                gameState.readyPlayers.length === gameState.jugadoresInfo.length;
            if (timeSinceShown < 3000 && dialogShownTimestamp > 0 && !gameHasRestarted && !allPlayersReady) {
                return;
            }
            newRoundContainer.style.display = 'none';
            newRoundContainer.style.visibility = 'hidden';
            newRoundContainer.style.opacity = '0';
            dialogShownTimestamp = 0;
        }
    });

    socket.on('playerHand', (hand) => {
        myPlayerHand = hand || [];
    });

    socket.on('gameError', (data) => showMessage(data.message));

    socket.on('moveSuccess', (data) => {
        selectedTileIndex = null;
        if (data && data.tile) {
            lastPlayedHighlight.tile = data.tile;
            lastPlayedHighlight.timestamp = millis();
        }
    });

    socket.on('tilePlaced', (data) => {
        if (tileSound && tileSound.isLoaded()) {
            tileSound.play();
        }
    });

    socket.on('playerPassed', (data) => {
        if (passSound && passSound.isLoaded()) {
            passSound.play();
        }
    });

    socket.on('playerWonHand', (data) => {
        if (winSound && winSound.isLoaded()) {
            winSound.play();
        }
    });

    socket.on('gameRestarted', (data) => {
        myPlayerHand = [];
        selectedTileIndex = null;
        messageDisplay = { text: '', time: 0 };
        showMessage(`🔄 ${data.message}`);
        const messagesDiv = document.getElementById('chat-messages');
        const messageElement = document.createElement('p');
        messageElement.innerHTML = `<b>SISTEMA:</b> 🔄 Juego reiniciado por ${data.restartedBy}`;
        messageElement.style.color = '#ffaa00';
        messageElement.style.fontWeight = 'bold';
        messagesDiv.appendChild(messageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
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

    socket.on('voiceMessage', (data) => {
        playVoiceMessage(data);
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
            showMessage('Tiene jugada valida, no puede pasar!');
        } else {
            socket.emit('passTurn');
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

    // Restart game button
    const restartGameBtn = document.getElementById('restart-game-btn');
    if (restartGameBtn) {
        restartGameBtn.addEventListener('click', () => {
            if (confirm('¿Estás seguro de que quieres reiniciar el juego completamente? Esto borrará todos los puntajes y estadísticas.')) {
                socket.emit('restartGame');
            }
        });
    }

    // Voice chat button (Push to Talk)
    const voiceChatBtn = document.getElementById('voice-chat-btn');
    if (voiceChatBtn) {
        // Mouse events
        voiceChatBtn.addEventListener('mousedown', startVoiceRecording);
        voiceChatBtn.addEventListener('mouseup', stopVoiceRecording);
        voiceChatBtn.addEventListener('mouseleave', stopVoiceRecording);
        
        // Touch events for mobile
        voiceChatBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startVoiceRecording();
        });
        voiceChatBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            stopVoiceRecording();
        });
    }
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
        
        // Show special message for first move after tied blocked game
        if (gameState.isFirstMove && gameState.isAfterTiedBlockedGame) {
            showMessage('Tu turno! Puedes jugar cualquier ficha (tienes el doble 6)');
        }
    }
}

function showMessage(text) {
    messageDisplay = { text, time: millis() };
}

function getPlayerIcon(imgElement, displayName, internalPlayerName) {
    if (!internalPlayerName) return; 
    
    // Create a unique key for this player
    const playerKey = `${displayName}_${internalPlayerName}`;
    
    // If we've already processed this player, use the cached result
    if (avatarCache[playerKey]) {
        if (avatarCache[playerKey].src) {
            imgElement.src = avatarCache[playerKey].src;
            imgElement.style.display = 'block';
        } else {
            imgElement.style.display = 'none';
        }
        return;
    }
    
    // Initialize cache entry
    avatarCache[playerKey] = { src: null, processed: false, attemptIndex: 0 };
    
    // Create multiple filename variations to try
    const avatarVariations = [
        `assets/icons/${displayName}_avatar.jpg`,           // Original case
        `assets/icons/${displayName.toLowerCase()}_avatar.jpg`, // All lowercase
        `assets/icons/${displayName.toUpperCase()}_avatar.jpg`, // All uppercase
        `assets/icons/${displayName.charAt(0).toUpperCase() + displayName.slice(1).toLowerCase()}_avatar.jpg` // Title case
    ];
    
    const match = internalPlayerName.match(/\d+/);
    const playerNumber = match ? match[0] : 'default';
    const defaultAvatarSrc = `assets/icons/jugador${playerNumber}_avatar.jpg`;
    
    // Function to try the next avatar variation
    const tryNextAvatar = () => {
        const currentAttempt = avatarCache[playerKey].attemptIndex;
        
        if (currentAttempt < avatarVariations.length) {
            avatarCache[playerKey].attemptIndex++;
            imgElement.src = avatarVariations[currentAttempt];
        } else {
            // All custom variations failed, try default
            imgElement.src = defaultAvatarSrc;
        }
    };
    
    // Set up error handling before setting the source
    imgElement.onerror = function() {
        const currentAttempt = avatarCache[playerKey].attemptIndex - 1;
        
        // If we're still trying custom avatar variations
        if (currentAttempt < avatarVariations.length - 1) {
            tryNextAvatar();
        } else if (this.src === defaultAvatarSrc) {
            // Even default failed, cache the failure and hide the image
            avatarCache[playerKey].src = null;
            avatarCache[playerKey].processed = true;
            this.style.display = 'none';
            this.onerror = null;
        } else {
            // Try default avatar
            this.src = defaultAvatarSrc;
        }
    };
    
    imgElement.onload = function() {
        // Cache the successful source
        avatarCache[playerKey].src = this.src;
        avatarCache[playerKey].processed = true;
        this.style.display = 'block';
        this.onload = null;
    };
    
    // Start with the first variation
    tryNextAvatar();
}

/**
 * Determines player UI positions dynamically based on teams and turn order.
 * You are always 'bottom', your partner is 'top'.
 */
function determinePlayerPositions() {
    if (!myJugadorName || !gameState.teams || !gameState.teams.teamA || !gameState.seating || gameState.seating.length < 4) {
        return {};
    }

    const { teams, seating } = gameState;
    
    // Find my team and opponent team
    let myTeam, opponentTeam;
    if (teams.teamA.includes(myJugadorName)) {
        myTeam = teams.teamA;
        opponentTeam = teams.teamB;
    } else if (teams.teamB.includes(myJugadorName)) {
        myTeam = teams.teamB;
        opponentTeam = teams.teamA;
    } else {
        return {}; // I'm not in a team
    }

    // Find my partner
    const partner = myTeam.find(p => p !== myJugadorName);

    // Determine left and right opponents from the clockwise seating order
    const mySeatingIndex = seating.indexOf(myJugadorName);
    if (mySeatingIndex === -1) return {};

    const rightOpponent = seating[(mySeatingIndex + 1) % 4];
    const leftOpponent = seating[(mySeatingIndex + 3) % 4];

    // Create the position mapping
    const positions = {
        [myJugadorName]: 'bottom',
        [partner]: 'top',
        [rightOpponent]: 'right',
        [leftOpponent]: 'left'
    };
    
    // Validate that opponents are correct
    if (!opponentTeam.includes(rightOpponent) || !opponentTeam.includes(leftOpponent)) {
       // This can happen briefly during team rotation, return an empty object to avoid errors.
       return {};
    }

    return positions;
}


function updatePlayersUI() {
    if (!gameState || !gameState.jugadoresInfo || !myJugadorName) { return; }

    console.log('🎮 Updating players UI with game state:', gameState.jugadoresInfo);

    const playerPositions = determinePlayerPositions();

    // Hide all displays initially
    ['top', 'bottom', 'left', 'right'].forEach(pos => {
        const div = document.getElementById(`player-display-${pos}`);
        if (div) div.style.display = 'none';
    });

    if (Object.keys(playerPositions).length < 4) return;

    Object.entries(playerPositions).forEach(([playerName, position]) => {
        const div = document.getElementById(`player-display-${position}`);
        if (!div) return;

        const playerData = gameState.jugadoresInfo.find(p => p.name === playerName);
        if (!playerData) return;

        console.log('🎯 Player data for', playerName, ':', playerData);

        div.style.display = 'flex';
        div.innerHTML = ''; 

        // Create avatar element
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'player-avatar';
        
        // PRIORITY SYSTEM for avatar display:
        // 1st: Avatar files (type='file' or when no avatar data but file exists)
        // 2nd: Custom uploads (type='custom') 
        // 3rd: Selected emojis (type='emoji')
        // 4th: Default avatar
        
        if (playerData.avatar && playerData.avatar.type === 'file') {
            // Server indicated to use file - try to load image file
            const img = document.createElement('img');
            img.style.display = 'none';
            avatarDiv.appendChild(img);
            
            getPlayerIcon(img, playerData.displayName, playerData.name);
            
            setTimeout(() => {
                if (img.style.display === 'none') {
                    // File failed to load, use default
                    avatarDiv.textContent = '👤';
                    console.log('⚠️ Avatar file failed to load for', playerData.displayName);
                } else {
                    console.log('✅ Using avatar FILE for', playerData.displayName);
                }
            }, 500);
        } else if (playerData.avatar && playerData.avatar.type === 'custom') {
            // Custom uploaded avatar
            avatarDiv.classList.add('custom-avatar');
            const customImg = document.createElement('img');
            customImg.src = playerData.avatar.data;
            customImg.alt = `${playerData.displayName} avatar`;
            customImg.style.width = '40px';
            customImg.style.height = '40px';
            customImg.style.borderRadius = '50%';
            avatarDiv.appendChild(customImg);
            console.log('✅ Using CUSTOM upload for', playerData.displayName);
        } else if (playerData.avatar && playerData.avatar.type === 'emoji') {
            // Emoji avatar
            avatarDiv.textContent = playerData.avatar.data;
            avatarDiv.style.fontSize = '24px';
            console.log('✅ Using EMOJI avatar for', playerData.displayName, ':', playerData.avatar.data);
        } else {
            // No avatar data - try file first, then default
            const img = document.createElement('img');
            img.style.display = 'none';
            avatarDiv.appendChild(img);
            
            getPlayerIcon(img, playerData.displayName, playerData.name);
            
            setTimeout(() => {
                if (img.style.display === 'none') {
                    // No file found, use default
                    avatarDiv.textContent = '👤';
                    console.log('⚠️ Using DEFAULT avatar for', playerData.displayName);
                } else {
                    console.log('✅ Using avatar FILE (fallback) for', playerData.displayName);
                }
            }, 500);
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'player-info-text';

        // **FIX**: Re-added the internal player name (e.g., "Jugador 1") to the display.
        const finalDisplayName = `${playerData.displayName} (${playerData.name})`;
        
        // Create the player name div
        const nameDiv = document.createElement('div');
        nameDiv.className = 'player-name';
        nameDiv.textContent = `${finalDisplayName} ${playerName === myJugadorName ? '(You)' : ''}`;
        
        // Create the tile count container
        const tileCountDiv = document.createElement('div');
        tileCountDiv.className = 'tile-count';
        tileCountDiv.style.cssText = `
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 2px;
        `;
        
        // Add the text
        const tileText = document.createElement('span');
        tileText.textContent = `Fichas: ${playerData.tileCount}`;
        tileCountDiv.appendChild(tileText);
        
        // Add tiny visual dominoes
        const tinyTilesDisplay = createTinyTilesDisplay(playerData.tileCount);
        tileCountDiv.appendChild(tinyTilesDisplay);
        
        // Append both divs to infoDiv
        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(tileCountDiv);

        div.appendChild(avatarDiv);
        div.appendChild(infoDiv);

        div.classList.toggle('current-turn', playerData.name === gameState.currentTurn);
        div.classList.toggle('disconnected', !playerData.isConnected);
    });
}

function updateTeamInfo() {
    const teamInfoDiv = document.getElementById('team-info');
    if (!teamInfoDiv || !gameState.teams || !gameState.jugadoresInfo) return;
    const { teams, matchNumber } = gameState;
    
    const getDisplayName = (internalName) => {
        const player = gameState.jugadoresInfo.find(p => p.name === internalName);
        return player ? player.displayName : internalName;
    };

    // Only show match/team info as before, no room/points legend here
    let teamsHtml = `<b>Match ${matchNumber || 1}</b><br>`;
    if (teams.teamA && teams.teamA.length > 0) { teamsHtml += `<b>Equipo A:</b> ${teams.teamA.map(getDisplayName).join(' & ')}<br>`; }
    if (teams.teamB && teams.teamB.length > 0) { teamsHtml += `<b>Equipo B:</b> ${teams.teamB.map(getDisplayName).join(' & ')}<br>`; }
    teamInfoDiv.innerHTML = teamsHtml;
}

function updateRoomInfo() {
    // If the lobby is visible, hide the legend and return
    const lobby = document.getElementById('lobby-container');
    var legendDiv = document.getElementById('room-points-legend');
    if (lobby && window.getComputedStyle(lobby).display !== 'none') {
        if (legendDiv) legendDiv.style.display = 'none';
        return;
    }
    // Remove legacy points-objective element if present
    const legacyPointsObj = document.getElementById('points-objective');
    if (legacyPointsObj && legacyPointsObj.parentNode) {
        legacyPointsObj.parentNode.removeChild(legacyPointsObj);
    }
    // Aggressively remove or hide any old room/points/objective elements except the new legend
    // Only remove elements whose id or class STARTS WITH room, points, or objective, and never remove team-info
    const aggressiveSelectors = [
        '[id^="room"]:not(#room-points-legend):not(#team-info)',
        '[id^="points"]:not(#room-points-legend):not(#team-info)',
        '[id^="objective"]:not(#room-points-legend):not(#team-info)',
        '[class^="room"]:not(.team-info)',
        '[class^="points"]:not(.team-info)',
        '[class^="objective"]:not(.team-info)'
    ];
    document.querySelectorAll(aggressiveSelectors.join(',')).forEach(el => {
        if (el.id !== 'room-points-legend' && el.id !== 'team-info' && !el.classList.contains('team-info')) {
            try {
                el.parentNode && el.parentNode.removeChild(el);
            } catch (e) {
                el.style.display = 'none';
            }
        }
    });

    // Place the room/points legend to the right of the Match info container
    let matchDiv = document.getElementById('team-info');
    if (!legendDiv) {
        legendDiv = document.createElement('div');
        legendDiv.id = 'room-points-legend';
        legendDiv.style.position = 'absolute';
        legendDiv.style.top = '';
        legendDiv.style.left = '';
        legendDiv.style.zIndex = '20';
        legendDiv.style.background = 'rgba(0,0,0,0.18)'; // Subtle, light background for readability
        legendDiv.style.color = '#fff';
        legendDiv.style.fontWeight = 'bold';
        legendDiv.style.fontSize = '18px';
        legendDiv.style.padding = '2px 12px 2px 10px';
        legendDiv.style.borderRadius = '7px';
        legendDiv.style.boxShadow = '0 1px 4px rgba(0,0,0,0.10)'; // Very light shadow
        legendDiv.style.pointerEvents = 'none';
        legendDiv.style.userSelect = 'none';
        document.body.appendChild(legendDiv);
    }
    // Position legendDiv to the right of matchDiv
    if (matchDiv) {
        const rect = matchDiv.getBoundingClientRect();
        legendDiv.style.top = `${rect.top + window.scrollY}px`;
        legendDiv.style.left = `${rect.right + 16 + window.scrollX}px`;
    } else {
        // fallback to top left if matchDiv not found
        legendDiv.style.top = '8px';
        legendDiv.style.left = '12px';
    }
    if (gameState && gameState.roomId && gameState.targetScore) {
        legendDiv.textContent = `${gameState.roomId.replace(' ', '-')} A ${gameState.targetScore} puntos`;
        legendDiv.style.display = 'block';
    } else if (gameState && gameState.roomId) {
        legendDiv.textContent = gameState.roomId.replace(' ', '-');
        legendDiv.style.display = 'block';
    } else {
        legendDiv.textContent = '';
        legendDiv.style.display = 'none';
    }
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
    if (messageDisplay.text && millis() - messageDisplay.time < 4000) {
        messageDiv.innerText = messageDisplay.text;
        messageDiv.style.display = 'block';
    } else {
        messageDiv.innerText = '';
        messageDiv.style.display = 'none';
    }
}

/**
 * Creates a small visual domino tile as an HTML element
 */
function createTinyDomino() {
    const tinyTile = document.createElement('div');
    tinyTile.className = 'tiny-domino';
    tinyTile.style.cssText = `
        width: 12px;
        height: 20px;
        background: #f5f5f5;
        border: 1px solid #333;
        border-radius: 2px;
        display: inline-block;
        margin: 0 1px;
        position: relative;
        box-shadow: 0 1px 2px rgba(0,0,0,0.3);
    `;
    
    // Add a tiny divider line
    const divider = document.createElement('div');
    divider.style.cssText = `
        position: absolute;
        top: 50%;
        left: 1px;
        right: 1px;
        height: 1px;
        background: #333;
        transform: translateY(-50%);
    `;
    tinyTile.appendChild(divider);
    
    return tinyTile;
}

/**
 * Creates a container with tiny domino tiles representing the tile count
 */
function createTinyTilesDisplay(tileCount) {
    const container = document.createElement('div');
    container.className = 'tiny-tiles-container';
    container.style.cssText = `
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        margin-left: 5px;
        max-width: 80px;
        gap: 1px;
    `;
    
    // Create tiny dominoes up to the tile count (max 7 for visual clarity)
    const tilesToShow = Math.min(tileCount, 7);
    for (let i = 0; i < tilesToShow; i++) {
        container.appendChild(createTinyDomino());
    }
    
    // If more than 7 tiles, add a "+X" indicator
    if (tileCount > 7) {
        const extraIndicator = document.createElement('span');
        extraIndicator.textContent = `+${tileCount - 7}`;
        extraIndicator.style.cssText = `
            font-size: 10px;
            color: #666;
            margin-left: 2px;
            font-weight: bold;
        `;
        container.appendChild(extraIndicator);
    }
    
    return container;
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
    let matchesWonHtml = '<b><div style="text-align: left; line-height: 1.2;">Juegos<br>Ganados</div></b>';

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
    // 52. Check if board data exists and has spinner tile
    if (!gameState.board || gameState.board.length === 0 || !gameState.spinnerTile) return;

    // 53. Extract board data and define domino dimensions
    const { board, spinnerTile } = gameState;
    // 54. Set standard domino dimensions and spacing
    const long = 100*.95, short = 50*.95, gap = 2;
    // 55. Calculate board center Y position
    const boardCenterY = height / 2 - 218;

    // 56. Find spinner tile index in the board array
    const spinnerIndex = board.findIndex(t => t.left === spinnerTile.left && t.right === spinnerTile.right);
    // 57. Exit if spinner tile not found in board
    if (spinnerIndex === -1) return;

    // 58. Initialize array to store drawable tile data
    let drawableTiles = new Array(board.length);

    // 59. Check if spinner tile is a double to determine orientation
    const isSpinnerDouble = spinnerTile.left === spinnerTile.right;
    // 60. Set spinner tile dimensions (horizontal for non-doubles, vertical for doubles)
    const spinnerW = isSpinnerDouble ? short : long;
    const spinnerH = isSpinnerDouble ? long : short;
    // 61. Calculate spinner tile X position (centered horizontally)
    const spinnerX = width / 2 - spinnerW / 2;
    // 62. Calculate spinner tile Y position
    const spinnerY = boardCenterY - spinnerH / 2;
    // 63. Store spinner tile drawable data
    drawableTiles[spinnerIndex] = { domino: spinnerTile, x: spinnerX, y: spinnerY, w: spinnerW, h: spinnerH, isReversed: false };





// --- Right Side of Spinner ---
// 94. Initialize right side connection point based on spinner orientation
let connR;
if (isSpinnerDouble) {
    // For double (vertical) spinner: connect at right edge, middle height
    connR = { x: spinnerX + spinnerW, y: spinnerY + spinnerH / 2 };
} else {
    // For non-double (horizontal) spinner: connect at right edge, middle height
    connR = { x: spinnerX + spinnerW, y: spinnerY + spinnerH / 2 };
}
// 95. Set initial direction vector pointing right
let dirR = { x: 1, y: 0 };
// 96. Initialize counters for right side layout logic
let straightCountR = 0, turnCountR = 0;
// 97. Set initial turn trigger threshold
let turnAfterR = 5;

// 98. Loop through dominoes on right side of spinner (forwards)
for (let i = spinnerIndex + 1; i < board.length; i++) {
    // 99. Get current domino and check if it's a double
    const domino = board[i];
    const isDouble = domino.left === domino.right;
    // 100. Declare position and dimension variables
    let x, y, w, h;
    // 101. Get previous domino to check if it was a double (previous in array for right side)
    const prevDomino = board[i - 1];
    const prevWasDouble = prevDomino && prevDomino.left === prevDomino.right;

    // 102. Check if it's time to make a turn on right side
    if (turnCountR < 2 && straightCountR >= turnAfterR) {
        // 103. Store old direction before changing
        const oldDir = { ...dirR };
        // 104. Calculate new direction (90-degree counter-clockwise turn for symmetry)
        dirR = { x: -oldDir.y, y: oldDir.x };

        // 105. Set domino dimensions based on new direction
        w = (dirR.x !== 0) ? long : short;
        h = (dirR.x !== 0) ? short : long;

        // 106. Check if previous domino was a double for special positioning
        if (prevWasDouble) {
            // 107. First turn positioning after double (top right)
            if (oldDir.x === 1) {
                x = connR.x - w - gap/2;          // Position to the left of connection point
                y = connR.y  + w;       // Center vertically with slight downward offset
            
            // 108. Second turn positioning after double (bottom right)
            } else if (oldDir.y === 1) {            // <<<<<<< UNIFIED LOGIC APPLIED
             
             x = connR.x - w - (w * 0.5);  // Use tile width + 50% instead of fixed long + short            
             y = connR.y - h;             
            }

        // 109. Regular turn positioning (not after double)
        } else {
            // 110. First turn positioning (regular)
            if (oldDir.x === 1) {
                x = connR.x + gap;
                y = connR.y - h / 2 + (h * 0.25);  // Use 25% of tile height instead of fixed 25

            // 111. Second turn positioning (regular)
            } else if (oldDir.y === 1) {            // Second turn positioning (regular)
               y = connR.y + gap;
               x = connR.x - w / 2 - (w * 0.25);   // Use 25% of tile width instead of fixed (long / 4)
            }
        }

        // 112. Increment turn counter and update settings
        turnCountR++;
        turnAfterR = 3;
        straightCountR = 0;

    // 113. Straight line positioning (no turn)
    } else {
        // 114. Set domino dimensions based on direction and double status
        if (dirR.x !== 0) { // Horizontal line
            w = isDouble ? short : long;
            h = isDouble ? long : short;
        } else { // Vertical line (down branch)
            w = isDouble ? long : short;
            h = isDouble ? short : long;
        }

        // 115. Position domino based on current direction
        if (dirR.x === 1) { x = connR.x + gap; y = connR.y - h / 2; }
        // 116. Position for down direction
        else if (dirR.y === 1) { y = connR.y + gap; x = connR.x - w / 2; }
        // 117. Position for left direction
        else { x = connR.x - w - gap; y = connR.y - h / 2; }
    }

    // 118. Determine if domino should be visually reversed
    const isReversed = (dirR.x === -1);
    // 119. Store domino drawable data
    drawableTiles[i] = { domino, x, y, w, h, isReversed };

    // 120. Update connection point based on domino direction
    if (dirR.x === 1) { connR = { x: x + w, y: y + h / 2 }; } 
    else if (dirR.x === -1) { connR = { x: x, y: y + h / 2 }; } 
    else if (dirR.y === 1) { connR = { x: x + w / 2, y: y + h }; } // Downward turn
    else { connR = { x: x + w / 2, y: y }; }
    
    // 121. Increment straight counter
    straightCountR++;
}



    // --- Left Side of Spinner ---
    // 94. Initialize left side connection point based on spinner orientation
    let connL;
    if (isSpinnerDouble) {
        // For double (vertical) spinner: connect at left edge, middle height
        connL = { x: spinnerX, y: spinnerY + spinnerH / 2 };
    } else {
        // For non-double (horizontal) spinner: connect at left edge, middle height
        connL = { x: spinnerX, y: spinnerY + spinnerH / 2 };
    }
    // 95. Set initial direction vector pointing left
    let dirL = { x: -1, y: 0 };
    // 96. Initialize counters for left side layout logic
    let straightCountL = 0, turnCountL = 0;
    // 97. Set initial turn trigger threshold
    let turnAfterL = 5;

    // 98. Loop through dominoes on left side of spinner (backwards)
    for (let i = spinnerIndex - 1; i >= 0; i--) {
        // 99. Get current domino and check if it's a double
        const domino = board[i];
        const isDouble = domino.left === domino.right;
        // 100. Declare position and dimension variables
        let x, y, w, h;
        // 101. Get previous domino to check if it was a double (next in array for left side)
        const prevDomino = board[i + 1];
        const prevWasDouble = prevDomino && prevDomino.left === prevDomino.right;
// 102. Check if it's time to make a turn on left side
if (turnCountL < 2 && straightCountL >= turnAfterL) {
    // 103. Store old direction before changing
    const oldDir = { ...dirL };
    // 104. Calculate new direction (90-degree counter-clockwise turn)
    dirL = { x: oldDir.y, y: -oldDir.x };

    // 105. Set domino dimensions based on new direction
    w = (dirL.x !== 0) ? long : short;
    h = (dirL.x !== 0) ? short : long;

    // 106. Check if previous domino was a double for special positioning
    if (prevWasDouble) {
        // 107. First turn positioning after double (top left)
        if (oldDir.x === -1) {                  // First turn on the top left
            x = connL.x - w / 2 + (short * 0.53);
            y = connL.y + short/2 + (short * 0.52);
   //         y = connL.y + short / 2 + 25.5;
        // 108. Second turn positioning after double (bottom left)
        } else if (oldDir.y === 1) {            // Second turn on the bottom left.
            x = connL.x + h ;
            y = connL.y - w/2 ;  // Position above the connection point going up
        }
    
    // 109. Regular turn positioning (not after double)
    } else {
        // 110. First turn positioning (regular)
        if (oldDir.x === -1) {
            x = connL.x - w - gap;
            y = connL.y - h / 2 + (short * 0.5);

        // 111. Second turn positioning (regular)
        } else if (oldDir.y === 1) {
            y = connL.y + gap;
            x = connL.x - short / 2;
        }
    }

    // 112. Increment turn counter and update settings
    turnCountL++;
    turnAfterL = 3;
    straightCountL = 0;
        // 113. Straight line positioning (no turn)
        } else {
            // 114. Set domino dimensions based on direction and double status
            if (dirL.x !== 0) { // Horizontal line
                w = isDouble ? short : long;
                h = isDouble ? long : short;
            } else { // Vertical line (down branch)
                w = isDouble ? long : short;
                h = isDouble ? short : long;
            }

            // 115. Position domino based on current direction
            if (dirL.x === -1) { x = connL.x - w - gap; y = connL.y - h / 2; }
            // 116. Position for down direction
            else if (dirL.y === 1) { y = connL.y + gap; x = connL.x - w / 2; }
            // 117. Position for right direction
            else { x = connL.x + gap; y = connL.y - h / 2; }
        }

        // 118. Determine if domino should be visually reversed (opposite of right side)
        const isReversed = !(dirL.x === -1 || dirL.y === -1);
        // 119. Store domino drawable data
        drawableTiles[i] = { domino, x, y, w, h, isReversed };

        // 120. Update connection point based on domino direction
        if (dirL.x === 1) { connL = { x: x + w, y: y + h / 2 }; } // Rightward direction - connect at right edge
        else if (dirL.x === -1) { connL = { x: x, y: y + h / 2 }; }
        else if (dirL.y === 1) { connL = { x: x + w / 2, y: y + h }; }
        else if (dirL.y === -1) { connL = { x: x + w / 2, y: y }; } // Upward direction - connect at top
        else { connL = { x: x + w / 2, y: y }; }
        
        // 121. Increment straight counter
        straightCountL++;
    }

    // --- Draw all tiles ---
    // 122. Loop through all drawable tiles to render them
    drawableTiles.forEach(t => {
        if (t) {
            // 123. Initialize highlight state
            let isHighlighted = false;
            // 124. Check if this tile should be highlighted (recently played)
            if (lastPlayedHighlight.tile && 
                millis() - lastPlayedHighlight.timestamp < 3000 &&
                t.domino.left === lastPlayedHighlight.tile.left && 
                t.domino.right === lastPlayedHighlight.tile.right) {
                isHighlighted = true;
            }
            // 125. Draw the domino with all calculated properties
            drawSingleDomino(t.domino, t.x, t.y, t.w, t.h, false, t.isReversed, isHighlighted);
        }
    });
}



function clientHasValidMove() {
    if (!myPlayerHand || myPlayerHand.length === 0) return false;
    if (gameState.isFirstMove) {
        if (gameState.isFirstRoundOfMatch) {
            // First round of match: must play double 6
            return myPlayerHand.some(t => t.left === 6 && t.right === 6);
        } else if (gameState.isAfterTiedBlockedGame) {
            // After a tied blocked game: player with double 6 can play any tile
            return myPlayerHand.length > 0;
        } else {
            // Regular first move of a new round
            return true;
        }
    }
    return myPlayerHand.some(t => t.left === gameState.leftEnd || t.right === gameState.leftEnd || t.left === gameState.rightEnd || t.right === gameState.rightEnd);
}


// =============================================================================
// == VOICE CHAT FUNCTIONS                                                    ==
// =============================================================================

async function startVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });
        
        // Try different audio formats for better compatibility
        let options = { mimeType: 'audio/webm;codecs=opus' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { mimeType: 'audio/webm' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = { mimeType: 'audio/mp4' };
                if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                    options = {}; // Use default
                }
            }
        }
        
        mediaRecorder = new MediaRecorder(stream, options);
        audioChunks = [];
        
        console.log("🎤 Using audio format:", mediaRecorder.mimeType);
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
                console.log("🎤 Audio chunk received:", event.data.size, "bytes");
            }
        };
        
        mediaRecorder.onstop = () => {
            console.log("🎤 Recording stopped, processing audio...");
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            console.log("🎤 Audio blob size:", audioBlob.size, "bytes");
            sendVoiceMessage(audioBlob);
            // Stop all tracks to release microphone
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        console.log("🎤 Grabando...");
        
        // Visual feedback
        const voiceBtn = document.getElementById('voice-chat-btn');
        if (voiceBtn) {
            voiceBtn.style.backgroundColor = '#ff4444';
            voiceBtn.textContent = '🔴 Grabando...';
        }
        
    } catch (error) {
        console.error("🎤 Error accessing microphone:", error);
        alert("Could not access microphone. Please check permissions.");
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        console.log("🎤 Recording stopped");
        
        // Reset visual feedback
        const voiceBtn = document.getElementById('voice-chat-btn');
        if (voiceBtn) {
            voiceBtn.style.backgroundColor = '#4CAF50';
            voiceBtn.textContent = '🎤 Presione y hable';
        }
    }
}

function sendVoiceMessage(audioBlob) {
    console.log("🎤 Sending voice message, blob size:", audioBlob.size);
    
    if (audioBlob.size === 0) {
        console.error("🎤 Audio blob is empty!");
        return;
    }
    
    // Convert to base64 and send via socket
    const reader = new FileReader();
    reader.onloadend = () => {
        const base64Audio = reader.result.split(',')[1];
        const myDisplayName = gameState.jugadoresInfo?.find(p => p.name === myJugadorName)?.displayName || 'Unknown';
        
        console.log("🎤 Base64 audio length:", base64Audio.length);
        console.log("🎤 Sending as:", myDisplayName);
        
        socket.emit('voiceMessage', { 
            audio: base64Audio, 
            sender: myDisplayName,
            timestamp: Date.now()
        });
        
        // Add to chat as voice message indicator
        const messagesDiv = document.getElementById('chat-messages');
        const messageElement = document.createElement('p');
        messageElement.innerHTML = `<b>You:</b> 🎤 Voice Message (${Math.round(audioBlob.size/1024)}KB)`;
        messageElement.style.fontStyle = 'italic';
        messageElement.style.color = '#888';
        messagesDiv.appendChild(messageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    };
    
    reader.onerror = (error) => {
        console.error("🎤 Error reading audio blob:", error);
    };
    
    reader.readAsDataURL(audioBlob);
}

function playVoiceMessage(data) {
    try {
        console.log("🎵 Received voice message from:", data.sender);
        console.log("🎵 Audio data length:", data.audio ? data.audio.length : 'No audio data');
        
        // Convert base64 back to audio
        const audioData = `data:audio/wav;base64,${data.audio}`;
        const audio = new Audio(audioData);
        audio.volume = 0.8;
        
        // Add debugging for audio events
        audio.onloadeddata = () => console.log("🎵 Audio loaded successfully");
        audio.oncanplay = () => console.log("🎵 Audio can play");
        audio.onerror = (error) => console.error("🎵 Audio error:", error);
        audio.onended = () => console.log("🎵 Audio playback ended");
        
        // Add to chat as received voice message
        const messagesDiv = document.getElementById('chat-messages');
        const messageElement = document.createElement('p');
        const senderName = data.sender || 'Unknown';
        messageElement.innerHTML = `<b>${senderName}:</b> 🎤 Voice Message`;
        messageElement.style.fontStyle = 'italic';
        messageElement.style.color = '#666';
        messagesDiv.appendChild(messageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        
        // Play the audio
        audio.play().then(() => {
            console.log("🎵 Audio started playing");
        }).catch(error => {
            console.error("🎵 Error playing voice message:", error);
            alert("Could not play voice message. Check browser audio permissions.");
        });
        
    } catch (error) {
        console.error("🎵 Error processing voice message:", error);
    }
}
