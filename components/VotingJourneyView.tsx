'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

import { GoogleMap, useJsApiLoader, Polyline, MarkerF, StreetViewPanorama, Circle } from '@react-google-maps/api';
import toast from 'react-hot-toast';

import { supabase } from '../lib/supabase';
import { GeoBingoLogo } from './utils/Elements';
import { mapOptions, GOOGLE_MAPS_LIBRARIES } from './utils/mapUtils';
import { VotingViewProps, Submission } from './utils/types';

const ENABLE_PRELOADING = false; 
const ANIMATION_DURATION = 8000;

type PathPoint = {
    lat: number;
    lng: number;
    timestamp: number
};

interface PlayerWithPaths {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
    path: PathPoint[];
}

interface BingoCategory {
    categoryName: string;
    matchedPlaces: {
        name: string;
        lat: number;
        lng: number;
    }[];
}

const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    let dLng = Math.abs(lng1 - lng2);
    if (dLng > 180) dLng = 360 - dLng;
    return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(dLng, 2));
};

export default function VotingJourneyView({ 
    gameId, isHost, playerId, players, teamMode, onFinishGame
}: VotingViewProps) {
    
    const [gameCategories, setGameCategories] = useState<string[]>([]);
    const [gridSize, setGridSize] = useState<number>(3);
    const [gameMode, setGameMode] = useState<string>('list');
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [playersWithPaths, setPlayersWithPaths] = useState<PlayerWithPaths[]>([]);
    const [shownSubIds, setShownSubIds] = useState<Set<string>>(new Set());
    const [categoryDetails, setCategoryDetails] = useState<BingoCategory[]>([]);
    const [generationRadius, setGenerationRadius] = useState<number>(1000);
    const [startingPoint, setStartingPoint] = useState<{ lat: number; lng: number } | null>(null);
    
    const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [isLineComplete, setIsLineComplete] = useState(false);
    const [isPreloading, setIsPreloading] = useState(ENABLE_PRELOADING);
    
    const [activeSubmission, setActiveSubmission] = useState<Submission | null>(null);
    const [lastActiveSub, setLastActiveSub] = useState<Submission | null>(null);

    const [isStreetViewVisible, setIsStreetViewVisible] = useState(false);
    const [isDataLoaded, setIsDataLoaded] = useState(false);
    
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [finalPath, setFinalPath] = useState<PathPoint[]>([]);

    const polylineRef = useRef<google.maps.Polyline | null>(null);
    const markerRef = useRef<google.maps.Marker | null>(null);
    const progressBarRef = useRef<HTMLDivElement | null>(null);
    
    const animationProgressRef = useRef(0);
    const lastTimeRef = useRef(0);
    const shownSubIdsRef = useRef<Set<string>>(new Set());
    const rAFRef = useRef(0);
    const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());

    const dummyPath = useMemo(() => [], []);
    const dummyPos = useMemo(() => ({ lat: 0, lng: 0 }), []);

    const [maxItemsPerColumn, setMaxItemsPerColumn] = useState(8);
    const categoryRef = useRef<HTMLDivElement>(null);
    
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries: GOOGLE_MAPS_LIBRARIES
    });

    const currentPlayer = playersWithPaths[currentPlayerIndex];

    const activeSubLatest = useMemo(() => {
        if (activeSubmission && activeSubmission.player_id === currentPlayer?.id) {
            return submissions.find(s => s.id === activeSubmission.id) || null;
        }
        return null;
    }, [activeSubmission, submissions, currentPlayer]);

    useEffect(() => {
        const delay = activeSubLatest ? 500 : 0;
        
        const timer = setTimeout(() => {
            setIsStreetViewVisible(!!activeSubLatest);
        }, delay); 
        
        return () => clearTimeout(timer);
    }, [activeSubLatest]);

    useEffect(() => {
        const calculateCapacity = () => {
            if (categoryRef.current) {
                const containerHeight = categoryRef.current.clientHeight;
                
                const TILE_HEIGHT = 30;
                const GAP = 12;
                const itemsThatFit = Math.floor(containerHeight / (TILE_HEIGHT + GAP));   
                setMaxItemsPerColumn(Math.max(3, itemsThatFit));
            }
        };
        calculateCapacity();
        window.addEventListener('resize', calculateCapacity);
        return () => window.removeEventListener('resize', calculateCapacity);
    }, []);

    const displaySub = activeSubLatest || lastActiveSub;

    const currentBoard = useMemo(() => {
        if (currentPlayer?.bingo_board && currentPlayer.bingo_board.length > 0) {
            return currentPlayer.bingo_board;
        }
        return gameCategories.slice(0, gameMode === 'list' ? gameCategories.length : gridSize * gridSize);
    }, [currentPlayer, gameCategories, gridSize, gameMode]);

    const votingStats = useMemo(() => {
        let isComplete = false;
        let cast = 0;
        let eligibleCount = 0;
        if (activeSubLatest) {
            const votesMap = activeSubLatest.votes || {};
            const actualVotes = Object.keys(votesMap).filter(k => k !== 'host_continued');
            cast = actualVotes.length;
            
            const eligibleVoters = playersWithPaths.filter(p => (teamMode === 'teams' ? p.team !== currentPlayer?.team : p.id !== currentPlayer?.id));
            eligibleCount = eligibleVoters.length;
            isComplete = cast >= eligibleCount || eligibleCount === 0;
        }
        return { isComplete, cast, eligibleCount };
    }, [activeSubLatest, playersWithPaths, currentPlayer, teamMode]);

    // Data Fetching
    useEffect(() => {
        const fetchData = async () => {
            const { data: gData } = await supabase
                .from('games')
                .select('categories, grid_size, game_mode, category_details, generation_radius, starting_point')
                .eq('id', gameId)
                .single();

            if (gData) {
                setGameCategories(gData.categories || []);
                setGridSize(gData.grid_size || 3);
                setGameMode(gData.game_mode || 'list');
                setCategoryDetails(gData.category_details || []);
                setGenerationRadius(gData.generation_radius || 1000);
                setStartingPoint(JSON.parse(gData.starting_point) || null);
            }

            const { data: subData } = await supabase.from('submissions').select('*').eq('game_id', gameId);
            if (subData) setSubmissions(subData);

            const { data: pData } = await supabase.from('players').select('id, name, team, path, bingo_board').eq('game_id', gameId);
            if (pData) {
                const validPlayers = pData.filter(p => p.path && p.path.length > 0);
                setPlayersWithPaths(validPlayers);
            }
            setIsDataLoaded(true);
        };
        fetchData();

        const channel = supabase.channel(`voting-journey-${gameId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `game_id=eq.${gameId}` }, 
                (payload) => {
                    setSubmissions(prev => prev.map(s => s.id === payload.new.id ? { ...s, votes: payload.new.votes } : s));
                }
            )
            .on('broadcast', { event: 'next_player' }, (payload) => {
                setIsPreloading(ENABLE_PRELOADING);
                setActiveSubmission(null);
                setIsPaused(false);
                setIsLineComplete(false);
                setFinalPath([]);
                shownSubIdsRef.current.clear();
                setShownSubIds(new Set());
                animationProgressRef.current = 0;
                if (progressBarRef.current) progressBarRef.current.style.transform = `scaleY(0)`;
                
                setCurrentPlayerIndex(payload.payload.index);
            })
            .on('broadcast', { event: 'finish_game' }, () => {
                onFinishGame();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [gameId, onFinishGame]);

    // Path Calculations
    const pathData = useMemo(() => {
        const rawPath = currentPlayer?.path || [];
        let totalDist = 0;
        const dists = [0];
        
        for (let i = 0; i < rawPath.length - 1; i++) {
            totalDist += getDistance(rawPath[i].lat, rawPath[i].lng, rawPath[i+1].lat, rawPath[i+1].lng);
            dists.push(totalDist);
        }

        const subsForPlayer = submissions.filter(s => s.player_id === currentPlayer?.id);
        const subProgressions = subsForPlayer.map(sub => {
            let minDistance = Infinity;
            let bestProgress = 0;
            for (let i = 0; i < rawPath.length; i++) {
                const d = getDistance(rawPath[i].lat, rawPath[i].lng, sub.lat, sub.lng);
                if (d < minDistance) {
                    minDistance = d;
                    bestProgress = totalDist === 0 ? 0 : dists[i] / totalDist;
                }
            }
            return { sub, progress: bestProgress };
        }).sort((a,b) => a.progress - b.progress);

        return { rawPath, totalDist, dists, subProgressions };
    }, [currentPlayer, submissions]);

    // Map Init
    useEffect(() => {
        if (!mapInstance || !pathData || pathData.rawPath.length === 0) return;

        const initMap = () => {
            if (pathData.rawPath.length > 1) {
                const bounds = new window.google.maps.LatLngBounds();
                pathData.rawPath.forEach((p: { lat: number; lng: number }) => bounds.extend({ lat: p.lat, lng: p.lng }));
                mapInstance.fitBounds(bounds, 50);
            } else {
                mapInstance.setZoom(15);
                mapInstance.setCenter(pathData.rawPath[0]);
            }
        };

        if (isPreloading && ENABLE_PRELOADING) {
            initMap();
            const timer = setTimeout(() => {
                setIsPreloading(false);
            }, 1000);
            return () => clearTimeout(timer);
        } else if (!ENABLE_PRELOADING && animationProgressRef.current === 0) {
            initMap();
        }
    }, [mapInstance, pathData, isPreloading]);

    // Animation Loop
    useEffect(() => {
        if (!mapInstance || isPaused || isLineComplete || !pathData || pathData.rawPath.length === 0 || isPreloading) return;

        lastTimeRef.current = performance.now();

        const animate = (time: DOMHighResTimeStamp) => {
            let delta = time - lastTimeRef.current;
            if (delta > 100) delta = 16.66; 
            
            lastTimeRef.current = time;

            if (pathData.totalDist === 0) {
                animationProgressRef.current = 1;
            }

            let progress = animationProgressRef.current + (delta / ANIMATION_DURATION);
            let hitSub = false;

            if (progress >= 1) progress = 1;

            let crossedSub = pathData.subProgressions.find(sp => sp.progress <= progress && !shownSubIdsRef.current.has(sp.sub.id));

            if (progress === 1 && !crossedSub) {
                const unshownSub = pathData.subProgressions.find(sp => !shownSubIdsRef.current.has(sp.sub.id));
                if (unshownSub) crossedSub = unshownSub;
            }

            if (crossedSub) {
                shownSubIdsRef.current.add(crossedSub.sub.id);
                setActiveSubmission(crossedSub.sub);
                setLastActiveSub(crossedSub.sub);
                setIsPaused(true);
                setShownSubIds(new Set(shownSubIdsRef.current)); 
                progress = crossedSub.progress;
                hitSub = true;
            }

            animationProgressRef.current = progress;

            if (progressBarRef.current) {
                progressBarRef.current.style.transform = `scaleY(${progress})`;
            }

            let currentPoint;
            let partialPath: PathPoint[] = [];

            if (progress <= 0) {
                currentPoint = pathData.rawPath[0];
                partialPath = [currentPoint];
            } else if (progress >= 1) {
                currentPoint = pathData.rawPath[pathData.rawPath.length - 1];
                partialPath = pathData.rawPath;
            } else if (pathData.rawPath.length < 2) {
                currentPoint = pathData.rawPath[0];
                partialPath = [currentPoint];
            } else {
                const targetDist = progress * pathData.totalDist;
                let idx = 0;
                while (idx < pathData.dists.length - 2 && pathData.dists[idx + 1] < targetDist) {
                    idx++;
                }
                const p1 = pathData.rawPath[idx];
                const p2 = pathData.rawPath[idx + 1];
                const segmentDist = pathData.dists[idx + 1] - pathData.dists[idx];
                const t = segmentDist === 0 ? 0 : (targetDist - pathData.dists[idx]) / segmentDist;

                let dLng = p2.lng - p1.lng;
                if (dLng > 180) dLng -= 360;
                else if (dLng < -180) dLng += 360;
                
                let currentLng = p1.lng + dLng * t;
                if (currentLng > 180) currentLng -= 360;
                else if (currentLng < -180) currentLng += 360;

                currentPoint = {
                    lat: p1.lat + (p2.lat - p1.lat) * t,
                    lng: currentLng,
                    timestamp: p1.timestamp + (p2.timestamp - p1.timestamp) * t
                };
                partialPath = pathData.rawPath.slice(0, idx + 1);
                partialPath.push(currentPoint);
            }

            if (polylineRef.current) polylineRef.current.setPath(partialPath);
            if (markerRef.current) markerRef.current.setPosition(currentPoint);
            
            if (mapInstance && currentPoint) {
                mapInstance.setCenter(currentPoint);
            }

            if (progress >= 1 && !hitSub) {
                setFinalPath(pathData.rawPath);
                setIsLineComplete(true);
            } else if (!hitSub) {
                rAFRef.current = requestAnimationFrame(animate);
            }
        };

        rAFRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rAFRef.current);
    }, [isPaused, isLineComplete, mapInstance, pathData, isPreloading]);

    // 
    useEffect(() => {
        if (isLineComplete && mapInstance && pathData && pathData.rawPath.length > 1) {
            const bounds = new window.google.maps.LatLngBounds();
            pathData.rawPath.forEach((p: { lat: number; lng: number }) => bounds.extend({ lat: p.lat, lng: p.lng }));
            mapInstance.panTo(bounds.getCenter());
        }
    }, [isLineComplete, mapInstance, pathData]);
    
    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout>;
        
        if (votingStats.isComplete && activeSubLatest && isPaused) {
            timeoutId = setTimeout(() => {
                setActiveSubmission(null);
                setIsPaused(false);
            }, 100); 
        }
        return () => clearTimeout(timeoutId);
    }, [votingStats.isComplete, activeSubLatest, isPaused]);

    const handleVote = async (sub: Submission, voteIsYes: boolean) => {
        const newVotes = { ...sub.votes, [playerId]: voteIsYes };
        setSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, votes: newVotes } : s));

        const { error } = await supabase.rpc('register_vote', {
            p_submission_id: sub.id,
            p_player_id: playerId,
            p_vote: voteIsYes
        });

        if (error) {
            console.error(error);
            toast.error("Error submitting vote.");
        }
    };

    const handleNextPlayer = () => {
        if (currentPlayerIndex < playersWithPaths.length - 1) {
            const nextIndex = currentPlayerIndex + 1;
            
            setIsPreloading(ENABLE_PRELOADING);
            setActiveSubmission(null);
            setIsPaused(false);
            setIsLineComplete(false);
            setFinalPath([]);
            shownSubIdsRef.current.clear();
            setShownSubIds(new Set());
            animationProgressRef.current = 0;
            if (progressBarRef.current) progressBarRef.current.style.transform = `scaleY(0)`;
            
            setCurrentPlayerIndex(nextIndex);
            
            supabase.channel(`voting-journey-${gameId}`).send({
                type: 'broadcast',
                event: 'next_player',
                payload: { index: nextIndex }
            });
        } else {
            supabase.channel(`voting-journey-${gameId}`).send({
                type: 'broadcast',
                event: 'finish_game'
            });
            onFinishGame();
        }
    };

    const handleSkipToPodium = () => {
        supabase.channel(`voting-journey-${gameId}`).send({
            type: 'broadcast',
            event: 'finish_game'
        });
        onFinishGame();
    };

    // Fall 1: Aktive Kategorie-Marker während der Reise
    const activeCategoryMarkers = useMemo(() => {
        if (!displaySub || isLineComplete) return null;
        
        const activeCat = categoryDetails.find(cat => cat.categoryName === displaySub.category);
        if (!activeCat) return null;

        return activeCat.matchedPlaces.map((place, pIdx) => {
            const mId = `active-${displaySub.id}-${pIdx}`;
            return (
                <MarkerF
                    key={mId}
                    position={{ lat: place.lat, lng: place.lng }}
                    options={{
                        icon: {
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: 8,
                            fillColor: '#4f46e5',
                            fillOpacity: 1,
                            strokeWeight: 1.5,
                            strokeColor: '#a4b3ff',
                        },
                        label: {
                            text: place.name,
                            // animate-in und fade-in für sanftes Einblenden!
                            className: "bg-slate-900/90 text-white p-3 rounded border border-indigo-500 text-[10px] font-bold mt-10 whitespace-nowrap shadow-lg",
                            color: '#a4b3ff'
                        },
                    }}
                    // Die Marker fallen sanft herein, statt hart aufzuploppen
                    animation={typeof window !== 'undefined' && window.google ? window.google.maps.Animation.DROP : undefined}
                />
            );
        });
    }, [displaySub?.id, isLineComplete, categoryDetails]);

    // Fall 2: Alle Kategorien am Ende (Hover-Logik)
    const finalCategoryMarkers = useMemo(() => {
        if (!isLineComplete) return null;

        return categoryDetails.map((cat, cIdx) => (
            cat.matchedPlaces.map((place, pIdx) => {
                const mId = `final-${cIdx}-${pIdx}`;
                
                // Vorlagen-Objekt für das Label
                const labelConfig = {
                    text: `${place.name} (${cat.categoryName})`,
                    className: "bg-slate-900/90 text-white p-3 rounded border border-indigo-500 text-[10px] font-bold mt-10 whitespace-nowrap shadow-lg",
                    color: '#a4b3ff'
                };

                return (
                    <MarkerF
                        key={mId}
                        position={{ lat: place.lat, lng: place.lng }}
                        onLoad={(marker) => markersRef.current.set(mId, marker)}
                        onUnmount={() => markersRef.current.delete(mId)}
                        onMouseOver={() => {
                            const marker = markersRef.current.get(mId);
                            if (marker) {
                                marker.setLabel(labelConfig);
                                marker.setZIndex(100); // Immer im Vordergrund
                            }
                        }}
                        onMouseOut={() => {
                            const marker = markersRef.current.get(mId);
                            if (marker) {
                                marker.setLabel(null);
                                marker.setZIndex(5);
                            }
                        }}
                        options={{
                            icon: {
                                path: window.google.maps.SymbolPath.CIRCLE,
                                scale: 6,
                                fillColor: '#4f46e5',
                                fillOpacity: 1,
                                strokeWeight: 1.5,
                                strokeColor: '#a4b3ff',
                            },
                            zIndex: 5
                        }}
                        animation={typeof window !== 'undefined' && window.google ? window.google.maps.Animation.DROP : undefined}
                    />
                );
            })
        ));
    }, [isLineComplete, categoryDetails]);

    const currentMapOptions = useMemo(() => {
        const interactive = isLineComplete;
        return mapOptions({
            streetViewControl: false,
            disableDefaultUI: true, 
            clickableIcons: false,
            gestureHandling: interactive ? 'greedy' : 'none',
            keyboardShortcuts: interactive,
            zoomControl: interactive,
            styles: [],
        });
    }, [isLineComplete]);

    const panoramaOptions = useMemo(() => {
        if (!displaySub) return undefined;
        return {
            position: { lat: displaySub.lat, lng: displaySub.lng },
            pov: { heading: displaySub.heading, pitch: displaySub.pitch },
            zoom: displaySub.zoom || 1,
            visible: true, 
            addressControl: false, 
            showRoadLabels: false, 
            enableCloseButton: false, 
            linksControl: false, 
            panControl: false, 
            fullscreenControl: false, 
            motionTracking: false
        };
    }, [displaySub?.id]);

    if (!isLoaded || !isDataLoaded) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-indigo-400 font-bold text-2xl tracking-widest uppercase">Loading...</div>;
    }

    if (isDataLoaded && playersWithPaths.length === 0) {
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white">
                <h2 className="text-2xl font-bold mb-4 text-indigo-400 tracking-widest uppercase">No Paths Found</h2>
                <p className="text-slate-400 mb-8">No one has left the house or recorded GPS data.</p>
                {isHost && (
                    <button type="button" onClick={onFinishGame} className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-xl font-bold transition-all shadow-[0_0_20px_rgba(34,197,94,0.3)]">
                        End Game
                    </button>
                )}
            </div>
        );
    }

    const preloadMarkerPos = pathData?.rawPath.length > 0 ? pathData.rawPath[0] : dummyPos;
    
    const yesVotes = activeSubLatest ? Object.values(activeSubLatest.votes || {}).filter(v => v === true).length : 0;
    const noVotes = activeSubLatest ? Object.values(activeSubLatest.votes || {}).filter(v => v === false).length : 0;

    const totalCategories = currentBoard?.length || 0;
    let columns = 1;
    let rows = 1;

    if (gameMode === "bingo") {
        columns = gridSize;
        rows = gridSize; 
    } else {
        columns = Math.ceil(totalCategories / maxItemsPerColumn) || 1;
        rows = Math.ceil(totalCategories / columns) || 1;
    }

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-slate-900">
            {/* Left Panel */}
            <div className="relative w-1/2 h-full z-10 flex-shrink-0">
                <GoogleMap
                    onLoad={map => setMapInstance(map)}
                    mapContainerClassName="w-full h-full"
                    options={currentMapOptions}
                >
                    <Polyline 
                        path={isLineComplete ? finalPath : dummyPath}
                        onLoad={p => polylineRef.current = p}
                        options={{ strokeColor: '#fac800', strokeOpacity: 0.8, strokeWeight: 6, geodesic: true, zIndex: 10000 }} 
                    />
                    
                    {!isLineComplete && (
                        <MarkerF 
                            position={isPreloading ? preloadMarkerPos : dummyPos}
                            onLoad={m => markerRef.current = m}
                            icon={{
                                path: window.google.maps.SymbolPath.CIRCLE,
                                scale: 8,
                                fillColor: '#ffffff',
                                fillOpacity: 1,
                                strokeColor: '#fac800',
                                strokeWeight: 4,
                            }}
                        />
                    )}

                    {/* Category Markers */}
                    {activeCategoryMarkers}

                    {/* Final Category Markers */}
                    {finalCategoryMarkers}

                    {/* Radius Circle */}
                    {isLineComplete && (
                        <Circle
                            center={startingPoint || { lat: 0, lng: 0 }} 
                            radius={generationRadius * 100}
                            options={{
                                fillOpacity: 0,
                                strokeColor: "#625fff",
                                strokeOpacity: 0.8,
                                strokeWeight: 3,
                                clickable: false,
                            }}
                        />
                    )}
                </GoogleMap>

                <div className="absolute top-6 left-6 right-6 z-10 flex justify-between items-start pointer-events-none">
                    <div className="flex items-center gap-4">
                        <GeoBingoLogo size={50} className="drop-shadow-xl" />
                        <div>
                            <h1 className="text-3xl font-black uppercase text-indigo-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">Journey Replay</h1>
                            <p className="text-white font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] mt-1">
                                <span className="bg-slate-900/70 px-4 py-1.5 rounded-full border border-slate-700 backdrop-blur-md">
                                    Following: <span className="text-indigo-400">{currentPlayer?.name}</span>
                                </span>
                            </p>
                        </div>
                    </div>

                    {isHost && (
                        <button type="button" 
                            onClick={handleSkipToPodium}
                            className="pointer-events-auto font-bold px-6 py-3 rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.3)] transition-all bg-green-600 hover:bg-green-500 text-white border border-green-400"
                        >
                            Skip
                        </button>
                    )}
                </div>

                {isLineComplete && !activeSubLatest && !isPreloading && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-800/95 backdrop-blur p-6 rounded-2xl border-2 border-indigo-500 shadow-[0_0_50px_rgba(79,70,229,0.4)] w-[350px] text-center animate-in zoom-in-90 duration-300">
                        <h2 className="text-2xl font-black uppercase text-indigo-400 mb-2">{currentPlayer?.name}'s Journey</h2>
                        <p className="text-slate-300 font-medium mb-6">Complete.</p>
                        
                        {isHost ? (
                            <button 
                                type="button" 
                                onClick={handleNextPlayer} 
                                className="w-full py-3 rounded-xl font-black uppercase text-sm border bg-green-600 hover:bg-green-500 text-white border-green-400 transition-all shadow-[0_0_15px_rgba(34,197,94,0.5)]"
                            >
                                {currentPlayerIndex < playersWithPaths.length - 1 ? 'Next Player' : 'Show Podium'}
                            </button>
                        ) : (
                            <p className="text-sm text-slate-400 uppercase tracking-widest font-bold">Waiting for host...</p>
                        )}
                    </div>
                )}
            </div>

            {/* Right Panel */}
            <div className="relative w-1/2 h-full bg-slate-800 z-20 shadow-[-20px_0_50px_rgba(0,0,0,0.5)] overflow-hidden">
                
                {/* Progress Bar */}
                <div className="absolute left-0 top-0 bottom-0 w-1.5 z-40 bg-slate-900/60 border-r border-slate-700">
                    <div 
                        ref={progressBarRef}
                        className="absolute top-0 left-0 w-full h-full bg-indigo-500 shadow-[0_0_20px_2px_rgba(79,70,229,1)] origin-top"
                        style={{ transform: 'scaleY(0)', transition: 'transform 0.1s linear' }}
                    ></div>
                </div>

                {/* STREETVIEW CONTAINER */}
                <div className={`absolute inset-0 pl-1.5 flex flex-col z-30 bg-slate-800 transition-all duration-500 ease-in-out ${isStreetViewVisible ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 translate-x-12 pointer-events-none'}`}>
                    <div className="flex-grow relative w-full">
                        <GoogleMap
                            mapContainerClassName="w-full h-full"
                            center={displaySub ? { lat: displaySub.lat, lng: displaySub.lng } : dummyPos}
                            options={{ disableDefaultUI: true, gestureHandling: 'greedy' }}
                        >
                            {displaySub && (
                                <StreetViewPanorama 
                                    options={panoramaOptions}
                                />
                            )}
                        </GoogleMap>
                    </div>

                    <div className="w-full bg-slate-900/95 backdrop-blur-xl border-t border-indigo-500/50 p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
                        <div className="max-w-xl mx-auto">
                            <h3 className="text-2xl font-black text-white mb-1 text-center truncate">{displaySub?.category}</h3>
                            <p className="text-sm text-indigo-300 mb-4 text-center uppercase tracking-widest font-semibold">
                                {votingStats.eligibleCount === 0 && activeSubLatest
                                    ? "Single Player Vote - No votes needed"
                                    : votingStats.isComplete 
                                        ? "Voting Complete - Continuing..." 
                                        : `Awaiting Votes... (${votingStats.cast}/${votingStats.eligibleCount})`}
                            </p>

                            <div className="flex gap-4">
                                {(() => {
                                    if (votingStats.isComplete) {
                                        return (
                                            <div className="flex-1 py-4 text-center text-green-400 font-bold uppercase border border-green-700 rounded-xl bg-green-900/30">
                                                Voting Complete <br/>
                                                <span className="text-sm text-green-300/80 normal-case mt-1 inline-block">({yesVotes} Y / {noVotes} N)</span>
                                            </div>
                                        );
                                    }

                                    const subPlayerTeam = players.find(p => p.id === activeSubLatest?.player_id)?.team;
                                    const myTeam = players.find(p => p.id === playerId)?.team;
                                    const isMySubmission = playerId === activeSubLatest?.player_id;
                                    const isMyTeamSubmission = teamMode === 'teams' && subPlayerTeam !== undefined && subPlayerTeam === myTeam;

                                    if (isMySubmission || isMyTeamSubmission) {
                                        return (
                                            <div className="flex-1 py-4 text-center text-slate-400 font-bold uppercase border border-slate-700 rounded-xl bg-slate-900/50">
                                                {isMySubmission ? 'Your Submission' : 'Team Submission'} <br/>
                                                <span className="text-sm text-slate-500 normal-case mt-1 inline-block">Y: {yesVotes} | N: {noVotes}</span>
                                            </div>
                                        );
                                    }

                                    return (
                                        <>
                                            <div className="flex-1 flex flex-col gap-2">
                                                <button type="button" onClick={() => activeSubLatest && handleVote(activeSubLatest, true)} className={`w-full py-4 rounded-xl font-black uppercase text-lg border transition-all ${activeSubLatest?.votes?.[playerId] === true ? 'bg-green-600 border-green-400 text-white shadow-[0_0_15px_rgba(34,197,94,0.5)]' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-green-500 hover:text-green-500 hover:bg-green-900/30'}`}>Yes</button>
                                                <div className="text-center text-green-400 font-bold text-sm tracking-wide">{yesVotes} Votes</div>
                                            </div>
                                            <div className="flex-1 flex flex-col gap-2">
                                                <button type="button" onClick={() => activeSubLatest && handleVote(activeSubLatest, false)} className={`w-full py-4 rounded-xl font-black uppercase text-lg border transition-all ${activeSubLatest?.votes?.[playerId] === false ? 'bg-red-600 border-red-400 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-red-500 hover:text-red-500 hover:bg-red-900/30'}`}>No</button>
                                                <div className="text-center text-red-400 font-bold text-sm tracking-wide">{noVotes} Votes</div>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>

                {/* BINGO BOARD CONTAINER (Steuerung jetzt über isStreetViewVisible) */}
                <div className={`absolute inset-0 flex flex-col items-center justify-center p-8 z-20 transition-all duration-500 ease-in-out ${isStreetViewVisible ? 'opacity-0 -translate-x-12 pointer-events-none' : 'opacity-100 translate-x-0 pointer-events-auto'}`}>
                    <div className="text-center mb-8">
                        <h2 className="text-3xl font-black text-indigo-400 tracking-widest">{currentPlayer?.name}'s Board</h2>
                    </div>

                    {submissions.filter(s => s.player_id === currentPlayer?.id).length === 0 && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-slate-900/90 p-6 rounded-2xl text-red-400 font-bold border border-red-500/50 backdrop-blur-md text-center shadow-[0_0_30px_rgba(239,68,68,0.3)]">
                            No submissions found for this player
                        </div>
                    )}
                    
                    <div 
                        ref={categoryRef}
                        className="grid gap-3 flex-1 w-full" 
                        style={{ 
                            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                            gridAutoFlow: 'column'
                        }}
                    >
                        {currentBoard?.map((category: string, idx: number) => {
                            const sub = submissions.find(s => s.player_id === currentPlayer?.id && s.category === category);
                            const isReached = sub && shownSubIds.has(sub.id);
                            
                            let yesPercent = 0;
                            let noPercent = 0;
                            let tileClass = "bg-slate-900/60 border-slate-800 text-slate-600 opacity-60 [hyphens:auto] break-all";
                            
                            if (sub) {
                                if (isReached) {
                                    const yes = Object.values(sub.votes || {}).filter(v => v === true).length;
                                    const no = Object.values(sub.votes || {}).filter(v => v === false).length;
                                    const total = yes + no;
                                    
                                    if (total > 0) {
                                        yesPercent = (yes / total) * 100;
                                        noPercent = (no / total) * 100;
                                    }
                                    tileClass = "bg-slate-800 border-slate-600 text-white shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]";
                                } else {
                                    tileClass = "bg-indigo-600/30 border-indigo-400 text-indigo-100 shadow-[0_0_20px_rgba(79,70,229,0.3)]";
                                }
                            }
                            
                            return (
                                <div key={`${currentPlayer?.id}-${idx}`} className={`relative rounded-xl overflow-hidden flex items-center justify-center border-2 transition-colors duration-500 ${tileClass}`}>
                                    <div 
                                        className="absolute left-0 top-0 bottom-0 bg-green-500/30 transition-all duration-700 ease-out" 
                                        style={{ width: `${yesPercent}%` }}
                                    ></div>
                                    
                                    <div 
                                        className="absolute right-0 top-0 bottom-0 bg-red-500/30 transition-all duration-700 ease-out" 
                                        style={{ width: `${noPercent}%` }}
                                    ></div>

                                    <span className="relative z-10 text-center font-bold text-sm sm:text-base px-2 drop-shadow-md">
                                        {category}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>
        </div>
    );
}
