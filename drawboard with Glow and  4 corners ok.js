/**
 * Draws the entire board of played dominoes, handling the layout logic.
 * This function places a central "spinner" tile and then calculates the position
 * for two "branches" of tiles that extend outwards from it.
 * * With GLOW effect for the last played tile.  7/10/2025
 */
function drawBoard() {
    // --- Initial Setup & Safety Checks ---
    if (!gameState.board || gameState.board.length === 0 || !gameState.spinnerTile) return;

    const { board, spinnerTile } = gameState;
    const long = 100, short = 50, gap = 2;
    const boardCenterY = height / 2 - 225;

    const spinnerIndex = board.findIndex(t => t.left === spinnerTile.left && t.right === spinnerTile.right);
    if (spinnerIndex === -1) return;

    let drawableTiles = new Array(board.length);

    // --- 1. Place the Spinner Tile ---
    const spinnerW = short, spinnerH = long;
    const spinnerX = width / 2 - spinnerW / 2;
    const spinnerY = boardCenterY - spinnerH / 2;
    drawableTiles[spinnerIndex] = { domino: spinnerTile, x: spinnerX, y: spinnerY, w: spinnerW, h: spinnerH, isReversed: false };

    // --- 2. Process the Right Branch ---
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
            
            if (oldDir.x === 1) { // First turn (top corner).
                y = connR.y - short / 2;
                x = connR.x + gap;
            } else if (oldDir.y === 1) { // Second turn (bottom corner).
                y = connR.y + gap;
                x = connR.x + (short / 2) - w;
            }
            
            turnCountR++;
            turnAfterR = 4;
            straightCountR = 0;

        } else {
            if (dirR.x !== 0) {
                w = isDouble ? short : long;
                h = isDouble ? long : short;
            } else {
                w = short;
                h = long;
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

    // --- 3. Process the Left Branch ---
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
            
            if (oldDir.x === -1) { // First turn on the left.
                y = connL.y - short / 2;
                x = connL.x - w - gap;
            } else if (oldDir.y === 1) { // Second turn on the left.
                y = connL.y + gap;
                x = connL.x - (short / 2);
            }

            turnCountL++;
            turnAfterL = 3;
            straightCountL = 0;

        } else {
            if (dirL.x !== 0) {
                w = isDouble ? short : long;
                h = isDouble ? long : short;
            } else {
                w = short;
                h = long;
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

    // --- 4. Draw All Calculated Tiles ---
    // NEW: Check for the highlighted tile and pass the flag to the drawing function.
    drawableTiles.forEach(t => {
        if (t) {
            let isHighlighted = false;
            // Check if this tile is the one to highlight and if it's recent enough
            if (lastPlayedHighlight.tile && 
                millis() - lastPlayedHighlight.timestamp < 2500 && // Highlight for 2.5 seconds
                t.domino.left === lastPlayedHighlight.tile.left && 
                t.domino.right === lastPlayedHighlight.tile.right) {
                isHighlighted = true;
            }
            drawSingleDomino(t.domino, t.x, t.y, t.w, t.h, false, t.isReversed, isHighlighted);
        }
    });
}