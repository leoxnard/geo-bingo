'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import SafeImage from './SafeImage';
import { GeoBingoLogo, FullscreenButton } from './utils/Elements';
import { GoogleMap, useJsApiLoader, OverlayViewF, OverlayView, StreetViewPanorama, MarkerF } from '@react-google-maps/api';

const LIBRARIES: ("places" | "geometry" | "drawing" | "visualization" | "marker")[] = ['places', 'geometry'];

const mapOptions = {
    mapId: "VOTING_MAP_ID",
    streetViewControl: false, 
    mapTypeControl: false, 
    gestureHandling: 'greedy', 
    fullscreenControl: false, 
    zoomControl: false,
    keyboardShortcuts: true,
    draggable: true,
    scrollwheel: true,
    disableDoubleClickZoom: false,
    cameraControl: false,
}

interface Submission {
  id: string;
  player_id: string;
  category: string;
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  zoom: number; // Added zoom
  is_valid: boolean | null;
  votes: Record<string, boolean>;
}

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
}

interface VotingViewProps {
    gameId: string;
    isHost: boolean;
    categories: string[];
    playerId: string;
    players: Player[];
    teamMode: 'ffa' | 'teams';
    onFinishGame: () => Promise<void> | void;
    renderToast: () => React.ReactNode;
}

