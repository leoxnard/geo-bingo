'use client';


import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleMap, useJsApiLoader, StreetViewPanorama, Polygon } from '@react-google-maps/api';
import { supabase } from '../lib/supabase';
import { FaEye, FaCamera } from 'react-icons/fa';

import { Submission, StreetViewProps } from './utils/types';
import { FullscreenButton, GeoBingoLogo } from './utils/Elements';
import { calculateBingoCounter } from './utils/Functions';
import { mapOptions, GOOGLE_MAPS_LIBRARIES } from './utils/mapUtils';

const additionalMapOptions = {
    styles: ""
}

const safeStartCenter = { lat:30, lng: 10 };
const initialWorldZoom = 2.4;

const panoOptions = { 
    addressControl: false, 
    showRoadLabels: false, 
    enableCloseButton: false, 
    fullscreenControl: false,
    zoomControl: false,
    panControl: false,
    linksControl: false,
};


export default function StreetView({ 
    myBoard,
    gameId,
    playerId,
    gameMode = 'list',
    teamMode = 'ffa',
    gridSize = 3,
    startingPoint = 'open-world',
    gameBoundary = null,
    endCondition = 'timer',
    renderToast,
    showToast,
    timeLeft,
    readyPlayers,
    players
}: StreetViewProps) {

    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries: GOOGLE_MAPS_LIBRARIES,
    });

  
    const [submittingCategory, setSubmittingCategory] = useState<string | null>(null);
    const [inStreetView, setInStreetView] = useState(false); 
    const [mySubmissions, setMySubmissions] = useState<Submission[]>([]);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isMobileLandscape, setIsMobileLandscape] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(max-width: 932px) and (orientation: landscape)').matches;
    });
  
    const streetViewRef = useRef<google.maps.StreetViewPanorama | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const lastValidPositionRef = useRef<google.maps.LatLng | null>(null);
    const customPolygonRef = useRef<google.maps.Polygon | null>(null);

    const hasVotedToEnd = readyPlayers.includes(playerId);
    const votesNeeded = players.length; // All players

    // Format the time for display
    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleVoteEndRound = async () => {
        const updatedReadyPlayers = [...readyPlayers, playerId];
        const votesNeeded = players.length;

        try {
            if (updatedReadyPlayers.length >= votesNeeded) {
                await supabase.from('games').update({ 
                    ready_players: updatedReadyPlayers, 
                    status: 'voting' 
                }).eq('id', gameId);
            } else {
                await supabase.from('games').update({ ready_players: updatedReadyPlayers }).eq('id', gameId);
            }
        } catch (error) {
            console.error("Failed to vote:", error);
        }
    };

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    useEffect(() => {
        const mql = window.matchMedia('(max-width: 932px) and (orientation: landscape)');
        const onChange = (e: MediaQueryListEvent) => setIsMobileLandscape(e.matches);

        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);

    useEffect(() => {
        const myTeam = players.find(p => p.id === playerId)?.team ?? -1;
        const teamIds = teamMode === 'teams' ? players.filter(p => p.team === myTeam).map(p => p.id) : [playerId];

        const fetchMySubmissions = async () => {
            const { data } = await supabase.from('submissions').select('*').eq('game_id', gameId).in('player_id', teamIds);
            if (data) setMySubmissions(data);
        };
        fetchMySubmissions();

        const channel = supabase.channel(`team-submissions-${gameId}-${playerId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submissions', filter: `game_id=eq.${gameId}` }, 
                (payload) => {
                    const newSub = payload.new as Submission;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if (teamIds.includes((newSub as any).player_id)) {
                        setMySubmissions(prev => {
                            if (prev.find(s => s.id === newSub.id)) return prev;
                            return [...prev, newSub];
                        });
                    }
                }
            )
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `game_id=eq.${gameId}` }, 
                (payload) => {
                    const updatedSub = payload.new as Submission;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if (teamIds.includes((updatedSub as any).player_id)) {
                        setMySubmissions(prev => prev.map(s => s.id === updatedSub.id ? { ...s, ...updatedSub } : s));
                    }
                }
            ).subscribe();

        return () => { 
            const cleanup = async () => {
                await supabase.removeChannel(channel);
            };
            cleanup();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameId, playerId, teamMode, players.length]);

    // useCallback prevents infinite loop spamming Google API!
    const onLoad = useCallback((pano: google.maps.StreetViewPanorama) => {
        streetViewRef.current = pano;
    
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pano.setOptions({ source: google.maps.StreetViewSource.GOOGLE } as any);

        if (startingPoint === 'open-world') {
            // pano.setPosition(safeStartCenter);
            // The customPolygonRef parsing was removed from here
        } else {
            const parsedStart = JSON.parse(startingPoint) as { lat: number; lng: number };
            const googleStartingPoint = new google.maps.LatLng(parsedStart.lat, parsedStart.lng);
            pano.setPosition(googleStartingPoint);
            pano.setVisible(true);
            setInStreetView(true);
            lastValidPositionRef.current = new google.maps.LatLng(parsedStart.lat, parsedStart.lng);
        }

        pano.addListener('position_changed', () => {
            const pos = pano.getPosition();
            if (!pos) return;
            
            // Revert movement if outside custom boundary!
            if (customPolygonRef.current) {
                if (google.maps.geometry.poly.containsLocation(pos, customPolygonRef.current)) {
                    lastValidPositionRef.current = pos;
                } else if (lastValidPositionRef.current) {
                    showToast("You've reached the edge of the allowed area!");
                    pano.setPosition(lastValidPositionRef.current);
                } else {
                    showToast("Please stay within the designated area!");
                    pano.setVisible(false); // Drop blocked
                }
            }
        });

        pano.addListener('visible_changed', () => {
            const isVisible = pano.getVisible();
            setInStreetView(isVisible);
            if (!isVisible) {
                lastValidPositionRef.current = null;
            }
        });
    }, [startingPoint, showToast]);

    const onUnmount = useCallback(() => {
        if (streetViewRef.current) {
            google.maps.event.clearInstanceListeners(streetViewRef.current);
            streetViewRef.current.setVisible(false);
            streetViewRef.current = null;
        }
    }, []);

    const handleSubmit = async (targetCategory: string) => {
        if (!streetViewRef.current || !inStreetView) return;
        setSubmittingCategory(targetCategory);
        const position = streetViewRef.current.getPosition();
        const pov = streetViewRef.current.getPov();
        if (!position) { setSubmittingCategory(null); return; }

        const submissionData = {
            game_id: gameId, player_id: playerId, category: targetCategory,
            lat: parseFloat(position.lat().toFixed(6)), lng: parseFloat(position.lng().toFixed(6)),
            heading: parseFloat(pov.heading.toFixed(2)), pitch: parseFloat(pov.pitch.toFixed(2)),
            zoom: streetViewRef.current.getZoom() || 1
        };

        let updatedSubmissions = [...mySubmissions];

        const existingSub = mySubmissions.find(s => s.category === targetCategory);
        if (existingSub) {
            await supabase.from('submissions').update(submissionData).eq('id', existingSub.id);
            updatedSubmissions = updatedSubmissions.map(s => s.id === existingSub.id ? { ...s, ...submissionData } : s);
            setMySubmissions(updatedSubmissions);
        } else {
            const { data } = await supabase.from('submissions').insert([submissionData]).select().single();
            if (data) {
                updatedSubmissions = [...updatedSubmissions, data];
                setMySubmissions(updatedSubmissions);
            }
        }
        setSubmittingCategory(null);
        console.log(gameMode, endCondition, gridSize, myBoard, updatedSubmissions);

        if (gameMode === 'bingo' && endCondition === 'first_bingo') {
            const bingos = calculateBingoCounter(gridSize, myBoard, updatedSubmissions);
            console.log('gridSize:', gridSize, 'myBoard:', myBoard, 'updatedSubs:', updatedSubmissions, 'bingos:', bingos);
            
            if (bingos.count > 0) {
                const winnerNames = players.filter(p => bingos.players.includes(p.id)).map(p => p.name);
                let winnerNamesString;
                if (winnerNames.length > 2) {
                    winnerNamesString = [winnerNames.slice(0, -1).join(', '), winnerNames.slice(-1)[0]].join(' and ');
                } else if (winnerNames.length === 2) {
                    winnerNamesString = winnerNames.join(' and ');
                } else {
                    winnerNamesString = winnerNames[0];
                }
                showToast(`${winnerNamesString} got Bingo!`);
                try {
                    await supabase.from('games').update({ status: 'voting' }).eq('id', gameId);
                } catch (error) {
                    console.error("Failed to end game on Bingo:", error);
                }
            }
        }
    };

    const jumpToLocation = (sub: Submission) => {
        if (!streetViewRef.current) return;
        streetViewRef.current.setPosition({ lat: sub.lat, lng: sub.lng });
        streetViewRef.current.setPov({ heading: sub.heading, pitch: sub.pitch });
        streetViewRef.current.setZoom(sub.zoom);
        streetViewRef.current.setVisible(true);
        setInStreetView(true);
    };

    const handleBingoTileClick = (cat: string) => {
        // On Mobile/small screens, tapping the full tile submits/overwrites.
        if (window.matchMedia('(max-width: 639px)').matches) {
            handleSubmit(cat);
        }
    };

    const parsedStartParams = useMemo(() => {
        // Default to open-world center if parsing fails, but still try to parse for potential poly gameBoundarys
        const polyString = gameBoundary || '';
        let polyPoints: google.maps.LatLngLiteral[] | null = null;
        let polyCenter = null;
        let polyZoom = null;
        
        if (polyString && polyString !== '[]' && polyString !== 'null') {
            try {
                polyPoints = JSON.parse(polyString);
                if (Array.isArray(polyPoints) && polyPoints.length >= 3) {
                    let minX = polyPoints[0].lat, maxX = polyPoints[0].lat;
                    let minY = polyPoints[0].lng, maxY = polyPoints[0].lng;
                    for (let i = 1; i < polyPoints.length; i++) {
                        if (polyPoints[i].lat < minX) minX = polyPoints[i].lat;
                        if (polyPoints[i].lat > maxX) maxX = polyPoints[i].lat;
                        if (polyPoints[i].lng < minY) minY = polyPoints[i].lng;
                        if (polyPoints[i].lng > maxY) maxY = polyPoints[i].lng;
                    }
                    polyCenter = { lat: (minX + maxX)/2, lng: (minY + maxY)/2 };
                    
                    const latDiff = maxX - minX;
                    const lngDiff = maxY - minY;
                    const maxDiff = Math.max(latDiff, lngDiff);
                    const calculatedZoom = maxDiff > 0 ? Math.floor(Math.log2(360 / maxDiff)) + 1 : initialWorldZoom;
                    polyZoom = Math.min(Math.max(calculatedZoom, 1), 18);
                }
            } catch (e) {
                console.error("Error parsing gameBoundary:", e);
            }
        }
        return { polyPoints, polyCenter, polyZoom };
    }, [gameBoundary]);

    const { polyPoints, polyCenter, polyZoom } = parsedStartParams;

    useEffect(() => {
        if (isLoaded && polyPoints && polyPoints.length >= 3) {
            customPolygonRef.current = new google.maps.Polygon({ paths: polyPoints });
        } else {
            customPolygonRef.current = null;
        }
    }, [isLoaded, polyPoints]);

    const mapCenter = useMemo(() => {
        // If open world and we have a custom restricted area, center on the area
        if (startingPoint === 'open-world' && polyCenter) return polyCenter;
        
        // Otherwise, default to the safe start center
        return safeStartCenter;
    }, [polyCenter, startingPoint]);

    const mapZoom = useMemo(() => {
        // If open world and we have a custom restricted area, zoom to fit the area
        if (startingPoint === 'open-world' && polyZoom !== null) return polyZoom;
        
        // Otherwise, default to a safe integer zoom level
        return 2; 
    }, [polyZoom, startingPoint]);


    if (!isLoaded) return <div className="h-screen flex items-center justify-center text-indigo-400">Loading Maps...</div>;

    // Dynamically size sidebar to avoid Tailwind JIT compiling issues
    const getSidebarWidthClass = () => {
        if (gameMode !== 'bingo') return 'lg:w-96';
        switch (gridSize) {
        case 2: return 'lg:w-[400px]';
        case 3: return 'lg:w-[500px]';
        case 4: return 'lg:w-[600px]';
        case 5: return 'lg:w-[700px]';
        default: return 'lg:w-[400px]';
        }
    };

    const getSidebarTextSizeClass = () => {
        if (gameMode !== 'bingo') return '';
        switch (gridSize) {
        case 2: return 'text-base sm:text-xl';
        case 3: return 'text-xs sm:text-xl';
        case 4: return 'text-[10px] sm:text-base';
        case 5: return 'text-[8px] sm:text-sm';
        default: return 'text-xs sm:text-xl';
        }
    };


    return (
        <div className="min-h-screen p-4 bg-slate-900">
            {renderToast()}
            <div className="flex justify-between items-center mb-4 w-full max-w-[95%] xl:max-w-[90vw] mx-auto text-white">
                <div className="flex items-center gap-4 hidden sm:flex">
                    <GeoBingoLogo size={40} />
                    <h1 className="text-2xl font-bold text-indigo-400">Hunt in Progress</h1>
                </div>
        
                <div className="flex items-stretch gap-3 sm:gap-6 w-full sm:w-auto">
                    {/* Timer Display */}
                    <div className="flex items-center justify-center text-xl sm:text-3xl font-black bg-slate-800 px-3 sm:px-6 rounded-lg sm:rounded-xl border border-slate-700 shadow-lg tracking-wider py-1.5 sm:py-2">
                        {timeLeft <= 60 ? (
                            <span className="text-red-500 animate-pulse">{formatTime(timeLeft)}</span>
                        ) : (
                            <span className="text-white">{formatTime(timeLeft)}</span>
                        )}
                    </div>
        
                    <div className="ml-auto flex items-stretch justify-end gap-2 sm:gap-4">
                        <span className="flex items-center text-slate-400 font-medium">
                            Votes to end:&nbsp;<strong className="text-white">{readyPlayers.length} / {votesNeeded}</strong>
                        </span>
                        <button type="button" 
                            onClick={handleVoteEndRound}
                            disabled={hasVotedToEnd}
                            className={`flex items-center justify-center whitespace-nowrap px-3 sm:px-6 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-sm shadow-lg
                ${hasVotedToEnd ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500 text-white'}`}
                        >
                            {hasVotedToEnd ? 'Wait...' : 'End Vote'}
                        </button>
                    </div>
                </div>
            </div>
    
            <div className="w-full max-w-[95%] xl:max-w-[90vw] mx-auto">
                {playerId && (
                    <div className={`flex gap-6 ${isMobileLandscape ? 'flex-row h-[calc(100dvh-7rem)] min-h-0' : 'flex-col lg:flex-row h-[calc(100vh-8rem)] min-h-[600px]'}`}>
                        <div ref={containerRef} className={`${isMobileLandscape ? 'basis-[58%] min-h-0 h-full' : 'flex-1 min-h-[400px] h-full'} border-4 border-slate-700 rounded-2xl overflow-hidden shadow-2xl relative bg-slate-800 absolute-safari-fix`}>
                            <GoogleMap 
                                key={gameId} 
                                mapContainerClassName="google-map-container absolute inset-0"
                                center={mapCenter}
                                zoom={mapZoom}
                                options={mapOptions(additionalMapOptions)}
                            >
                                {/* Draw custom boundary polygon if provided */}
                                {polyPoints && (
                                    <Polygon
                                        paths={polyPoints}
                                        options={{
                                            fillColor: '#ef4444',
                                            fillOpacity: 0.1,
                                            strokeColor: '#ef4444',
                                            strokeOpacity: 0.8,
                                            strokeWeight: 2,
                                            clickable: false
                                        }}
                                    />
                                )}
                                {/* Safely pass onLoad and onUnmount */}
                                <StreetViewPanorama options={panoOptions} onLoad={onLoad} onUnmount={onUnmount} />
                            </GoogleMap>

                            {/* Custom Fullscreen Button */}
                            {!isMobileLandscape && (
                                <FullscreenButton isFullscreen={isFullscreen} containerRef={containerRef} setIsFullscreen={setIsFullscreen} />
                            )}

                            {inStreetView && startingPoint === 'open-world' && (
                                <button
                                    type="button"
                                    onClick={() => streetViewRef.current?.setVisible(false)}
                                    className="absolute top-2 left-2 z-[1000] w-12 h-12 bg-red-500/30 hover:bg-red-500/80 text-white flex items-center justify-center rounded-md shadow-[0_0_15px_rgba(0,0,0,0.4)] border border-red-400 font-bold text-2xl transition-transform hover:scale-105 active:scale-95"
                                    title="Exit Street View"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        {/* Right: Checklist */}
                        <div className={`${isMobileLandscape ? 'basis-[42%] max-w-[42%]' : `w-full ${getSidebarWidthClass()}`} flex flex-col gap-4 bg-slate-800 p-6 rounded-2xl shadow-xl h-full border border-slate-700 overflow-y-auto transition-all`}>
                            <div className="flex justify-between items-center mb-2 border-b border-slate-700 pb-2 hidden sm:flex">
                                <h2 className="text-indigo-400 font-bold text-xl tracking-wide uppercase">
                                    {gameMode === 'bingo' ? 'Bingo Board' : 'Checklist'}
                                </h2>
                                <span className="bg-slate-700 text-slate-300 font-bold px-3 py-1 rounded-full text-sm">
                                    {mySubmissions.length} / {myBoard.length}
                                </span>
                            </div>
                    
                            {gameMode === 'list' ? (
                                <ul className="flex flex-col gap-3 flex-1">
                                    {myBoard.map((cat) => {
                                        const foundSub = mySubmissions.find(s => s.category === cat);
                                        
                                        return (
                                            <li 
                                                key={cat} 
                                                className={`p-3 rounded-xl border-2 transition-all cursor-pointer flex flex-col gap-2
                                border-slate-600 bg-slate-800 hover:bg-slate-700`}
                                            >
                                                <div className="flex justify-between items-center w-full">
                                                    <span className={`truncate font-medium flex-1 pr-2 ${foundSub ? 'text-slate-300' : 'text-white'}`}>
                                                        {cat}
                                                    </span>
                                                </div>
                            
                                                <div className="flex justify-between items-center gap-2 mt-1">
                                                    {!foundSub ? (
                                                        <button type="button"
                                                            onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                                                            disabled={submittingCategory === cat || !inStreetView}
                                                            className={`flex-1 text-[11px] px-2 py-2 font-bold rounded shadow uppercase transition-all
                                    ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white'}`}
                                                        >
                                                            {submittingCategory === cat ? 'Saving...' : !inStreetView ? 'Enter Streetview' : 'Save'}
                                                        </button>
                                                    ) : (
                                                        <>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                                                                disabled={submittingCategory === cat || !inStreetView}
                                                                className={`flex-1 text-[10px] px-2 py-2 font-bold rounded shadow uppercase transition-all
                                        ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
                                                            >
                                                                {submittingCategory === cat ? '...' : !inStreetView ? 'Enter SV' : 'Overwrite'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); jumpToLocation(foundSub); }}
                                                                className="flex-[0.5] bg-slate-600 hover:bg-slate-500 text-[10px] px-2 py-2 text-white font-bold rounded shadow uppercase"
                                                            >
                                                                View
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <div className={`grid gap-2 flex-1 auto-rows-fr bingo-grid-${gridSize}`}>
                                    {myBoard.map((cat) => {
                                        const foundSub = mySubmissions.find(s => s.category === cat);
                                        const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
                                        const fov = foundSub?.zoom ? 180 / Math.pow(2, foundSub.zoom) : 90;
                                        const bgStyle = foundSub ? {
                                            backgroundImage: `url(https://maps.googleapis.com/maps/api/streetview?size=400x400&location=${foundSub.lat},${foundSub.lng}&heading=${foundSub.heading}&pitch=${foundSub.pitch}&fov=${fov}&key=${apiKey})`,
                                            backgroundSize: 'cover',
                                            backgroundPosition: 'center',
                                        } : {};

                                        return (
                                            <div 
                                                key={cat} 
                                                title={cat}
                                                style={bgStyle}
                                                onClick={() => handleBingoTileClick(cat)}
                                                className={`relative p-2 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-center items-center text-center overflow-hidden pb-2 sm:pb-12
                                border-slate-600 ${foundSub ? 'text-white border-green-500' : 'bg-slate-800 hover:bg-slate-700'}`}
                                            >
                                                {foundSub && <div className="absolute inset-0 bg-black/40 z-0"></div>}
                                                <span className={`relative z-10 ${getSidebarTextSizeClass()} font-bold leading-tight line-clamp-2 [hyphens:auto] [word-break:break-word] mt-0 sm:mt-1 ${foundSub ? 'drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)]' : 'text-white'}`}>
                                                    {cat}
                                                </span>
                            
                                                <div className="absolute bottom-2 w-[90%] left-[5%] h-[25%] max-h-12 hidden sm:flex flex-row justify-center gap-2 z-10">
                                                    {!foundSub ? (
                                                        <button type="button"
                                                            title="Add submission"
                                                            onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                                                            disabled={submittingCategory === cat || !inStreetView}
                                                            className={`w-full h-full font-bold rounded-lg uppercase transition-all flex justify-center items-center
                                    ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-green-600 hover:bg-green-500 text-white'}`}
                                                        >
                                                            {submittingCategory === cat ? '...' : <FaCamera className="h-[60%] w-auto" />}
                                                        </button>
                                                    ) : (
                                                        <>
                                                            <button
                                                                type="button"
                                                                title="View submission"
                                                                onClick={(e) => { e.stopPropagation(); jumpToLocation(foundSub); }}
                                                                className="hidden sm:flex flex-1 h-full bg-slate-600 hover:bg-slate-500 text-white font-bold rounded-lg uppercase justify-center items-center"
                                                            >
                                                                <FaEye className="h-[60%] w-auto" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                title="Overwrite submission"
                                                                onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                                                                disabled={submittingCategory === cat || !inStreetView}
                                                                className={`flex-1 h-full font-bold rounded-lg uppercase transition-all flex justify-center items-center
                                        ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
                                                            >
                                                                {submittingCategory === cat ? '...' : <FaCamera className="h-[60%] w-auto" />}
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )       
}