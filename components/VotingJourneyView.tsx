'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import toast from 'react-hot-toast';
import { GoogleMap, useJsApiLoader, Polyline, MarkerF, StreetViewPanorama } from '@react-google-maps/api';
import { supabase } from '../lib/supabase';
import { GeoBingoLogo } from './utils/Elements';
import { mapOptions, GOOGLE_MAPS_LIBRARIES } from './utils/mapUtils';
import SafeImage from './utils/SafeImage';
import { VotingViewProps, Submission } from './utils/types';

// ==========================================
// Settings
// ==========================================
const ENABLE_PRELOADING = false; 
const ANIMATION_DURATION = 8000;
// ==========================================

type PathPoint = { lat: number; lng: number; timestamp: number };

const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    let dLng = Math.abs(lng1 - lng2);
    if (dLng > 180) dLng = 360 - dLng;
    return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(dLng, 2));
};

export default function VotingJourneyView({ 
    gameId, isHost, playerId, players, teamMode, startingPoint = 'open-world', onFinishGame, renderToast
}: VotingViewProps) {
    
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [playersWithPaths, setPlayersWithPaths] = useState<any[]>([]);
    
    const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [isLineComplete, setIsLineComplete] = useState(false);
    const [isPreloading, setIsPreloading] = useState(ENABLE_PRELOADING);
    
    const [activeSubmission, setActiveSubmission] = useState<Submission | null>(null);
    const [viewedFullscreenSub, setViewedFullscreenSub] = useState<Submission | null>(null);
    
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [finalPath, setFinalPath] = useState<PathPoint[]>([]);

    const polylineRef = useRef<google.maps.Polyline | null>(null);
    const markerRef = useRef<google.maps.Marker | null>(null);
    const animationProgressRef = useRef(0);
    const lastTimeRef = useRef(0);
    const shownSubIdsRef = useRef<Set<string>>(new Set());
    const rAFRef = useRef(0);

    const dummyPath = useMemo(() => [], []);
    const dummyPos = useMemo(() => ({ lat: 0, lng: 0 }), []);
    
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries: GOOGLE_MAPS_LIBRARIES
    });

    const currentPlayer = playersWithPaths[currentPlayerIndex];
    const activeSubLatest = activeSubmission ? submissions.find(s => s.id === activeSubmission.id) : null;

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

    useEffect(() => {
        const fetchData = async () => {
            const { data: subData } = await supabase.from('submissions').select('*').eq('game_id', gameId);
            if (subData) setSubmissions(subData);

            const { data: pData } = await supabase.from('players').select('id, name, team, path').eq('game_id', gameId);
            if (pData) {
                const validPlayers = pData.filter(p => p.path && p.path.length > 0);
                setPlayersWithPaths(validPlayers);
            }
        };
        fetchData();

        const channel = supabase.channel(`voting-journey-${gameId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `game_id=eq.${gameId}` }, 
                (payload) => {
                    setSubmissions(prev => prev.map(s => s.id === payload.new.id ? { ...s, votes: payload.new.votes } : s));
                }
            )
            .on('broadcast', { event: 'next_player' }, (payload) => {
                setCurrentPlayerIndex(payload.payload.index);
            })
            .on('broadcast', { event: 'finish_game' }, () => {
                onFinishGame();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [gameId, onFinishGame]);

    const pathData: { rawPath: PathPoint[]; totalDist: number; dists: number[]; subProgressions: { sub: Submission; progress: number }[] } = useMemo(() => {
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

    useEffect(() => {
        setIsPreloading(ENABLE_PRELOADING);
        animationProgressRef.current = 0;
        shownSubIdsRef.current.clear();
        setIsLineComplete(false);
        setFinalPath([]);
        setActiveSubmission(null);
    }, [currentPlayerIndex]);

    useEffect(() => {
        if (!mapInstance || !pathData || pathData.rawPath.length === 0) return;

        const initMap = () => {
            if (pathData.rawPath.length > 1) {
                const bounds = new window.google.maps.LatLngBounds();
                pathData.rawPath.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
                mapInstance.fitBounds(bounds, 50);
                console.log(`Fitting bounds for player ${currentPlayer?.name} to ${bounds.toString()}`);
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

    useEffect(() => {
        if (!mapInstance || isPaused || isLineComplete || !pathData || pathData.rawPath.length === 0 || isPreloading) return;

        lastTimeRef.current = performance.now();

        const animate = (time: DOMHighResTimeStamp) => {
            const delta = time - lastTimeRef.current;
            lastTimeRef.current = time;

            let progress = animationProgressRef.current + (delta / ANIMATION_DURATION);
            let hitSub = false;

            if (progress >= 1) {
                progress = 1;
            } else {
                const crossedSub = pathData.subProgressions.find(sp => sp.progress <= progress && !shownSubIdsRef.current.has(sp.sub.id));
                if (crossedSub) {
                    shownSubIdsRef.current.add(crossedSub.sub.id);
                    setActiveSubmission(crossedSub.sub);
                    setIsPaused(true);
                    progress = crossedSub.progress;
                    hitSub = true;
                }
            }

            animationProgressRef.current = progress;

            let currentPoint;
            let partialPath: PathPoint[] = [];

            if (progress <= 0) {
                currentPoint = pathData.rawPath[0];
                partialPath = [currentPoint];
            } else if (progress >= 1) {
                currentPoint = pathData.rawPath[pathData.rawPath.length - 1];
                partialPath = pathData.rawPath;
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

            if (progress >= 1) {
                setFinalPath(pathData.rawPath);
                setIsLineComplete(true);
            } else if (!hitSub) {
                rAFRef.current = requestAnimationFrame(animate);
            }
        };

        rAFRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rAFRef.current);
    }, [isPaused, isLineComplete, mapInstance, pathData, isPreloading]);

    useEffect(() => {
        if (isLineComplete && mapInstance && pathData && pathData.rawPath.length > 1) {
            const bounds = new window.google.maps.LatLngBounds();
            pathData.rawPath.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
            mapInstance.panTo(bounds.getCenter());
        }
    }, [isLineComplete, mapInstance, pathData]);
    
    useEffect(() => {
        if (votingStats.isComplete && activeSubLatest && isPaused) {
            setActiveSubmission(null);
            setViewedFullscreenSub(null);
            setIsPaused(false);
        }
    }, [votingStats.isComplete, activeSubLatest, isPaused]);

    const handleVote = async (sub: Submission, voteIsYes: boolean) => {
        const newVotes = { ...sub.votes, [playerId]: voteIsYes };
        setSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, votes: newVotes } : s));

        // Optimistic UI update
        const { error } = await supabase.rpc('register_vote', {
            p_submission_id: sub.id,
            p_player_id: playerId,
            p_vote: voteIsYes
        });

        if (error) {
            console.error("Error submitting vote:", error);
            toast.error("Error submitting vote. Please try again.");
        }
    };

    const handleNextPlayer = () => {
        if (currentPlayerIndex < playersWithPaths.length - 1) {
            const nextIndex = currentPlayerIndex + 1;
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

    if (!isLoaded || playersWithPaths.length === 0) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-indigo-400 font-bold text-2xl tracking-widest uppercase">Loading Journey...</div>;
    }

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const isOpenWorld = startingPoint === 'open-world';

    const preloadMarkerPos = pathData?.rawPath.length > 0 ? pathData.rawPath[0] : dummyPos;

    return (
        <div className="h-screen w-screen overflow-hidden relative bg-slate-900">
            {renderToast()}
            
            <div className="absolute inset-0 z-0 pointer-events-auto">
                <GoogleMap
                    onLoad={map => setMapInstance(map)}
                    mapContainerClassName="w-full h-full"
                    options={currentMapOptions}
                >
                    <Polyline 
                        path={isLineComplete ? finalPath : dummyPath}
                        onLoad={p => polylineRef.current = p}
                        options={{ strokeColor: '#4f46e5', strokeOpacity: 0.8, strokeWeight: 6, geodesic: true }} 
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
                                strokeColor: '#4f46e5',
                                strokeWeight: 4,
                            }}
                        />
                    )}
                </GoogleMap>
            </div>

            {isPreloading && ENABLE_PRELOADING && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-slate-800/90 backdrop-blur-md p-6 rounded-2xl border border-indigo-500 shadow-2xl flex flex-col items-center">
                    <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <h2 className="text-xl font-bold text-white mb-1">Loading Route</h2>
                    <p className="text-indigo-300 font-medium">Preparing map for {currentPlayer?.name}...</p>
                </div>
            )}

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
                        Skip to Podium
                    </button>
                )}
            </div>

            {activeSubLatest && !isPreloading && (
                <div className={`z-40 bg-slate-800/95 backdrop-blur p-3 rounded-2xl border-2 border-indigo-500 shadow-[0_0_50px_rgba(79,70,229,0.4)] w-[400px] h-[320px] pointer-events-auto transform transition-all animate-in zoom-in-90 duration-300 ${isOpenWorld ? 'absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-[calc(100%+30px)]' : 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'}`}>
                    
                    {isOpenWorld && (
                        <div className="absolute -bottom-[14px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[14px] border-r-[14px] border-t-[14px] border-l-transparent border-r-transparent border-t-indigo-500 drop-shadow-md"></div>
                    )}

                    <div 
                        className="w-full h-40 rounded-xl overflow-hidden relative cursor-pointer group mb-4 shadow-inner"
                        onClick={() => setViewedFullscreenSub(activeSubLatest)}
                    >
                        <SafeImage 
                            src={`https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${activeSubLatest.lat},${activeSubLatest.lng}&heading=${activeSubLatest.heading}&pitch=${activeSubLatest.pitch}&fov=90&key=${apiKey}`}
                            alt="Found location"
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-white font-bold bg-indigo-600/90 px-6 py-2 rounded-full backdrop-blur-sm shadow-lg border border-indigo-400">Open StreetView</span>
                        </div>
                    </div>

                    <div className="px-2 pb-2 text-center">
                        <h3 className="text-xl font-bold text-white mb-1 line-clamp-1">{activeSubLatest.category}</h3>
                        <p className="text-xs text-indigo-300 mb-2 uppercase tracking-widest font-semibold">
                            {votingStats.isComplete 
                                ? "Voting Complete - Continuing..." 
                                : (votingStats.eligibleCount === 0 ? "No votes needed" : `Awaiting Votes... (${votingStats.cast}/${votingStats.eligibleCount})`)
                            }
                        </p>

                        <div className="flex flex-col gap-3">
                            <div className="flex gap-3">
                                {(() => {
                                    if (votingStats.isComplete) {
                                        return (
                                            <div className="flex-1 py-3 text-center text-green-400 font-bold uppercase border border-green-700 rounded-xl bg-green-900/30">
                                                Voting Complete...
                                            </div>
                                        );
                                    }

                                    const subPlayerTeam = players.find(p => p.id === activeSubLatest.player_id)?.team;
                                    const myTeam = players.find(p => p.id === playerId)?.team;
                                    const isMySubmission = playerId === activeSubLatest.player_id;
                                    const isMyTeamSubmission = teamMode === 'teams' && subPlayerTeam !== undefined && subPlayerTeam === myTeam;

                                    if (isMySubmission || isMyTeamSubmission) {
                                        return (
                                            <div className="flex-1 py-3 text-center text-slate-400 font-bold uppercase border border-slate-700 rounded-xl bg-slate-900/50">
                                                {isMySubmission ? 'Your Submission' : 'Team Submission'}
                                            </div>
                                        );
                                    }

                                    return (
                                        <>
                                            <button type="button" onClick={() => handleVote(activeSubLatest, true)} className={`flex-1 py-3 rounded-xl font-black uppercase text-sm border transition-all ${activeSubLatest.votes?.[playerId] === true ? 'bg-green-600 border-green-400 text-white shadow-[0_0_15px_rgba(34,197,94,0.5)]' : 'bg-slate-900/50 border-slate-600 text-slate-300 hover:border-green-500 hover:text-green-500 hover:bg-green-900/30'}`}>Yes</button>
                                            <button type="button" onClick={() => handleVote(activeSubLatest, false)} className={`flex-1 py-3 rounded-xl font-black uppercase text-sm border transition-all ${activeSubLatest.votes?.[playerId] === false ? 'bg-red-600 border-red-400 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-slate-900/50 border-slate-600 text-slate-300 hover:border-red-500 hover:text-red-500 hover:bg-red-900/30'}`}>No</button>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isLineComplete && !activeSubLatest && !isPreloading && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 bg-slate-800/95 backdrop-blur p-6 rounded-2xl border-2 border-indigo-500 shadow-[0_0_50px_rgba(79,70,229,0.4)] w-[350px] text-center animate-in zoom-in-90 duration-300">
                    <h2 className="text-2xl font-black uppercase text-indigo-400 mb-2">{currentPlayer?.name}'s Journey</h2>
                    <p className="text-slate-300 font-medium mb-6">All locations visited. Explore the map!</p>
                    
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

            {viewedFullscreenSub && (
                <div className="fixed inset-0 z-50 bg-black flex items-center justify-center pointer-events-auto animate-in fade-in duration-200">
                    <GoogleMap
                        mapContainerClassName="w-full h-full"
                        center={{ lat: viewedFullscreenSub.lat, lng: viewedFullscreenSub.lng }}
                        options={{ disableDefaultUI: true, gestureHandling: 'greedy' }}
                    >
                        <StreetViewPanorama 
                            options={{
                                position: { lat: viewedFullscreenSub.lat, lng: viewedFullscreenSub.lng },
                                pov: { heading: viewedFullscreenSub.heading, pitch: viewedFullscreenSub.pitch },
                                zoom: viewedFullscreenSub.zoom,
                                visible: true, addressControl: false, showRoadLabels: false, enableCloseButton: false
                            }}
                        />
                    </GoogleMap>
                    <button type="button" onClick={() => setViewedFullscreenSub(null)} className="absolute top-8 left-8 z-[1000] w-14 h-14 bg-slate-900/80 hover:bg-red-600 text-white flex items-center justify-center rounded-2xl shadow-2xl border border-slate-600 hover:border-red-400 font-bold text-2xl backdrop-blur-md transition-all">✕</button>
                </div>
            )}
        </div>
    );
}