'use client';


import { useState, useRef, useEffect } from 'react';
import { GeoBingoLogo } from './utils/Elements';
import { FaRegCopy, FaCopy, FaTimes, FaRegEdit, FaUndo } from "react-icons/fa";
import { GoogleMap, useJsApiLoader, PolygonF, MarkerF, InfoWindowF } from '@react-google-maps/api';

import { insertPoint } from './utils/mapUtils';
import { FullscreenButton } from './utils/Elements';
import { validatePolygon } from './utils/Functions';

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
}

type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

interface LobbyViewProps {
    renderToast: () => React.ReactNode;
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    bingoBoardMode: 'shared' | 'individual';
    startingPoint: string;
    updateGameModeInfo: (updates: { game_mode?: string; team_mode?: string; grid_size?: number; bingo_board_mode?: 'shared' | 'individual'; starting_point?: string; gameBoundary?: string | null }) => void;
    isHost: boolean;
    gridSize: number;
    timeLimit: number;
    updateTimeLimit: (minutes: number) => void;
    categories: string[];
    gameId: string;
    players: Player[];
    onlinePlayers: string[];
    playerId: string;
    gameHostId: string;
    makeHost: (id: string) => void;
    kickPlayer: (id: string) => void;
    banPlayer: (id: string) => void;
    showToast : (message: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    updateStatus: (nextStatus: GameStatus) => Promise<void>;
    setPlayers: (players: Player[] | ((prev: Player[]) => Player[])) => void;
}

const shuffle = <T,>(array: T[]): T[] => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
};

const teamColors = ['bg-indigo-500', 'bg-rose-500', 'bg-emerald-500', 'bg-amber-500'];
const teamNames = ['Blue Team', 'Red Team', 'Green Team', 'Yellow Team'];

const RECOMMENDED_STARTS = [
    { name: 'New York', lat: 40.7570095, lng: -73.9859724 },
    { name: 'Paris', lat: 48.853586, lng: 2.349171 },
    { name: 'Tokyo', lat: 35.658537, lng: 139.700240 }
];

