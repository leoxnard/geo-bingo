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
