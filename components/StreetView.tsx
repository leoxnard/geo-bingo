'use client';


import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleMap, useJsApiLoader, StreetViewPanorama } from '@react-google-maps/api';
import { supabase } from '../lib/supabase';
import { FaEye, FaCamera } from 'react-icons/fa';
import Image from 'next/image';

const safeStartCenter = { lat: 20, lng: 0 };
const initialWorldZoom = 1.5;
const mapOptions = { streetViewControl: true, mapTypeControl: false, gestureHandling: 'greedy', fullscreenControl: false, zoomControl: false };
const panoOptions = { 
    addressControl: false, 
    showRoadLabels: false, 
    enableCloseButton: false, 
    fullscreenControl: false,
    zoomControl: false,
    panControl: false,
    linksControl: false,
    visible: false,
};

interface Submission {
    id: string; category: string; lat: number; lng: number; heading: number; pitch: number; zoom: number;
}

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
}

interface StreetViewProps {
    categories: string[]; 
    gameId: string; 
    playerId: string; 
    gameMode?: 'list' | 'bingo'; 
    gridSize?: number;
    renderToast: () => React.ReactNode;
    timeLeft: number;
    readyPlayers: string[];
    players: Player[];
}

export default function StreetView({ 
    categories, gameId, playerId, gameMode = 'list', gridSize = 3, renderToast, timeLeft, readyPlayers, players
}: StreetViewProps) {
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
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

        if (updatedReadyPlayers.length >= votesNeeded) {
            // End the round for everyone immediately
            await supabase.from('games').update({ 
                ready_players: updatedReadyPlayers, 
                status: 'voting' 
            }).eq('id', gameId);
        } else {
            // Just record the player's vote
            await supabase.from('games').update({ ready_players: updatedReadyPlayers }).eq('id', gameId);
        }
    };

    const toggleFullscreen = async () => {
        if (!containerRef.current) return;
    
        if (!document.fullscreenElement) {
            try {
                await containerRef.current.requestFullscreen();
                setIsFullscreen(true);
            } catch (err) {
                console.error("Error attempting to enable fullscreen:", err);
            }
        } else {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
                setIsFullscreen(false);
            }
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
        const fetchMySubmissions = async () => {
            const { data } = await supabase.from('submissions').select('*').eq('game_id', gameId).eq('player_id', playerId);
            if (data) setMySubmissions(data);
        };
        fetchMySubmissions();
    }, [gameId, playerId]);

    // useCallback prevents infinite loop spamming Google API!
    const onLoad = useCallback((pano: google.maps.StreetViewPanorama) => {
        streetViewRef.current = pano;
    
        pano.setOptions({ source: google.maps.StreetViewSource.OUTDOOR } as any);
    
        pano.addListener('visible_changed', () => {
            setInStreetView(pano.getVisible());
        });
    }, []);

    const onUnmount = useCallback(() => {
        streetViewRef.current = null;
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

        const existingSub = mySubmissions.find(s => s.category === targetCategory);
        if (existingSub) {
            await supabase.from('submissions').update(submissionData).eq('id', existingSub.id);
            setMySubmissions(prev => prev.map(s => s.id === existingSub.id ? { ...s, ...submissionData } : s));
        } else {
            const { data } = await supabase.from('submissions').insert([submissionData]).select().single();
            if (data) setMySubmissions(prev => [...prev, data]);
        }
        setSubmittingCategory(null);
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
                    <Image 
                        src="/mappin.and.ellipse.png"
                        alt="Geo Bingo Logo"
                        loading="eager"
                        width={40}
                        height={40}
                        className="w-auto h-auto drop-shadow-[0_0_10px_rgba(96,165,250,0.5)] transform-gpu"
                    />
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
                        <button 
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
                            <GoogleMap key={gameId} mapContainerClassName="google-map-container absolute inset-0" center={safeStartCenter} zoom={initialWorldZoom} options={mapOptions}>
                                {/* Safely pass onLoad and onUnmount */}
                                <StreetViewPanorama options={panoOptions} onLoad={onLoad} onUnmount={onUnmount} />
                            </GoogleMap>

                            {/* Custom Fullscreen Button */}
                            {!isMobileLandscape && (
                                <button
                                    type="button"
                                    onClick={toggleFullscreen}
                                    className="absolute top-2 right-2 z-[1000] hidden sm:flex w-12 h-12 bg-slate-800/30 hover:bg-slate-700/80 text-white items-center justify-center rounded-md shadow-[0_0_15px_rgba(0,0,0,0.4)] border border-slate-500 font-bold transition-transform hover:scale-105 active:scale-95 backdrop-blur-sm"
                                    title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                                >
                                    {isFullscreen ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                                        </svg>
                                    )} 
                                </button>
                            )}

                            {inStreetView && (
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
                                    {mySubmissions.length} / {categories.length}
                                </span>
                            </div>
                    
                            {gameMode === 'list' ? (
                                <ul className="flex flex-col gap-3 flex-1">
                                    {categories.map((cat) => {
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
                                                    <span className={`text-xs font-bold uppercase whitespace-nowrap ${foundSub ? 'text-green-500' : 'text-slate-500'}`}>
                                                        {foundSub ? 'Found' : 'Pending'}
                                                    </span>
                                                </div>
                            
                                                <div className="flex justify-between items-center gap-2 mt-1">
                                                    {!foundSub ? (
                                                        <button 
                                                            type="button"
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
                                    {categories.map((cat) => {
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
                                                        <button 
                                                            type="button"
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