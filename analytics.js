// analytics.js - Simple usage tracking for your domino game
const fs = require('fs').promises;
const path = require('path');

class GameAnalytics {
    constructor() {
        this.logFile = path.join(__dirname, 'game-analytics.log');
        this.dailyStats = new Map(); // In-memory daily stats
        this.initializeAnalytics();
    }

    async initializeAnalytics() {
        try {
            // Ensure log file exists
            await fs.access(this.logFile);
        } catch (error) {
            // Create log file if it doesn't exist
            await fs.writeFile(this.logFile, '');
            console.log('📊 Analytics log file created');
        }
    }

    // Log various game events
    async logEvent(eventType, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            eventType,
            ...data
        };

        try {
            await fs.appendFile(this.logFile, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.error('Analytics logging error:', error);
        }
    }

    // Track when players join games
    async trackPlayerJoin(playerName, roomId, displayName, userAgent = 'Unknown') {
        await this.logEvent('player_join', {
            playerName,
            roomId,
            displayName,
            userAgent
        });
        
        // Update daily stats
        const today = new Date().toDateString();
        if (!this.dailyStats.has(today)) {
            this.dailyStats.set(today, { uniquePlayers: new Set(), totalJoins: 0, rooms: new Set() });
        }
        
        const todayStats = this.dailyStats.get(today);
        todayStats.uniquePlayers.add(displayName);
        todayStats.totalJoins++;
        todayStats.rooms.add(roomId);
    }

    // Track game completions
    async trackGameEnd(roomId, winningTeam, gameStats) {
        await this.logEvent('game_end', {
            roomId,
            winningTeam,
            duration: gameStats.duration,
            totalMoves: gameStats.totalMoves,
            playerCount: gameStats.playerCount
        });
    }

    // Track room creations
    async trackRoomCreated(roomId, targetScore) {
        await this.logEvent('room_created', {
            roomId,
            targetScore
        });
    }

    // Track voice message usage
    async trackVoiceMessage(roomId, sender) {
        await this.logEvent('voice_message', {
            roomId,
            sender
        });
    }

    // Track tile placements
    async trackTilePlaced(roomId, playerName, tile, position) {
        await this.logEvent('tile_placed', {
            roomId,
            playerName,
            tile,
            position
        });
    }

    // Get daily summary
    getDailySummary() {
        const today = new Date().toDateString();
        const stats = this.dailyStats.get(today);
        
        if (!stats) {
            return {
                date: today,
                uniquePlayers: 0,
                totalJoins: 0,
                activeRooms: 0
            };
        }

        return {
            date: today,
            uniquePlayers: stats.uniquePlayers.size,
            totalJoins: stats.totalJoins,
            activeRooms: stats.rooms.size
        };
    }

    // Get analytics data for dashboard
    async getAnalyticsData(days = 7) {
        try {
            const data = await fs.readFile(this.logFile, 'utf8');
            const lines = data.trim().split('\n').filter(line => line);
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            
            const recentEvents = lines
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (e) {
                        return null;
                    }
                })
                .filter(event => event && new Date(event.timestamp) > cutoffDate);

            // Process the data
            const analytics = {
                totalPlayers: new Set(recentEvents.filter(e => e.eventType === 'player_join').map(e => e.displayName)).size,
                totalGames: recentEvents.filter(e => e.eventType === 'game_end').length,
                totalJoins: recentEvents.filter(e => e.eventType === 'player_join').length,
                roomsCreated: recentEvents.filter(e => e.eventType === 'room_created').length,
                voiceMessages: recentEvents.filter(e => e.eventType === 'voice_message').length,
                tilePlacements: recentEvents.filter(e => e.eventType === 'tile_placed').length,
                dailyBreakdown: this.getDailyBreakdown(recentEvents)
            };

            return analytics;
        } catch (error) {
            console.error('Error reading analytics:', error);
            return null;
        }
    }

    getDailyBreakdown(events) {
        const dailyData = {};
        
        events.forEach(event => {
            const date = new Date(event.timestamp).toDateString();
            if (!dailyData[date]) {
                dailyData[date] = {
                    players: new Set(),
                    games: 0,
                    joins: 0,
                    rooms: new Set(),
                    voiceMessages: 0,
                    tilePlacements: 0
                };
            }
            
            if (event.eventType === 'player_join') {
                dailyData[date].players.add(event.displayName);
                dailyData[date].joins++;
                dailyData[date].rooms.add(event.roomId);
            } else if (event.eventType === 'game_end') {
                dailyData[date].games++;
            } else if (event.eventType === 'voice_message') {
                dailyData[date].voiceMessages++;
            } else if (event.eventType === 'tile_placed') {
                dailyData[date].tilePlacements++;
            }
        });
        
        // Convert Sets to numbers
        Object.keys(dailyData).forEach(date => {
            dailyData[date].uniquePlayers = dailyData[date].players.size;
            dailyData[date].activeRooms = dailyData[date].rooms.size;
            delete dailyData[date].players;
            delete dailyData[date].rooms;
        });
        
        return dailyData;
    }

    // Get quick stats for console logging
    async getQuickStats() {
        const analytics = await this.getAnalyticsData(1); // Last 24 hours
        const dailySummary = this.getDailySummary();
        
        return {
            today: dailySummary,
            last24h: analytics
        };
    }
}

module.exports = new GameAnalytics();