export default function VotingView({ 
    gameId, isHost, categories, playerId, players, teamMode, onFinishGame, renderToast
}: VotingViewProps) {
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [playersMap, setPlayersMap] = useState<Record<string, string>>({});
    const [activeCategory, setActiveCategory] = useState(categories[0]);
    const [viewedSubmission, setViewedSubmission] = useState<Submission | null>(null); // For street view look-up
    
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [hoveredSubId, setHoveredSubId] = useState<string | null>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script', // Muss absolut identisch mit anderen Stellen sein
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries: LIBRARIES
    });
    
    useEffect(() => {
        const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const totalPlayers = players.length;

    useEffect(() => {
        const fetchData = async () => {
            // 1. Fetch Submissions
            const { data: subData } = await supabase.from('submissions').select('*').eq('game_id', gameId);
            if (subData) {
                setSubmissions(subData);
                
                // Auto-select the first category that has at least one submission
                const firstPopulatedCat = categories.find(cat => 
                    subData.some((s: Submission) => s.category === cat)
                );
                if (firstPopulatedCat) {
                    setActiveCategory(firstPopulatedCat);
                }
            }

            // 2. Fetch Players
            const { data: playerData } = await supabase.from('players').select('id, name').eq('game_id', gameId);
            if (playerData) {
                const pMap: Record<string, string> = {};
                playerData.forEach(p => pMap[p.id] = p.name);
                setPlayersMap(pMap);
            }
        };
        
        fetchData();

        // 3. Setup Realtime Subscription
        const channel = supabase.channel(`voting-${gameId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `game_id=eq.${gameId}` }, 
                (payload) => {
                    setSubmissions(prev => prev.map(s => 
                        s.id === payload.new.id ? { ...s, votes: payload.new.votes, is_valid: payload.new.is_valid } : s
                    ));
                }
            ).subscribe();

        return () => { 
            const cleanup = async () => {
                await supabase.removeChannel(channel);
            };
            cleanup();
        };
    }, [gameId, categories]);

    const handleVote = async (sub: Submission, voteIsYes: boolean) => {
        const newVotes = { ...sub.votes, [playerId]: voteIsYes };
        setSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, votes: newVotes } : s));
        await supabase.from('submissions').update({ votes: newVotes }).eq('id', sub.id);
    };

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const currentCategory = categories.includes(activeCategory)
        ? activeCategory
        : (categories[0] ?? activeCategory);
    const activeSubmissions = submissions.filter(s => s.category === currentCategory);

    // Convert JS API Zoom to Static API FOV (Field of View)
    // Zoom 1 = 90 FOV, Zoom 2 = 45 FOV, etc. Max FOV allowed by Google is 120.
    const getFov = (zoom: number) => {
        const validZoom = zoom || 1;
        return Math.min(120, Math.max(10, 180 / Math.pow(2, validZoom)));
    };

    const targetCenter = useMemo(() => {
        if (activeSubmissions.length === 0) return null;
        const avgLat = activeSubmissions.reduce((sum, sub) => sum + sub.lat, 0) / activeSubmissions.length;
        const avgLng = activeSubmissions.reduce((sum, sub) => sum + sub.lng, 0) / activeSubmissions.length;
        return { lat: avgLat, lng: avgLng };
    }, [activeSubmissions]);

    useEffect(() => {
        if (mapInstance && targetCenter) {
            mapInstance.panTo(targetCenter);
        }
    }, [targetCenter, mapInstance]);

    // Check how many players have voted on EVERYTHING
    const playersWhoFinishedVoting = Object.keys(playersMap).filter(pId => {
        const voterTeam = players.find(p => p.id === pId)?.team;
        // A player is finished if they have a vote mapped in EVERY submission (except their team's)
        return submissions.every(sub => {
            const subPlayerTeam = players.find(p => p.id === sub.player_id)?.team;
            // Don't vote on own submissions or teammate's submissions (if teams mode)
            if (pId === sub.player_id || (teamMode === 'teams' && voterTeam !== undefined && voterTeam === subPlayerTeam)) return true;
            
            const voteMap = sub.votes || {};
            return voteMap[pId] !== undefined; // They voted Yes or No
        });
    });

    const goToPrevCategory = () => {
        const validCategories = categories.filter(cat => submissions.some(s => s.category === cat));
        if (validCategories.length <= 1) return;
        const currentIndex = validCategories.indexOf(currentCategory);
        const prevIndex = currentIndex <= 0 ? validCategories.length - 1 : currentIndex - 1;
        setActiveCategory(validCategories[prevIndex]);
    };

    const goToNextCategory = () => {
        const validCategories = categories.filter(cat => submissions.some(s => s.category === cat));
        if (validCategories.length <= 1) return;
        const currentIndex = validCategories.indexOf(currentCategory);
        const nextIndex = currentIndex >= validCategories.length - 1 ? 0 : currentIndex + 1;
        setActiveCategory(validCategories[nextIndex]);
    };

    return (
        <div className="min-h-screen flex flex-col items-center p-4 bg-slate-900 text-white">
            {renderToast()}
            <div className="w-full max-w-[95%] xl:max-w-[90vw] flex justify-between items-center mb-8 mt-4">
                <div className="flex items-center gap-4">
                    <GeoBingoLogo size={30} className="hidden sm:block" />
                    <h1 className="text-4xl font-black uppercase tracking-widest text-indigo-400">Voting</h1>
                </div>
            </div>

            <div className="w-full max-w-[95%] xl:max-w-[90vw]">
                <div className="w-full flex flex-col lg:flex-row gap-8 text-white">
                    {/* FULLSCREEN STREET VIEW MODAL */}
                    {viewedSubmission && (
                        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-0 md:p-8">
                            <div className="relative w-full h-full rounded-2xl overflow-hidden border-4 border-slate-700 shadow-2xl">
                                {isLoaded && (
                                    <GoogleMap
                                        mapContainerClassName="w-full h-full"
                                        center={{ lat: viewedSubmission.lat, lng: viewedSubmission.lng }}
                                        zoom={1}
                                        options={{
                                            streetViewControl: false,
                                            mapTypeControl: false,
                                            gestureHandling: 'greedy',
                                            fullscreenControl: false,
                                            zoomControl: false,
                                            keyboardShortcuts: true,
                                            draggable: true,
                                            scrollwheel: true,
                                            disableDoubleClickZoom: false
                                        }}
                                    >
                                        <StreetViewPanorama 
                                            key={viewedSubmission.id} 
                                            options={{
                                                position: { lat: viewedSubmission.lat, lng: viewedSubmission.lng },
                                                pov: { 
                                                    heading: viewedSubmission.heading, 
                                                    pitch: viewedSubmission.pitch 
                                                },
                                                zoom: viewedSubmission.zoom,
                                                
                                                visible: true,
                                                addressControl: false,
                                                showRoadLabels: false,
                                                enableCloseButton: false,
                                                fullscreenControl: false,
                                                zoomControl: false,
                                                panControl: false,
                                                linksControl: false,
                                                clickToGo: false,
                                                scrollwheel: true,
                                                disableDoubleClickZoom: false
                                            }}
                                        />
                                    </GoogleMap>
                                )}
                                
                                <button
                                    onClick={() => setViewedSubmission(null)}
                                    className="absolute top-4 left-4 z-[1000] w-12 h-12 bg-red-500/30 hover:bg-red-500/80 text-white flex items-center justify-center rounded-md shadow-[0_0_15px_rgba(0,0,0,0.4)] border border-red-400 font-bold text-2xl transition-transform hover:scale-105 active:scale-95 backdrop-blur-sm"
                                    title="Exit Street View"
                                >
                                    ✕
                                </button>
                                
                                <div className="absolute top-4 right-4 z-[1000] text-white font-bold bg-slate-900/60 px-4 py-2 rounded-full backdrop-blur-sm border border-slate-700">
                                    Reviewing: <span className="text-indigo-400">{playersMap[viewedSubmission.player_id] || 'Unknown'}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* LEFT: Category Selection */}
                    <div className="w-full lg:w-64 flex flex-col gap-2">
                        <h2 className="text-xl font-bold text-slate-400 mb-4 uppercase tracking-wider">Categories</h2>
                        {categories.map(cat => {
                            const categorySubs = submissions.filter(s => s.category === cat);
                            const count = categorySubs.length;
                            const isDisabled = count === 0;

                            let badgeColor = "bg-slate-800 text-slate-400"; 
                            if (count > 0) {
                                const isFinished = categorySubs.every(sub => {
                                    const subPlayerTeam = players.find(p => p.id === sub.player_id)?.team;
                                    const myTeam = players.find(p => p.id === playerId)?.team;
                                    if (sub.player_id === playerId || (teamMode === 'teams' && subPlayerTeam !== undefined && subPlayerTeam === myTeam)) return true;
                                    return sub.votes && sub.votes[playerId] !== undefined;
                                });
                                badgeColor = isFinished 
                                    ? "bg-green-900/50 text-green-400 border border-green-800/50" 
                                    : "bg-red-900/50 text-red-400 border border-red-800/50";
                            }

                            // Determine button style
                            const baseStyle = "text-left px-4 py-3 rounded-xl font-medium transition-all flex justify-between items-center";
                            const stateStyle = isDisabled
                                ? "bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-50"
                                : currentCategory === cat
                                    ? "bg-indigo-600 text-white shadow-lg cursor-default"
                                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 cursor-pointer";

                            return (
                                <button
                                    key={cat}
                                    onClick={() => !isDisabled && setActiveCategory(cat)}
                                    disabled={isDisabled}
                                    className={`${baseStyle} ${stateStyle}`}
                                >
                                    <span className="truncate pr-2">{cat}</span>
                                    <span className={`px-2 rounded text-xs py-1 whitespace-nowrap ${badgeColor}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}

                        {/* Host Control: Finish Game */}
                        {isHost && (
                            <div className="mt-8 flex flex-col gap-2">
                                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 mb-2">
                                    <p className="text-xs text-slate-400 font-bold uppercase mb-1">
                                        Progress:
                                    </p>
                                    <p className="text-lg font-black text-indigo-400">
                                        {playersWhoFinishedVoting.length} / {totalPlayers} <span className="text-sm font-normal text-slate-400">done</span>
                                    </p>
                                </div>
                    
                                <button 
                                    onClick={onFinishGame}
                                    className="font-bold py-4 rounded-xl uppercase tracking-wide shadow-lg transition-all bg-green-600 hover:bg-green-500 text-white"
                                >
                                    Show Podium
                                </button>
                                <p className="text-xs text-slate-400 text-center uppercase tracking-wider">
                                    Host can end voting at any time
                                </p>
                            </div>
                        )}
                    </div>

                    {/* RIGHT: Image Gallery & Voting */}
                    <div className="flex-1 bg-slate-800 p-6 rounded-2xl border border-slate-700 min-h-[500px] overflow-y-auto">
                        <div className="mb-6 border-b border-slate-700 pb-4 flex items-center justify-between gap-3">
                            <h2 className="text-2xl font-bold text-indigo-400 min-w-0">
                                Reviewing:
                                <span className="block sm:inline text-white break-words sm:ml-2">{currentCategory}</span>
                            </h2>
                            <div className="flex items-center shrink-0 rounded-xl border border-slate-600 bg-slate-900 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={goToPrevCategory}
                                    disabled={categories.length <= 1}
                                    className="p-3 hover:bg-slate-700 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                                    title="Previous category"
                                    aria-label="Previous category"
                                >
                                    <span className="text-lg leading-none">&lt;</span>
                                </button>
                                <span className="text-slate-500 select-none" aria-hidden="true">
                                    |
                                </span>
                                <button
                                    type="button"
                                    onClick={goToNextCategory}
                                    disabled={categories.length <= 1}
                                    className="p-3 hover:bg-slate-700 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                                    title="Next category"
                                    aria-label="Next category"
                                >
                                    <span className="text-lg leading-none">&gt;</span>
                                </button>
                            </div>
                        </div>

                        {/* Map View of all submissions for the current category */}
                        {isLoaded && activeSubmissions.length > 0 && (
                            <div ref={containerRef} className="w-full h-64 md:h-96 mb-8 rounded-2xl overflow-hidden shadow-xl border-2 border-slate-700 relative">
                                <GoogleMap
                                    onLoad={(map) => setMapInstance(map)}
                                    onUnmount={() => setMapInstance(null)}
                                    mapContainerClassName="w-full h-full"
                                    zoom={2}
                                    center={targetCenter || { lat: 50, lng: 10 }}
                                    options={mapOptions}
                                >
                                    {activeSubmissions.map(sub => {
                                        return (
                                            <MarkerF
                                                key={sub.id} 
                                                position={{ lat: sub.lat, lng: sub.lng }}
                                                onMouseOver={() => setHoveredSubId(sub.id)}
                                                onMouseOut={() => setHoveredSubId(null)}
                                                onClick={() => setViewedSubmission(sub)}
                                            >
                                                {hoveredSubId === sub.id && (
                                                    <OverlayViewF
                                                        position={{ lat: sub.lat, lng: sub.lng }}
                                                        mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                                                    >
                                                        <div className="bg-slate-800 border border-slate-600 text-white p-2 rounded-lg shadow-xl -translate-y-12 -translate-x-1/2 whitespace-nowrap">
                                                            <p className="font-bold text-sm">{playersMap[sub.player_id]}</p>
                                                            <div className="text-xs text-indigo-400">{sub.category}</div>
                                                        </div>
                                                    </OverlayViewF>
                                                )}
                                            </MarkerF>
                                        );
                                    })}
                                </GoogleMap>
                                <FullscreenButton isFullscreen={isFullscreen} containerRef={containerRef} setIsFullscreen={setIsFullscreen} />
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {activeSubmissions.map(sub => {
                                const votesMap = sub.votes || {};
                                const yesVotes = Object.values(votesMap).filter(v => v === true).length;
                                const noVotes = Object.values(votesMap).filter(v => v === false).length;
                                const totalVotesCast = yesVotes + noVotes;
                                const myVote = votesMap[playerId];

                                const statusOverlay = (
                                    <div className="absolute top-2 right-2 bg-indigo-600 px-3 py-1 rounded shadow uppercase font-bold text-xs">
                                        {yesVotes} Points
                                    </div>
                                );

                                return (
                                    <div key={sub.id} className="bg-slate-900 rounded-xl overflow-hidden border border-slate-700 shadow-xl relative">
                                        {/* Photo with dynamic FOV (Zoom) */}
                                        <div 
                                            className="w-full h-48 bg-slate-800 relative cursor-pointer group"
                                            onClick={() => setViewedSubmission(sub)}
                                        >
                                            <SafeImage 
                                                src={`https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${sub.lat},${sub.lng}&heading=${sub.heading}&pitch=${sub.pitch}&fov=${getFov(sub.zoom)}&key=${apiKey}&return_error_code=true`}
                                                alt="Found location"
                                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                            />
                                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none z-10">
                                                <span className="text-white font-bold bg-black/50 px-3 py-1 rounded-full text-sm">Explore</span>
                                            </div>
                                            {statusOverlay}
                                        </div>

                                        <div className="p-4">
                                            <p className="text-lg font-bold text-slate-200 mb-2">
                                                <span className="text-indigo-400">{playersMap[sub.player_id] || 'Unknown'}</span>
                                            </p>
                        
                                            <div className="w-full h-2 bg-slate-700 rounded overflow-hidden flex mb-4">
                                                {/* Voting percentage based on eligible voters */}
                                                <div className="bg-green-500 h-full" style={{ width: `${totalVotesCast ? (yesVotes/totalVotesCast)*100 : 0}%` }}></div>
                                                <div className="bg-red-500 h-full" style={{ width: `${totalVotesCast ? (noVotes/totalVotesCast)*100 : 0}%` }}></div>
                                            </div>

                                            <div className="flex gap-2">
                                                {(() => {
                                                    const subTeam = players.find(p => p.id === sub.player_id)?.team;
                                                    const myTeam = players.find(p => p.id === playerId)?.team;
                                                    const isMySubmission = playerId === sub.player_id;
                                                    const isMyTeamSubmission = teamMode === 'teams' && subTeam !== undefined && subTeam === myTeam;
                                                    
                                                    if (isMySubmission || isMyTeamSubmission) {
                                                        return (
                                                            <div className="flex-1 py-2 text-center text-slate-500 text-xs font-bold uppercase border border-slate-700 rounded bg-slate-800">
                                                                {isMySubmission ? 'Your Submission' : 'Team Submission'}
                                                            </div>
                                                        );
                                                    }
                                                    
                                                    return (
                                                        <>
                                                            <button onClick={() => handleVote(sub, true)} className={`flex-1 py-2 rounded font-bold uppercase text-xs border transition-all ${myVote === true ? 'bg-green-600 border-green-500 text-white' : 'bg-transparent border-slate-600 text-slate-400 hover:border-green-500 hover:text-green-500'}`}>Yes</button>
                                                            <button onClick={() => handleVote(sub, false)} className={`flex-1 py-2 rounded font-bold uppercase text-xs border transition-all ${myVote === false ? 'bg-red-600 border-red-500 text-white' : 'bg-transparent border-slate-600 text-slate-400 hover:border-red-500 hover:text-red-500'}`}>No</button>
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}