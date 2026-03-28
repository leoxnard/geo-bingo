'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import { GoogleMap, useJsApiLoader, StreetViewPanorama, Polygon } from '@react-google-maps/api';
import { FaEye, FaCamera } from 'react-icons/fa';
import { GoMoveToStart } from "react-icons/go";
import toast from 'react-hot-toast';

import { supabase } from '../lib/supabase';
import { FullscreenButton, GeoBingoLogo } from './utils/Elements';
import { calculateBingoCounter } from './utils/Functions';
import { mapOptions, GOOGLE_MAPS_LIBRARIES, isLocationAllowed } from './utils/mapUtils';
import { Submission, StreetViewProps, PathPoint } from './utils/types';

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
    gameBoundary = '[]',
    endCondition = 'timer',
    timeLeft,
    readyPlayers,
    players,
    hideMapSymbols = false,
    exclusiveMode = false,
}: StreetViewProps) {

    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries: GOOGLE_MAPS_LIBRARIES,
    });

  
    const [submittingCategory, setSubmittingCategory] = useState<string | null>(null);
    const [inStreetView, setInStreetView] = useState(false); 
    const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isMobileLandscape, setIsMobileLandscape] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(max-width: 932px) and (orientation: landscape)').matches;
    });
  
    const streetViewRef = useRef<google.maps.StreetViewPanorama | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const lastValidPositionRef = useRef<google.maps.LatLng | null>(null);
    const lastValidPanoRef = useRef<string | null>(null);
    const isRevertingRef = useRef(false);
    const pathRef = useRef<PathPoint[]>([]);
    const lastSavedLengthRef = useRef<number>(0);

    const hasVotedToEnd = readyPlayers.includes(playerId);
    const votesNeeded = players.length;

    const myTeam = useMemo(() => players.find(p => p.id === playerId)?.team ?? -1, [players, playerId]);
    const teamIds = useMemo(() => teamMode === 'teams' ? players.filter(p => p.team === myTeam).map(p => p.id) : [playerId], [teamMode, players, myTeam, playerId]);

    const mySubmissions = useMemo(() => allSubmissions.filter(s => teamIds.includes((s as any).player_id)), [allSubmissions, teamIds]);
    const otherSubmissions = useMemo(() => allSubmissions.filter(s => !teamIds.includes((s as any).player_id)), [allSubmissions, teamIds]);

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

    // --- FETCH ALL SUBMISSIONS FOR EXCLUSIVE MODE ---
    useEffect(() => {
        const fetchAllSubmissions = async () => {
            const { data } = await supabase.from('submissions').select('*').eq('game_id', gameId);
            if (data) setAllSubmissions(data);
        };
        fetchAllSubmissions();

        const channel = supabase.channel(`game-submissions-${gameId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submissions', filter: `game_id=eq.${gameId}` }, 
                (payload) => {
                    const newSub = payload.new as Submission;
                    setAllSubmissions(prev => {
                        if (prev.find(s => s.id === newSub.id)) return prev;
                        return [...prev, newSub];
                    });
                }
            )
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `game_id=eq.${gameId}` }, 
                (payload) => {
                    const updatedSub = payload.new as Submission;
                    setAllSubmissions(prev => prev.map(s => s.id === updatedSub.id ? { ...s, ...updatedSub } : s));
                }
            ).subscribe();

        return () => { 
            const cleanup = async () => {
                await supabase.removeChannel(channel);
            };
            cleanup();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameId]);

    useEffect(() => {
        const saveInterval = setInterval(async () => {
            const currentPath = pathRef.current;
            if (currentPath.length > lastSavedLengthRef.current) {
                const { error } = await supabase.from('players').update({ path: currentPath }).eq('id', playerId);
                if (error) {
                    console.error("SUPABASE ERROR:", error.message, error.details);
                } else {
                    lastSavedLengthRef.current = currentPath.length;
                }
            }
        }, 5000);

        return () => clearInterval(saveInterval);
    }, [playerId]);

    // sound effects for timer
    useEffect(() => {
        if (timeLeft === 61) {
            const alertSound = new Audio('/sounds/ticking.wav');
            alertSound.volume = 0.4;
            alertSound.play().catch(e => console.log("Audio playback failed", e));
        }

        if (timeLeft === 11) {
            const tickSound = new Audio('/sounds/countdown.wav');
            tickSound.volume = 0.3;
            tickSound.play().catch(e => console.log("Audio playback failed", e));
        }
    }, [timeLeft]);

    const additionalMapOptions = useMemo(() => ({
        styles: hideMapSymbols 
            ? [{ featureType: "all", elementType: "labels.icon", stylers: [{ visibility: "off" }] }]
            : []
    }), [hideMapSymbols]);


    const onLoad = useCallback((pano: google.maps.StreetViewPanorama) => {
        streetViewRef.current = pano;
    
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pano.setOptions({ source: google.maps.StreetViewSource.GOOGLE } as any);

        if (startingPoint !== 'open-world') {
            const parsedStart = JSON.parse(startingPoint) as { lat: number; lng: number };
            const googleStartingPoint = new google.maps.LatLng(parsedStart.lat, parsedStart.lng);
            pano.setPosition(googleStartingPoint);
            pano.setVisible(true);
            setInStreetView(true);
            lastValidPositionRef.current = new google.maps.LatLng(parsedStart.lat, parsedStart.lng);
        }

        pano.addListener('position_changed', () => {
            if (isRevertingRef.current) return;

            const pos = pano.getPosition();
            if (!pos) return;

            const lastPoint = pathRef.current[pathRef.current.length - 1];
            if (!lastPoint || lastPoint.lat !== pos.lat() || lastPoint.lng !== pos.lng()) {
                pathRef.current.push({
                    lat: pos.lat(),
                    lng: pos.lng(),
                    timestamp: Date.now()
                });
            }
            
            if (gameBoundary && gameBoundary !== '[]') {
                const currentLoc = { lat: pos.lat(), lng: pos.lng() };
                
                if (isLocationAllowed(currentLoc, gameBoundary)) {
                    lastValidPositionRef.current = pos;
                    lastValidPanoRef.current = pano.getPano();
                } else {
                    isRevertingRef.current = true;
                    toast("You've reached the edge of the allowed area or entered a forbidden zone!");
                    if (lastValidPanoRef.current) {
                        pano.setPano(lastValidPanoRef.current);
                    } else if (lastValidPositionRef.current) {
                        pano.setPosition(lastValidPositionRef.current);
                    } else {
                        pano.setVisible(false);
                    }

                    setTimeout(() => {
                        isRevertingRef.current = false;
                    }, 200);
                }
            }
        });

        pano.addListener('visible_changed', () => {
            const isVisible = pano.getVisible();
            setInStreetView(isVisible);
            if (!isVisible) {
                lastValidPositionRef.current = null;
                lastValidPanoRef.current = null;
            }
        });
    }, [startingPoint, gameBoundary]);

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

        // optimistic update
        const existingSub = mySubmissions.find(s => s.category === targetCategory);

        const tempId = existingSub ? existingSub.id : crypto.randomUUID();
        const optimisticSub = { ...submissionData, id: tempId, votes: existingSub?.votes || {}, is_valid: null } as Submission;

        const updatedAllSubmissions = existingSub 
            ? allSubmissions.map(s => s.id === existingSub.id ? optimisticSub : s)
            : [...allSubmissions, optimisticSub];
        
        const updatedMySubmissions = existingSub
            ? mySubmissions.map(s => s.id === existingSub.id ? optimisticSub : s)
            : [...mySubmissions, optimisticSub];

        setAllSubmissions(updatedAllSubmissions);
        setSubmittingCategory(null);

        if (gameMode === 'bingo' && endCondition === 'first_bingo') {
            const bingos = calculateBingoCounter(gridSize, myBoard, updatedMySubmissions);
            
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
                toast(`${winnerNamesString} got Bingo!`);
                try {
                    await supabase.from('games').update({ status: 'voting' }).eq('id', gameId);
                } catch (error) {
                    console.error("Failed to end game on Bingo:", error);
                }
            }
        }

        if (exclusiveMode && !existingSub) {
            // exclusive mode insert via RPC to ensure atomic claim
            const { data, error } = await supabase.rpc('claim_exclusive_category', {
                p_game_id: gameId,
                p_player_id: playerId,
                p_category: targetCategory,
                p_lat: submissionData.lat,
                p_lng: submissionData.lng,
                p_heading: submissionData.heading,
                p_pitch: submissionData.pitch,
                p_zoom: submissionData.zoom
            });

            if (data && data.success === false && data.error === 'ALREADY_CLAIMED') {
                toast.error("Sorry, someone else was faster claiming this category!");
                setAllSubmissions(prev => prev.filter(s => s.id !== tempId));
            } else if (error) {
                console.error("RPC call failed:", error);
                toast.error("Error saving submission. Please try again.");
                setAllSubmissions(prev => prev.filter(s => s.id !== tempId));
            } else if (data && data.success) {
                setAllSubmissions(prev => prev.map(s => s.id === tempId ? data.data : s));
            }

        } else {
            // ffa update or insert
            if (existingSub) {
                const { error } = await supabase.from('submissions').update(submissionData).eq('id', existingSub.id);
                if (error) {
                    console.error("Update error:", error);
                    toast.error("Error updating submission. Please try again.");
                    setAllSubmissions(prev => prev.filter(s => s.id !== tempId));
                }
            } else {
                const { data, error } = await supabase.from('submissions').insert([submissionData]).select().single();
                if (error) {
                    console.error("Insert error:", error);
                    toast.error("Error saving submission. Please try again.");
                    setAllSubmissions(prev => prev.filter(s => s.id !== tempId));
                } else if (data) {
                    setAllSubmissions(prev => prev.map(s => s.id === tempId ? data : s));
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
        const isBlocked = exclusiveMode && !mySubmissions.find(s => s.category === cat) && otherSubmissions.some(s => s.category === cat);
        if (window.matchMedia('(max-width: 639px)').matches && !isBlocked) {
            handleSubmit(cat);
        }
    };

    const parsedStartParams = useMemo(() => {
        const polyString = gameBoundary || '[]';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let parsedBoundaries: any[] = [];
        let polyCenter = null;
        let polyZoom = null;
        
        if (polyString && polyString !== '[]' && polyString !== 'null') {
            try {
                const parsed = JSON.parse(polyString);
                
                if (Array.isArray(parsed) && parsed.length > 0) {
                    if (parsed[0].lat !== undefined) {
                        parsedBoundaries = [{ id: 'legacy', type: 'allow', points: parsed }];
                    } else {
                        parsedBoundaries = parsed;
                    }

                    const allPoints = parsedBoundaries.flatMap(b => b.points || []);

                    if (allPoints.length >= 3) {
                        let minX = allPoints[0].lat, maxX = allPoints[0].lat;
                        let minY = allPoints[0].lng, maxY = allPoints[0].lng;
                        for (let i = 1; i < allPoints.length; i++) {
                            if (allPoints[i].lat < minX) minX = allPoints[i].lat;
                            if (allPoints[i].lat > maxX) maxX = allPoints[i].lat;
                            if (allPoints[i].lng < minY) minY = allPoints[i].lng;
                            if (allPoints[i].lng > maxY) maxY = allPoints[i].lng;
                        }
                        polyCenter = { lat: (minX + maxX)/2, lng: (minY + maxY)/2 };
                        
                        const latDiff = maxX - minX;
                        const lngDiff = maxY - minY;
                        const maxDiff = Math.max(latDiff, lngDiff);
                        const calculatedZoom = maxDiff > 0 ? Math.floor(Math.log2(360 / maxDiff)) + 1 : initialWorldZoom;
                        polyZoom = Math.min(Math.max(calculatedZoom, 1), 18);
                    }
                }
            } catch (e) {
                console.error("Error parsing gameBoundary:", e);
            }
        }
        return { parsedBoundaries, polyCenter, polyZoom };
    }, [gameBoundary]);

    const { parsedBoundaries, polyCenter, polyZoom } = parsedStartParams;

    const mapCenter = useMemo(() => {
        if (startingPoint === 'open-world' && polyCenter) return polyCenter;
        return safeStartCenter;
    }, [polyCenter, startingPoint]);

    const mapZoom = useMemo(() => {
        if (startingPoint === 'open-world' && polyZoom !== null) return polyZoom;
        return 2; 
    }, [polyZoom, startingPoint]);


    if (!isLoaded) return <div className="h-screen flex items-center justify-center text-indigo-400">Loading Maps...</div>;

    const getSidebarWidthClass = () => {
        if (gameMode !== 'bingo') return 'lg:w-96';
        switch (gridSize) {
        case 2: return 'lg:w-[400px]';
        case 3: return 'lg:w-[500px]';
        case 4: return 'lg:w-[600px]';
        case 5: return 'lg:w-[700px]';
        case 6: return 'lg:w-[800px]';
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
        case 6: return 'text-[7px] sm:text-sm'; 
        default: return 'text-xs sm:text-xl';
        }
    };


    return (
        <div className="min-h-screen p-4 bg-slate-900">
            <div className="flex justify-between items-center mb-4 w-full max-w-[95%] xl:max-w-[90vw] mx-auto text-white">
                <div className="flex items-center gap-4 hidden sm:flex">
                    <GeoBingoLogo size={40} />
                    <h1 className="text-2xl font-bold text-indigo-400">Hunt in Progress</h1>
                </div>
        
                <div className="flex items-stretch gap-3 sm:gap-6 w-full sm:w-auto">
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
                                {parsedBoundaries.map((boundary) => (
                                    boundary.points && boundary.points.length >= 3 && (
                                        <Polygon
                                            key={boundary.id}
                                            paths={boundary.points}
                                            options={{
                                                fillColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                                                fillOpacity: 0.1,
                                                strokeColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                                                strokeOpacity: 0.6,
                                                strokeWeight: 2,
                                                clickable: false
                                            }}
                                        />
                                    )
                                ))}

                                <StreetViewPanorama options={panoOptions} onLoad={onLoad} onUnmount={onUnmount} />
                            </GoogleMap>

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
                            {startingPoint !== 'open-world' && (
                                <button
                                    type="button"
                                    onClick={() => streetViewRef.current?.setPosition(new google.maps.LatLng(startingPoint ? JSON.parse(startingPoint) : safeStartCenter))}
                                    className="absolute top-2 left-2 z-5 hidden sm:flex w-12 h-12 bg-slate-800/30 hover:bg-slate-700/80 text-white text-[30px] items-center justify-center rounded-md shadow-[0_0_15px_rgba(0,0,0,0.4)] border border-slate-500 font-bold transition-transform hover:scale-105 active:scale-95 backdrop-blur-sm"
                                    title="Return to Starting Point"
                                >
                                    <GoMoveToStart />
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
                                        const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some(s => s.category === cat);
                                        
                                        const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
                                        const fov = foundSub?.zoom ? 180 / Math.pow(2, foundSub.zoom) : 90;
                                        
                                        let bgStyle = {};
                                        if (foundSub) {
                                            let safeHeading = foundSub.heading % 360;
                                            if (safeHeading < 0) safeHeading += 360;

                                            bgStyle = {
                                                backgroundImage: `url(https://maps.googleapis.com/maps/api/streetview?size=600x600&location=${foundSub.lat},${foundSub.lng}&heading=${safeHeading}&pitch=${foundSub.pitch}&fov=${fov}&key=${apiKey})`,
                                                backgroundSize: 'cover',
                                                backgroundPosition: 'center center',
                                            };
                                        }

                                        return (
                                            <li 
                                                key={cat} 
                                                style={bgStyle}
                                                className={`relative overflow-hidden p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${foundSub ? 'shadow-md border-slate-600' : isBlocked ? 'bg-slate-900 border-red-500 opacity-60' : 'bg-slate-800 border-slate-600 hover:bg-slate-700/30'}`}
                                            >
                                                {foundSub && <div className="absolute inset-0 bg-black/40 z-0"></div>}

                                                <div className="relative z-10 flex flex-col gap-2">
                                                    <div className="flex justify-between items-center w-full">
                                                        <span className={`truncate font-medium flex-1 pr-2 ${foundSub ? 'text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : isBlocked ? 'text-red-400 line-through' : 'text-white'}`}>
                                                            {cat}
                                                        </span>
                                                        <span className={`text-xs font-bold uppercase whitespace-nowrap ${foundSub ? 'text-green-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : isBlocked ? 'text-red-500' : 'text-slate-500'}`}>
                                                            {foundSub ? 'Found' : isBlocked ? 'Locked' : 'Pending'}
                                                        </span>
                                                    </div>

                                                    <div className="flex justify-between items-center gap-2 mt-1">
                                                        {!foundSub ? (
                                                            <button type="button"
                                                                onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                                                                disabled={submittingCategory === cat || !inStreetView || isBlocked}
                                                                className={`flex-1 text-[11px] px-2 py-2 font-bold rounded shadow uppercase transition-all ${isBlocked ? 'bg-red-900/50 text-red-300 cursor-not-allowed' : !inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600/30 hover:bg-green-500/30 text-white'}`}
                                                            >
                                                                {submittingCategory === cat ? 'Saving...' : isBlocked ? 'Claimed' : !inStreetView ? 'Enter Streetview' : 'Save'}
                                                            </button>
                                                        ) : (
                                                            <>
                                                                {/* Added check for !exclusiveMode here */}
                                                                {!exclusiveMode && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                                                                        disabled={submittingCategory === cat || !inStreetView}
                                                                        className={`flex-1 text-[10px] px-2 py-2 font-bold rounded shadow uppercase transition-all ${!inStreetView ? 'bg-slate-600/30 text-slate-300 cursor-not-allowed text-slate-300/30' : 'bg-amber-600/30 hover:bg-amber-500/30 text-white'}`}
                                                                    >
                                                                        {submittingCategory === cat ? '...' : !inStreetView ? 'Enter Streetview' : 'Overwrite'}
                                                                    </button>
                                                                )}

                                                                {startingPoint === 'open-world' && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); jumpToLocation(foundSub); }}
                                                                        className={`${exclusiveMode ? 'flex-1' : 'flex-[0.5]'} bg-slate-700/40 hover:bg-slate-500/30 text-[10px] px-2 py-2 text-white font-bold rounded shadow uppercase transition-all`}
                                                                    >
                                                                        View
                                                                    </button>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <div className={`grid gap-2 flex-1 auto-rows-fr bingo-grid-${gridSize}`}>
                                    {myBoard.map((cat) => {
                                        const foundSub = mySubmissions.find(s => s.category === cat);
                                        const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some(s => s.category === cat);
                                        
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
                                                title={isBlocked ? "Claimed by another team" : cat}
                                                style={bgStyle}
                                                onClick={() => handleBingoTileClick(cat)}
                                                className={`relative p-2 rounded-xl border transition-all cursor-pointer flex flex-col justify-center items-center text-center overflow-hidden pb-2 sm:pb-12 ${foundSub ? 'text-white border-green-500' : isBlocked ? 'bg-slate-900/80 border-red-500 opacity-60' : 'bg-slate-800 border-slate-600 hover:bg-slate-700'}`}
                                            >
                                                {foundSub && <div className="absolute inset-0 bg-black/40 z-0"></div>}
                                                <span className={`relative z-10 ${getSidebarTextSizeClass()} font-bold leading-tight line-clamp-2 [hyphens:auto] [word-break:break-word] mt-0 sm:mt-1 ${foundSub ? 'drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)]' : isBlocked ? 'text-red-400 line-through' : 'text-white'}`}>
                                                    {cat}
                                                </span>
                            
                                                <div className="absolute bottom-2 w-[90%] left-[5%] h-[25%] max-h-12 hidden sm:flex flex-row justify-center gap-2 z-10">
                                                    {!foundSub ? (
                                                        <button type="button"
                                                            title={isBlocked ? "Claimed by another team" : "Add submission"}
                                                            onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                                                            disabled={submittingCategory === cat || !inStreetView || isBlocked}
                                                            className={`w-full h-full font-bold rounded-lg uppercase transition-all flex justify-center items-center ${isBlocked ? 'bg-red-900/50 text-red-500 cursor-not-allowed' : !inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-green-600/30 hover:bg-green-500/30 text-white'}`}
                                                        >
                                                            {submittingCategory === cat ? '...' : <FaCamera className="h-[60%] w-auto" />}
                                                        </button>
                                                    ) : (
                                                        <>
                                                            <button
                                                                type="button"
                                                                title="Overwrite submission"
                                                                onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                                                                disabled={submittingCategory === cat || !inStreetView}
                                                                className={`flex-1 h-full font-bold rounded-lg uppercase transition-all flex justify-center items-center ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-amber-600/30 hover:bg-amber-500/30 text-white'}`}
                                                            >
                                                                {submittingCategory === cat ? '...' : <FaCamera className="h-[60%] w-auto" />}
                                                            </button>
                                                            {startingPoint === 'open-world' && (
                                                                <button
                                                                    type="button"
                                                                    title="View submission"
                                                                    onClick={(e) => { e.stopPropagation(); jumpToLocation(foundSub); }}
                                                                    className="hidden sm:flex flex-1 h-full bg-slate-600/30 hover:bg-slate-500/30 text-white font-bold rounded-lg uppercase justify-center items-center"
                                                                >
                                                                    <FaEye className="h-[60%] w-auto" />
                                                                </button>
                                                            )}
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