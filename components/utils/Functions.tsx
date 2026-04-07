/*
================================================================================
FUNCTIONS UTILITY MODULE
================================================================================
Common utility functions for the Geo Bingo application.
Includes array shuffling, distance calculations, and game logic.
Provides mathematical and data manipulation helpers.
================================================================================
*/

import { Submission } from './types';


export const shuffle = <T,>(array: T[]): T[] => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
};

export const validatePolygon = (startLat: number, startLng: number, polyString: string | null) => {
    if (!polyString || polyString === '[]') {
        return true; // No polygon to validate, so it's valid by default
    }

    try {
        const points = JSON.parse(polyString);
        if (!Array.isArray(points) || points.length < 3) {
            return false; // Not a valid polygon
        }

        const point = new google.maps.LatLng(startLat, startLng);
        const polygon = new google.maps.Polygon({ paths: points });
        
        return google.maps.geometry.poly.containsLocation(point, polygon);
    } catch (error) {
        console.error('Error validating polygon:', error);
        return false; // If there's an error parsing or validating, treat it as invalid
    }  
}

export const calculateBingoCounter = (
    gridSize: number, 
    board: string[], 
    submissions: Submission[]
): { count: number, players: string[] } => {
    if (!board || board.length === 0 || gridSize < 2) return { count: 0, players: [] };

    let bingoCount = 0;
    const contributingPlayers = new Set<string>();
    const grid: (Submission | null)[][] = [];

    for (let i = 0; i < gridSize; i++) {
        grid[i] = [];
        for (let j = 0; j < gridSize; j++) {
            const catIndex = i * gridSize + j;
            const catName = board[catIndex];
            const foundSub = submissions.find(sub => sub.category === catName);
            grid[i][j] = foundSub || null;
        }
    }

    for (let i = 0; i < gridSize; i++) {
        if (grid[i].every(cell => cell !== null)) {
            bingoCount++;
            grid[i].forEach(cell => contributingPlayers.add(cell!.player_id));
        }
    }

    for (let j = 0; j < gridSize; j++) {
        let columnComplete = true;
        for (let i = 0; i < gridSize; i++) {
            if (grid[i][j] === null) {
                columnComplete = false;
                break;
            }
        }
        if (columnComplete) {
            bingoCount++;
            for (let i = 0; i < gridSize; i++) contributingPlayers.add(grid[i][j]!.player_id);
        }
    }

    let diag1Complete = true;
    for (let i = 0; i < gridSize; i++) {
        if (grid[i][i] === null) {
            diag1Complete = false;
            break;
        }
    }
    if (diag1Complete) {
        bingoCount++;
        for (let i = 0; i < gridSize; i++) contributingPlayers.add(grid[i][i]!.player_id);
    }

    let diag2Complete = true;
    for (let i = 0; i < gridSize; i++) {
        if (grid[i][gridSize - 1 - i] === null) {
            diag2Complete = false;
            break;
        }
    }
    if (diag2Complete) {
        bingoCount++;
        for (let i = 0; i < gridSize; i++) contributingPlayers.add(grid[i][gridSize - 1 - i]!.player_id);
    }

    const playersArray = Array.from(contributingPlayers);

    return { count: bingoCount, players: playersArray };
};

// Berechnet ein perfektes 3x3 Gitter um den Startpunkt
export const getGridLocations = (centerLat: number, centerLng: number, radiusMeters: number) => {
    const points = [];
    const R = 6378137; // Erdradius in Metern
    
    let offsetFactors = [0];
    let subRadiusFactor = 1.0; // Standard: 100% des Radius, wenn es nur 1 Punkt ist

    // Faktoren für die Verteilung und den jeweiligen Suchradius
    if (radiusMeters > 8000) {
        offsetFactors = [-0.75, -0.25, 0.25, 0.75]; // 4x4 = 16 Punkte
        subRadiusFactor = 0.35; // 35% des Gesamtradius pro Punkt deckt alles ab
    } else if (radiusMeters > 4000) {
        offsetFactors = [-0.66, 0, 0.66]; // 3x3 = 9 Punkte
        subRadiusFactor = 0.45; 
    } else if (radiusMeters > 1000) {
        offsetFactors = [-0.33, 0.33]; // 2x2 = 4 Punkte
        subRadiusFactor = 0.6;
    } else {
        offsetFactors = [0]; // 1x1 = 1 Punkt (direkt im Zentrum)
        subRadiusFactor = 1.0;
    }

    for (const xFactor of offsetFactors) {
        for (const yFactor of offsetFactors) { 
        // skip corner points for larger grids to avoid too much overlap
            if (offsetFactors.length > 2 && 
            ((xFactor === offsetFactors[0] && yFactor === offsetFactors[0]) ||
            (xFactor === offsetFactors[0] && yFactor === offsetFactors[offsetFactors.length - 1]) ||
            (xFactor === offsetFactors[offsetFactors.length - 1] && yFactor === offsetFactors[0]) ||
            (xFactor === offsetFactors[offsetFactors.length - 1] && yFactor === offsetFactors[offsetFactors.length - 1]))) {
                continue;
            }
            const xOffsetMeters = radiusMeters * xFactor;
            const yOffsetMeters = radiusMeters * yFactor;

            const dLat = yOffsetMeters / R;
            const dLng = xOffsetMeters / (R * Math.cos((Math.PI * centerLat) / 180));

            points.push({
                lat: centerLat + (dLat * 180) / Math.PI,
                lng: centerLng + (dLng * 180) / Math.PI
            });
        }
    }
    
    return {
        points,
        subRadiusMeters: radiusMeters * subRadiusFactor
    };
};

export const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371e3; // Erdradius in Metern
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distanz in Metern
};