export default function LobbyView({
    renderToast, gameMode, teamMode, isHost, gridSize, updateGameModeInfo,
    bingoBoardMode, startingPoint, gameBoundary,
    timeLimit, updateTimeLimit, categories,
    gameId, players, onlinePlayers,
    playerId, gameHostId,
    makeHost, kickPlayer, banPlayer, showToast, router, supabase, updateStatus, setPlayers
}: LobbyViewProps & { gameBoundary?: string | null }) {

    const [newCategory, setNewCategory] = useState('');
    const [randomLang, setRandomLang] = useState<'german' | 'english'>('german');
    const [randomCount, setRandomCount] = useState<number | ''>(4);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    
    const categoryInputRef = useRef<HTMLInputElement>(null);
    const [copied, setCopied] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [currentLink, setCurrentLink] = useState('');

    const [isEditingSelfName, setIsEditingSelfName] = useState(false);
    const [selfNameInput, setSelfNameInput] = useState('');
    const selfNameInputRef = useRef<HTMLInputElement>(null);

    const mapOptopns = {
        streetViewControl: isHost,
        mapTypeControl: false,
        gestureHandling: isHost ? 'greedy' : 'none',
        draggableCursor: isHost ? 'crosshair' : 'default',
        mapId: 'GEO_BINGO_MAP_LOBBY',
        clickableIcons: false,
        fullscreenControl: false,
        cameraControl: false,
    };

    const [mapLibraries] = useState<("places" | "geometry")[]>(['places', 'geometry']);

    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries: mapLibraries
    });

    // Map instances & overrides
    const actualStart = startingPoint || 'open-world';
    const polyString = gameBoundary || '';
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [hoveredLocation, setHoveredLocation] = useState<{lat: number, lng: number} | null>(null);

    const [mapCenter, setMapCenter] = useState({ lat: 20, lng: 0 });
    const [mapZoom, setMapZoom] = useState(2);
    const hasInitializedMap = useRef(false);

    const [draftPolygonPoints, setDraftPolygonPoints] = useState<{lat: number, lng: number}[]>([]);

    // Intercept Pegman Drop
    useEffect(() => {
        if (!mapInstance || !isHost) return;
        const sv = mapInstance.getStreetView();
        const listener = google.maps.event.addListener(sv, 'visible_changed', () => {
            if (sv.getVisible()) {
                // Prevent actually entering Street View
                sv.setVisible(false);
                const pos = sv.getPosition();
                if (pos) {
                    updateGameModeInfo({
                        starting_point: JSON.stringify({ lat: pos.lat(), lng: pos.lng() }),
                        gameBoundary: JSON.stringify(draftPolygonPoints)
                    });
                }
            }
        });
        return () => {
            google.maps.event.removeListener(listener);
        };
    }, [mapInstance, isHost, updateGameModeInfo, showToast, draftPolygonPoints]);

    useEffect(() => {
        if (polyString && polyString !== '[]') { 
            try {
                const points = JSON.parse(polyString);
                if (Array.isArray(points)) {
                    setDraftPolygonPoints(points);
                    if (points.length === 3) {
                        let minX = points[0].lat, maxX = points[0].lat;
                        let minY = points[0].lng, maxY = points[0].lng;
                        for (let i = 1; i < points.length; i++) {
                            if (points[i].lat < minX) minX = points[i].lat;
                            if (points[i].lat > maxX) maxX = points[i].lat;
                            if (points[i].lng < minY) minY = points[i].lng;
                            if (points[i].lng > maxY) maxY = points[i].lng;
                        }
                        const polyCenter = { lat: (minX + maxX)/2, lng: (minY + maxY)/2 };
                        
                        const latDiff = maxX - minX;
                        const lngDiff = maxY - minY;
                        const maxDiff = Math.max(latDiff, lngDiff);
                        const calculatedZoom = maxDiff > 0 ? Math.floor(Math.log2(360 / maxDiff)) - 0.5 : 12;
                        const polyZoom = Math.min(Math.max(calculatedZoom, 1), 18);

                        setMapCenter(polyCenter);
                        setMapZoom(polyZoom);
                        hasInitializedMap.current = true;
                    }
                }
            } catch (e) {
                console.error("Invalid polygon data", e);
            }
        } else {
            setDraftPolygonPoints([]);
        }
    }, [polyString]);

    useEffect(() => {
        setCurrentLink(window.location.href);
    }, []);

    const getSidebarTextSizeClass = () => {
        if (gameMode !== 'bingo') return '';
        switch (gridSize) {
        case 2: return 'text-base sm:text-xl';
        case 3: return 'text-xs sm:text-xl';
        case 4: return 'text-xs sm:text-base';
        case 5: return 'text-[10px] sm:text-sm';
        default: return 'text-xs sm:text-xl';
        }
    };

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const handleCopyGameId = () => {
        navigator.clipboard.writeText(gameId);
        setCopied(true);
        setTimeout(() => setCopied(false), 800);
    };

    const handleCopyGameLink = () => {
        navigator.clipboard.writeText(currentLink);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 800);
    };

    const handleLeaveLobby = () => {
        localStorage.setItem('geoBingoLastLobbyId', gameId);
        router.push('/');
    };

    const addRandomCategories = async () => {
        if (!isHost) return;
        try {
            const { categoriesDe, categoriesEn } = await import('../lib/categories');
            const allWords = randomLang === 'german' ? categoriesDe : categoriesEn;
        
            const shuffled = shuffle(allWords);
            const availableWords = shuffled.filter(w => !categories.map(c => c.toLowerCase()).includes(w.toLowerCase()));
            const selectedWords = availableWords.slice(0, parseInt(String(randomCount)) > 0 ? parseInt(String(randomCount)) : 0);

            if (selectedWords.length > 0) {
                const updated = [...categories, ...selectedWords];
                await supabase.from('games').update({ categories: updated }).eq('id', gameId);
            } else {
                showToast("Not enough new words available!");
            }
        } catch (err) {
            console.error("Error fetching random words", err);
            showToast("Error loading random words.");
        }
    };

    const addCategory = async () => {
        const trimmedCat = newCategory.trim();
        if (trimmedCat !== '' && isHost) {
            if (gameMode === 'bingo' && categories.length >= gridSize * gridSize) {
                showToast(`Maximal ${gridSize * gridSize} words allowed for this Bingo grid!`);
                return;
            }
            if (categories.some(c => c.toLowerCase() === trimmedCat.toLowerCase())) {
                showToast("This category already exists!");
                return;
            }
            const updated = [...categories, trimmedCat];
            await supabase.from('games').update({ categories: updated }).eq('id', gameId);
            setNewCategory('');
        
            setTimeout(() => {
                categoryInputRef.current?.focus();
            }, 50);
        }
    };

    const removeCategory = async (catToRemove: string) => {
        if (isHost && categories.length > 0) {
            const updated = categories.filter(c => c !== catToRemove);
            await supabase.from('games').update({ categories: updated }).eq('id', gameId);
        }
    };

    const clearCategories = async () => {
        if (isHost) {
            await supabase.from('games').update({ categories: [] }).eq('id', gameId);
        }
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        if (!isHost) return;
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!isHost) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
        if (!isHost) return;
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === targetIndex) return;
    
        const updated = [...categories];
        if (draggedIndex >= updated.length) return;

        if (targetIndex >= updated.length) {
            const [draggedItem] = updated.splice(draggedIndex, 1);
            updated.push(draggedItem);
        } else {
            const temp = updated[draggedIndex];
            updated[draggedIndex] = updated[targetIndex];
            updated[targetIndex] = temp;
        }
    
        setDraggedIndex(null);
        await supabase.from('games').update({ categories: updated }).eq('id', gameId);
    };

    useEffect(() => {
        const currentName = players.find((p) => p.id === playerId)?.name;
        if (!isEditingSelfName && currentName) {
            setSelfNameInput(currentName);
        }
    }, [players, playerId, isEditingSelfName]);

    useEffect(() => {
        if (isEditingSelfName) {
            selfNameInputRef.current?.focus();
            selfNameInputRef.current?.select();
        }
    }, [isEditingSelfName]);

    const saveSelfName = async () => {
        if (!playerId) return;

        const currentName = players.find((p) => p.id === playerId)?.name || localStorage.getItem('geoBingoPlayerName') || '';
        const nextName = selfNameInput.trim();

        if (!nextName) {
            setSelfNameInput(currentName);
            setIsEditingSelfName(false);
            return;
        }

        if (nextName === currentName) {
            setIsEditingSelfName(false);
            return;
        }

        localStorage.setItem('geoBingoPlayerName', nextName);
        setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, name: nextName } : p)));

        const { error } = await supabase.from('players').update({ name: nextName }).eq('id', playerId);
        if (error) {
            showToast('Could not update name. Please try again.');
            return;
        }

        setIsEditingSelfName(false);
        showToast('Name updated.');
    };

    const handleRenameSelf = async () => {
        if (!playerId) return;

        if (!isEditingSelfName) {
            const currentName = players.find((p) => p.id === playerId)?.name || localStorage.getItem('geoBingoPlayerName') || '';
            setSelfNameInput(currentName);
            setIsEditingSelfName(true);
            return;
        }

        await saveSelfName();
    };

    const handleUpdateSelfTeam = async (teamIndex: number) => {
        if (!playerId) return;
        setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, team: teamIndex } : p)));
        const { error } = await supabase.from('players').update({ team: teamIndex }).eq('id', playerId);
        if (error) {
            showToast('Could not update team. Please try again.');
        }
    };

    const handleStartGame = async () => {
        if (categories.length === 0) {
            showToast('Please add at least one category to start the game.');
            return;
        }

        if (polyString && polyString !== '[]' && polyString !== null) {
            try {
                const points = JSON.parse(polyString);
                if (!Array.isArray(points) || points.length < 3) {
                    showToast('Please draw at least 3 points for your game area.');
                    return;
                }
                
                // Geographical Validation
                if (actualStart !== 'open-world' && window.google) {
                    const startCoords = JSON.parse(actualStart);
                    if (!validatePolygon(startCoords.lat, startCoords.lng, polyString)) {
                        showToast('Error: The chosen starting point is outside the game area!');
                        return;
                    }
                }
            } catch (err) {
                console.error(err);
                showToast('Invalid custom area map.');
                return;
            }
        }

        const generateBoards = async (neededCount: number): Promise<boolean> => {
            try {
                if (teamMode === 'teams') {
                    const { data: playersData, error: fetchError } = await supabase
                        .from('players')
                        .select('id, team')
                        .eq('game_id', gameId);

                    if (fetchError || !playersData) throw fetchError;

                    if (bingoBoardMode === 'individual') {
                        const teamBoards = new Map();
                        
                        const promises = playersData.map((player: { id: string; team: number | null }) => {
                            const teamId = player.team || 0;
                            if (!teamBoards.has(teamId)) {
                                teamBoards.set(teamId, shuffle([...categories]).slice(0, neededCount));
                            }
                            const board = teamBoards.get(teamId);

                            return supabase
                                .from('players')
                                .update({ bingo_board: board })
                                .eq('id', player.id);
                        });

                        const results = await Promise.all(promises);
                        if (results.some(r => r.error)) throw results.find(r => r.error)?.error;

                    } else {
                        const sharedBoard = categories.slice(0, neededCount);
                        
                        const { error } = await supabase
                            .from('players')
                            .update({ bingo_board: sharedBoard })
                            .eq('game_id', gameId);
                        
                        if (error) throw error;
                    }
                }
                else if (bingoBoardMode === 'shared') {
                    const board = categories.slice(0, neededCount);
                    const { error } = await supabase
                        .from('players')
                        .update({ bingo_board: board })
                        .eq('game_id', gameId);
                    
                    if (error) throw error;
                } 
                else if (bingoBoardMode === 'individual') {
                    const { data: playersData, error: fetchError } = await supabase
                        .from('players')
                        .select('id')
                        .eq('game_id', gameId);

                    if (fetchError || !playersData) throw fetchError;

                    const promises = playersData.map((player: { id: string }) => {
                        const individualBoard = shuffle([...categories]).slice(0, neededCount);

                        return supabase
                            .from('players')
                            .update({ bingo_board: individualBoard })
                            .eq('id', player.id);
                    });

                    const results = await Promise.all(promises);
                    
                    const firstError = results.find(r => r.error);
                    if (firstError) throw firstError.error;
                }

                return true;
            } catch (err) {
                console.error("Board generation failed:", err);
                return false;
            }
        };

        if (gameMode === 'bingo') {
            const neededCount = gridSize * gridSize;
            if (categories.length < neededCount) {
                showToast(`Please add at least ${neededCount} categories (current: ${categories.length}).`);
                return;
            }
            const success = await generateBoards(neededCount);
            if (!success) return; 
        }
        updateStatus('playing');
    };

    return (
        <div className="min-h-screen flex flex-col items-center p-10 bg-slate-900 text-white relative">
            {renderToast()}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12 hidden sm:flex">
                <GeoBingoLogo size={60} />
                <h1 className="text-6xl font-bold text-indigo-400 tracking-tighter">GEO BINGO</h1>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 w-full max-w-5xl">
      
                {/* Settings (Categories, Time) */}
                <div className="bg-slate-800 p-6 rounded-xl flex-1 border border-slate-700 h-fit">
                    <h2 className="text-xl font-semibold mb-4 text-slate-300">Settings</h2>
        
                    {/* Game Mode Selection */}
                    <div className="mb-2 flex bg-slate-900 rounded-lg p-1">
                        <button 
                            onClick={() => updateGameModeInfo({ game_mode: 'list' })}
                            disabled={!isHost}
                            className={`flex-1 py-2 rounded-md font-bold transition-all ${gameMode === 'list' ? (isHost ? 'bg-indigo-600' : 'bg-slate-600') + ' text-white shadow' : 'text-slate-400 hover:text-white'}`}
                        >
                            List
                        </button>
                        <button 
                            onClick={() => updateGameModeInfo({ game_mode: 'bingo' })}
                            disabled={!isHost}
                            className={`flex-1 py-2 rounded-md font-bold transition-all ${gameMode === 'bingo' ? (isHost ? 'bg-indigo-600' : 'bg-slate-600') + ' text-white shadow' : 'text-slate-400 hover:text-white'}`}
                        >
                            Bingo Grid
                        </button>
                    </div>

                    {/* Team Mode Selection */}
                    <div className="mb-2 flex bg-slate-900 rounded-lg p-1">
                        <button 
                            onClick={() => updateGameModeInfo({ team_mode: 'ffa' })}
                            disabled={!isHost}
                            className={`flex-1 py-2 rounded-md font-bold transition-all text-sm ${teamMode === 'ffa' ? (isHost ? 'bg-indigo-600' : 'bg-slate-600') + ' text-white shadow' : 'text-slate-400 hover:text-white'}`}
                        >
                            All against all
                        </button>
                        <button 
                            onClick={() => updateGameModeInfo({ team_mode: 'teams' })}
                            disabled={!isHost}
                            className={`flex-1 py-2 rounded-md font-bold transition-all text-sm ${teamMode === 'teams' ? (isHost ? 'bg-indigo-600' : 'bg-slate-600') + ' text-white shadow' : 'text-slate-400 hover:text-white'}`}
                        >
                            Teams
                        </button>
                    </div>

                    {gameMode === 'list' && (
                        <p className="mb-6 p-2 pt-0 rounded-lg text-sm text-slate-400">
                            In List mode, players will see a simple list of categories. The game ends when the timer runs out or all players vote to end. Great for quick sessions and smaller groups!
                        </p>
                    )}

                    {gameMode === 'bingo' && (
                        <p className="mb-6 p-2 pt-0 rounded-lg text-sm text-slate-400">
                            In Bingo Grid mode, players receive a grid of categories. Players recieve extra points for completing rows or columns of a length defined by the host. The game ends when the timer runs out or all players vote to end. Perfect for longer sessions and adds a fun strategic layer!
                        </p>
                    )}

                    {gameMode === 'bingo' && (
                        <div className="mb-6 p-4 bg-slate-900 rounded-lg flex flex-col gap-4">
                            <div>
                                <label htmlFor="grid-size-range" className="flex justify-between font-bold mb-2 text-sm cursor-pointer">
                                    <span>Grid Size ({gridSize}x{gridSize})</span>
                                </label>
                                <input 
                                    id="grid-size-range"
                                    title="Adjust the grid size"
                                    type="range" min="2" max="5" step="1" value={gridSize} disabled={!isHost} 
                                    onChange={(e) => updateGameModeInfo({ grid_size: parseInt(e.target.value) })}
                                    className="w-full accent-indigo-500" 
                                />
                            </div>
                            <div>
                                <label className="flex justify-between font-bold mb-2 text-sm">
                                    <span>Bingo Board Mode</span>
                                </label>
                                <div className="flex bg-slate-900 rounded-lg p-1">
                                    <button 
                                        onClick={() => updateGameModeInfo({ bingo_board_mode: 'shared' })}
                                        disabled={!isHost}
                                        className={`flex-1 py-2 text-sm rounded-md font-bold transition-all ${bingoBoardMode === 'shared' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Shared
                                    </button>
                                    <button 
                                        onClick={() => updateGameModeInfo({ bingo_board_mode: 'individual' })}
                                        disabled={!isHost}
                                        className={`flex-1 py-2 text-sm rounded-md font-bold transition-all ${bingoBoardMode === 'individual' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Individual
                                    </button>
                                </div>
                                <p className="mt-2 text-xs text-slate-400 text-center min-h-[16px]">
                                    {bingoBoardMode === 'shared' && 'Same board for all players.'}
                                    {bingoBoardMode === 'individual' && 'Different words and positions for each player.'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Time Slider with proper Accessibility */}
                    <div className="mb-8 p-4 bg-slate-900 rounded-lg">
                        <label htmlFor="time-limit-range" className="flex justify-between font-bold mb-2 cursor-pointer">
                            <span>Time Limit</span>
                            <span className="text-indigo-400">{timeLimit / 60} Minutes</span>
                        </label>
                        <input 
                            id="time-limit-range"
                            type="range" min="1" max="15" step="1"
                            value={timeLimit / 60}
                            disabled={!isHost}
                            onChange={(e) => updateTimeLimit(parseInt(e.target.value))}
                            className="w-full cursor-pointer accent-indigo-500"
                            title="Adjust the game time limit in minutes"
                        />
                        {!isHost && <p className="text-xs text-slate-500 mt-2 italic">Only the host can adjust the time limit.</p>}
                    </div>

                    {/* Integrated Map Area */}
                    <div className="mb-8 p-4 bg-slate-900 rounded-lg border border-slate-800 shadow-inner">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block font-bold cursor-pointer text-slate-200">
                                Starting Location & Game Boundary
                            </label>
                        </div>
                        
                        <p className="mt-2 text-xs text-slate-400 mb-4">
                            Left-click the map to draw movement boundaries. Drop the Pegman to set a custom starting point, or select a recommended city marker. If no starting point is set, players start in the open world.
                        </p>

                        <div className="mt-4 flex flex-col gap-2">
                            <div className="h-[400px] min-h-[400px] w-full rounded-lg overflow-hidden border border-slate-700 relative bg-slate-800/50 flex flex-col items-center justify-center">
                                {!isLoaded && <div className="text-slate-400">Loading map configuration...</div>}
                                {isLoaded && (
                                    <div ref={containerRef} className="absolute inset-0 w-full h-full">
                                        <GoogleMap
                                            onLoad={(map) => setMapInstance(map)}
                                            mapContainerStyle={{ width: '100%', height: '100%' }}
                                            center={mapCenter}
                                            zoom={mapZoom}
                                            onClick={(e) => {
                                                if (!isHost || !e.latLng) return;
                                                const newPoint = { lat: e.latLng.lat(), lng: e.latLng.lng() };
                                                const newPoints = insertPoint(newPoint, draftPolygonPoints);
                                                setDraftPolygonPoints(newPoints);
                                                updateGameModeInfo({ gameBoundary: JSON.stringify(newPoints) });
                                            }}
                                            options={mapOptopns}
                                        >
                                            {/* Recommended Markers */}
                                            {RECOMMENDED_STARTS.map(loc => (
                                                <MarkerF
                                                    key={loc.name}
                                                    position={{ lat: loc.lat, lng: loc.lng }}
                                                    onClick={() => isHost && updateGameModeInfo({
                                                        starting_point: `{"lat": ${loc.lat}, "lng": ${loc.lng}}`,
                                                        gameBoundary: JSON.stringify(draftPolygonPoints)
                                                    })}
                                                    onMouseOver={() => setHoveredLocation({ lat: loc.lat, lng: loc.lng })}
                                                    onMouseOut={() => setHoveredLocation(null)}
                                                    options={{
                                                        opacity: actualStart === loc.name ? 1 : 0.4,
                                                        icon: {
                                                            path: window.google ? google.maps.SymbolPath.CIRCLE : 0,
                                                            scale: 7,
                                                            fillColor: actualStart === loc.name ? '#4f46e5' : '#ffffff',
                                                            fillOpacity: 1,
                                                            strokeColor: '#4f46e5',
                                                            strokeWeight: 2,
                                                        }
                                                    }}
                                                />
                                            ))}

                                            {/* Custom Drop Marker */}
                                            {actualStart.startsWith('{') && (
                                                <MarkerF
                                                    position={JSON.parse(actualStart)}
                                                    onMouseOver={() => setHoveredLocation(JSON.parse(actualStart))}
                                                    onMouseOut={() => setHoveredLocation(null)}
                                                    options={{
                                                        icon: {
                                                            path: window.google ? google.maps.SymbolPath.CIRCLE : 0,
                                                            scale: 8,
                                                            fillColor: '#10b981',
                                                            fillOpacity: 1,
                                                            strokeColor: '#059669',
                                                            strokeWeight: 2,
                                                        }
                                                    }}
                                                />
                                            )}

                                            {/* Hover Preview Box */}
                                            {hoveredLocation && (
                                                <InfoWindowF 
                                                    position={hoveredLocation} 
                                                    options={{ 
                                                        disableAutoPan: true,
                                                        // Offset the box 40 pixels up so it doesn't cover the marker
                                                        pixelOffset: window.google ? new window.google.maps.Size(0, -40) : undefined
                                                    }}
                                                >
                                                    {/* pointer-events-none prevents the box from stealing mouse focus */}
                                                    <div className="p-1 pointer-events-none">
                                                        <img
                                                            src={`https://maps.googleapis.com/maps/api/streetview?size=240x120&location=${hoveredLocation.lat},${hoveredLocation.lng}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`}
                                                            alt="Street View Preview"
                                                            className="w-[240px] h-[120px] rounded object-cover"
                                                        />
                                                    </div>
                                                </InfoWindowF>
                                            )}

                                            {draftPolygonPoints.length > 0 && (
                                                <PolygonF
                                                    paths={draftPolygonPoints}
                                                    options={{
                                                        fillColor: '#6366f1',
                                                        fillOpacity: 0.35,
                                                        strokeColor: '#4f46e5',
                                                        strokeOpacity: 0.8,
                                                        strokeWeight: 2,
                                                        clickable: false,
                                                    }}
                                                />
                                            )}
                                            {draftPolygonPoints.map((point, idx) => (
                                                <MarkerF
                                                    key={`poly-${idx}`}
                                                    position={point}
                                                    options={{
                                                        clickable: false,
                                                        icon: {
                                                            path: window.google ? google.maps.SymbolPath.CIRCLE : 0,
                                                            scale: 4,
                                                            fillColor: '#ffffff',
                                                            fillOpacity: 1,
                                                            strokeColor: '#4f46e5',
                                                            strokeWeight: 2,
                                                        }
                                                    }}
                                                />
                                            ))}
                                        </GoogleMap>
                                        <FullscreenButton isFullscreen={isFullscreen} containerRef={containerRef} setIsFullscreen={setIsFullscreen} />
                                    </div>
                                )}
                            </div>
                            
                            {isHost && (
                                <div className="flex flex-col sm:flex-row justify-between items-center w-full text-sm text-slate-400 gap-2 mt-2">
                                    {/* Left Side: Reset Start Point */}
                                    <button
                                        onClick={() => updateGameModeInfo({ starting_point: 'open-world' })}
                                        disabled={actualStart === 'open-world'}
                                        className="px-3 py-1 bg-indigo-900 border border-indigo-700 hover:bg-indigo-800 text-slate-200 rounded flex gap-2 items-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:border-slate-700 disabled:text-slate-500"
                                    >
                                        Reset Start
                                    </button>

                                    {/* Right Side: Game Boundary Controls */}
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => {
                                                const newPoints = draftPolygonPoints.slice(0, -1);
                                                setDraftPolygonPoints(newPoints);
                                                updateGameModeInfo({ gameBoundary: JSON.stringify(newPoints) });
                                            }}
                                            disabled={draftPolygonPoints.length === 0}
                                            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex gap-2 items-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700"
                                        >
                                            <FaUndo /> Undo Point
                                        </button>
                                        <button 
                                            onClick={() => {
                                                setDraftPolygonPoints([]);
                                                updateGameModeInfo({ gameBoundary: '[]' });
                                            }}
                                            disabled={draftPolygonPoints.length === 0}
                                            className="px-3 py-1 bg-rose-900 border border-rose-700 hover:bg-rose-800 text-slate-200 rounded flex gap-2 items-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Reset Area
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <h3 className="text-xl font-bold mb-2 text-slate-300 flex justify-between items-center">
                        <span>Categories</span>
                        <div className="flex gap-2 items-center">
                            <span className={`text-sm font-normal ${categories.length === 0 || (gameMode === 'bingo' && categories.length < gridSize * gridSize) ? 'text-red-400' : 'text-slate-400'} bg-slate-900 px-3 py-1 rounded-full`}>
                                {gameMode === 'bingo' && bingoBoardMode === 'shared' ? `${Math.min(categories.length, gridSize * gridSize)} / ${gridSize * gridSize}` : `${categories.length} Words`}
                            </span>
                            {isHost && (
                                <button 
                                    onClick={clearCategories}
                                    className="text-xs font-bold text-slate-400 bg-slate-800 hover:bg-slate-700 hover:text-white px-3 py-1 rounded-full ml-1"
                                    title="Clear all categories"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </h3>

                    {gameMode === 'bingo' && bingoBoardMode === 'shared' ? (
                        <div 
                            className={`grid gap-3 mb-6 bingo-grid-${gridSize}`}
                        >
                            {Array.from({ length: Math.max(gridSize * gridSize, categories.length) }).map((_, i) => {
                                const cat = categories[i];
                                const isDragging = draggedIndex === i;
                                return (
                                    <div 
                                        key={i} 
                                        className={`relative flex items-center justify-center p-2 rounded-lg border text-center ${getSidebarTextSizeClass()} min-h-[60px] [hyphens:auto] [hyphenate-character:'-'] break-all  transition-all
                    ${cat ? 'bg-slate-700 border-slate-600' : 'bg-slate-800/50 border-dashed border-slate-600/50 text-slate-500'}
                    ${isHost && cat ? 'cursor-grab active:cursor-grabbing hover:bg-slate-600' : ''}
                    ${isHost && !cat ? 'cursor-default' : ''}
                    ${isDragging ? 'opacity-50 scale-95 border-indigo-500' : ''}
                    ${i >= gridSize * gridSize ? 'hidden' : ''}
                  `}
                                        draggable={isHost && !!cat}
                                        onDragStart={(e) => handleDragStart(e, i)}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, i)}
                                    >
                                        {cat ? (
                                            <>
                                                <span className="italic">{cat}</span>
                                                {isHost && (
                                                    <button 
                                                        onClick={() => removeCategory(cat)} 
                                                        className="absolute top-1 right-1 text-red-400 hover:text-red-300 font-bold p-0.5 rounded-full bg-slate-800 hover:bg-slate-700 transition-opacity"
                                                        title="Remove word"
                                                    >
                                                        <FaTimes />
                                                    </button>
                                                )}
                                            </>
                                        ) : (
                                            <span>Empty</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <ul className="mb-4 space-y-2">
                            {categories.map((cat, i) => {
                                return (
                                    <li 
                                        key={i} 
                                        className={`bg-slate-700 p-3 rounded-lg flex justify-between items-center border border-slate-600 italic transition-all
                  `}
                                    >
                                        <span>{cat}</span>
                                        {isHost && (
                                            <button onClick={() => removeCategory(cat)} className="text-red-400 hover:text-red-300 font-bold rounded-full bg-slate-800 hover:bg-slate-700 p-2" title="Remove word">
                                                <FaTimes />
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {isHost && (
                        <>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    ref={categoryInputRef}
                                    value={newCategory} 
                                    onChange={(e) => setNewCategory(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            addCategory();
                                        }
                                    }}
                                    placeholder="Custom category..."
                                    className="flex-1 p-3 rounded-lg bg-slate-900 border border-slate-600 text-white outline-none focus:border-indigo-500"
                                />
                                <button onClick={addCategory} className="bg-indigo-600 hover:bg-indigo-500 px-6 rounded-lg font-bold">Add</button>
                            </div>
            
                            <div className="flex gap-3 mt-4 bg-slate-700/40 p-4 rounded-xl border border-slate-600">
                                <div className="flex flex-col gap-1 w-13">
                                    <label htmlFor="random-count" className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Count</label>
                                    <input 
                                        id="random-count"
                                        type="text" 
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={randomCount} 
                                        onChange={e => {
                                            const val = e.target.value.replace(/[^0-9]/g, '');
                                            if (val === '') setRandomCount('');
                                            else setRandomCount(Number(val));
                                        }}
                                        className="h-[42px] px-2 rounded-lg bg-slate-900 border border-slate-600 text-white outline-none text-center font-bold"
                                        title="Number of random words"
                                    />
                                </div>
                                <div className="flex flex-col gap-1 flex-1">
                                    <label htmlFor="random-lang" className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Language</label>
                                    <select 
                                        id="random-lang"
                                        value={randomLang} 
                                        onChange={e => setRandomLang(e.target.value as 'german' | 'english')}
                                        className="h-[42px] px-2 rounded-lg bg-slate-900 border border-slate-600 text-white outline-none font-bold cursor-pointer"
                                        title="Language for random words"
                                    >
                                        <option value="german">German</option>
                                        <option value="english">English</option>
                                    </select>
                                </div>
                                <div className="flex flex-col justify-end">
                                    <button 
                                        onClick={addRandomCategories} 
                                        className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg font-bold h-[42px] whitespace-nowrap shadow-md transition-all tracking-wider"
                                    >
                                        <span className="hidden sm:inline">Add Random</span>
                                        <span className="sm:hidden">+</span>
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="flex flex-col gap-6 w-full lg:w-80">
                    {/* Invite Box */}
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 h-fit">
                        <h2 className="text-xl font-semibold mb-4 text-slate-300">Invite Friends</h2>
          
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 p-2 rounded-lg">
                                <span className="text-sm font-bold text-slate-400 w-12 tracking-widest">ID:</span>
                                <span className="flex-1 font-mono text-slate-300 text-lg">{gameId}</span>
                                <button 
                                    onClick={handleCopyGameId}
                                    className={`
                  p-2 rounded-md outline-none
                  transition-all duration-300 ease-in-out
                  ${copied ? 'bg-green-600/40 text-green-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-400'}
                `}
                                    title="Copy Code"
                                >
                                    {copied ? <FaCopy /> : <FaRegCopy />}
                                </button>
                            </div>
            
                            <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 p-2 rounded-lg">
                                <span className="text-sm font-bold text-slate-400 w-12 tracking-widest">Link:</span>
                                <span className="flex-1 font-mono text-slate-300 truncate">{currentLink || '...'}</span>
                                <button 
                                    onClick={handleCopyGameLink}
                                    className={`
                  p-2 rounded-md outline-none
                  transition-all duration-300 ease-in-out
                  ${copiedLink ? 'bg-green-600/40 text-green-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-400'}
                `}
                                    title="Copy Link"
                                >
                                    {copiedLink ? <FaCopy /> : <FaRegCopy />}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Player List */}
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 h-fit">
                        <h2 className="text-xl font-semibold mb-4 text-slate-300">Players ({players.length})</h2>
                        <ul className="space-y-3">
                            {players.map(p => (
                                <li key={p.id} className="flex flex-col gap-2 bg-slate-900 p-3 rounded-lg border border-slate-700">
                                    <div className="flex items-center gap-3">
                                        <div 
                                            className={`min-w-[8px] h-2 rounded-full animate-pulse ${onlinePlayers.includes(p.id) ? 'bg-green-500' : 'bg-orange-500'}`}
                                            title={onlinePlayers.includes(p.id) ? 'Online' : 'Verbindung verloren'}
                                        ></div>
                                        <div className="flex-1 min-w-0 flex items-center gap-2">
                                            {p.id === playerId ? (
                                                <>
                                                    {isEditingSelfName ? (
                                                        <>
                                                            <input
                                                                ref={selfNameInputRef as React.RefObject<HTMLInputElement>}
                                                                type="text"
                                                                value={selfNameInput}
                                                                onChange={(e) => setSelfNameInput(e.target.value)}
                                                                readOnly={!isEditingSelfName}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        void saveSelfName();
                                                                    }
                                                                    if (e.key === 'Escape') {
                                                                        setSelfNameInput(p.name);
                                                                        setIsEditingSelfName(false);
                                                                    }
                                                                }}
                                                                onBlur={() => {
                                                                    if (isEditingSelfName) {
                                                                        void saveSelfName();
                                                                    }
                                                                }}
                                                                className="flex-1 min-w-0 truncate bg-transparent border-b border-indigo-400 text-white outline-none"
                                                                title="Your player name"
                                                            />
                                                        </>
                                                    ) : (
                                                        <span className="flex-1 truncate text-green-400">
                                                            {p.name} {p.id === gameHostId ? '(Host)' : ''}
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="flex-1 truncate text-white">
                                                    {p.name} {p.id === gameHostId ? '(Host)' : ''}
                                                </span>
                                            )}
                                            {p.id === playerId && (
                                                <button
                                                    type="button"
                                                    onClick={handleRenameSelf}
                                                    className="text-slate-400 hover:text-white transition-colors p-1 rounded"
                                                    title={isEditingSelfName ? 'Save name' : 'Edit name'}
                                                >
                                                    <FaRegEdit className="text-xs" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {teamMode === 'teams' && (
                                        <div className="flex items-center justify-between mt-1 border-t border-slate-800 pt-2 pb-1">
                                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Team</span>
                                            {p.id === playerId ? (
                                                <div className="flex gap-2">
                                                    {teamColors.map((color, idx) => (
                                                        <button 
                                                            key={idx} 
                                                            onClick={() => handleUpdateSelfTeam(idx)} 
                                                            className={`w-5 h-5 rounded-full border-2 transition-all shadow-sm ${color} ${(p.team || 0) === idx ? 'border-white opacity-100 scale-110' : 'border-slate-800 opacity-40 hover:opacity-100 hover:scale-110'}`} 
                                                            title={teamNames[idx]}
                                                        />
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className={`text-[10px] px-2 py-0.5 rounded text-white shadow-sm font-bold ${teamColors[p.team || 0]}`}>
                                                    {teamNames[p.team || 0]}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {isHost && p.id !== playerId && (
                                        <div className="flex gap-2 w-full mt-1 border-t border-slate-800 pt-2">
                                            <button 
                                                onClick={() => makeHost(p.id)} 
                                                className="text-xs flex-[2] justify-center bg-indigo-900/50 text-indigo-400 hover:bg-indigo-600 hover:text-white px-3 py-2 sm:py-1 rounded transition-colors"
                                                title="Transfer host privileges to this player"
                                            >
                                                Make Host
                                            </button>
                                            <button 
                                                onClick={() => kickPlayer(p.id)} 
                                                className="text-xs flex-1 justify-center bg-orange-900/50 text-orange-400 hover:bg-orange-600 hover:text-white px-3 py-2 sm:py-1 rounded transition-colors"
                                                title="Remove player (can rejoin)"
                                            >
                                                Kick
                                            </button>
                                            <button 
                                                onClick={() => banPlayer(p.id)} 
                                                className="text-xs flex-1 justify-center bg-red-900/50 text-red-400 hover:bg-red-600 hover:text-white px-3 py-2 sm:py-1 rounded transition-colors"
                                                title="Ban player (permanent kick)"
                                            >
                                                Ban
                                            </button>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>

                        {isHost ? (
                            <button 
                                onClick={handleStartGame} 
                                disabled={categories.length === 0}
                                className={`w-full py-4 rounded-xl font-bold mt-8 tracking-wider uppercase ${categories.length === 0 ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500'}`}
                            >
                                START GAME
                            </button>
                        ) : (
                            <div className="w-full bg-slate-700 text-slate-400 text-center py-4 rounded-xl font-bold mt-8 uppercase">
                                Waiting for host...
                            </div>
                        )}
        
                        <button 
                            onClick={handleLeaveLobby}
                            className="w-full py-3 rounded-xl font-bold mt-3 border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                        >
                            LEAVE LOBBY
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
