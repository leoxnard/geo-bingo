'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import SafeImage from './SafeImage';
import { TbMinusVertical } from 'react-icons/tb';

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

interface VotingViewProps {
  gameId: string;
  isHost: boolean;
  categories: string[];
  playerId: string;
  totalPlayers: number;
  onFinishGame: () => void; // New prop to trigger the podium
}

export default function VotingView({ gameId, isHost, categories, playerId, totalPlayers, onFinishGame }: VotingViewProps) {
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [playersMap, setPlayersMap] = useState<Record<string, string>>({});
    const [activeCategory, setActiveCategory] = useState(categories[0]);
    const [zoomedImage, setZoomedImage] = useState<string | null>(null); // For image enlargement

    useEffect(() => {
        const fetchData = async () => {
            const { data: subData } = await supabase.from('submissions').select('*').eq('game_id', gameId);
            if (subData) setSubmissions(subData);

            const { data: playerData } = await supabase.from('players').select('id, name').eq('game_id', gameId);
            if (playerData) {
                const pMap: Record<string, string> = {};
                playerData.forEach(p => pMap[p.id] = p.name);
                setPlayersMap(pMap);
            }
        };
        fetchData();

        const channel = supabase.channel(`voting-${gameId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `game_id=eq.${gameId}` }, 
                (payload) => {
                    setSubmissions(prev => prev.map(s => s.id === payload.new.id ? { ...s, votes: payload.new.votes, is_valid: payload.new.is_valid } : s));
                }
            ).subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [gameId]);

    const handleVote = async (sub: Submission, voteIsYes: boolean) => {
        const newVotes = { ...sub.votes, [playerId]: voteIsYes };
        setSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, votes: newVotes } : s));
        await supabase.from('submissions').update({ votes: newVotes }).eq('id', sub.id);
    };

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const navigableCategories = categories.filter(cat => submissions.some(s => s.category === cat));
    const currentCategory = navigableCategories.includes(activeCategory)
        ? activeCategory
        : (navigableCategories[0] ?? activeCategory);
    const activeSubmissions = submissions.filter(s => s.category === currentCategory);

    // Convert JS API Zoom to Static API FOV (Field of View)
    // Zoom 1 = 90 FOV, Zoom 2 = 45 FOV, etc. Max FOV allowed by Google is 120.
    const getFov = (zoom: number) => {
        const validZoom = zoom || 1;
        return Math.min(120, Math.max(10, 180 / Math.pow(2, validZoom)));
    };

    // Check how many players have voted on EVERYTHING
    const playersWhoFinishedVoting = Object.keys(playersMap).filter(pId => {
    // A player is finished if they have a vote mapped in EVERY submission (except their own)
        return submissions.every(sub => {
            if (sub.player_id === pId) return true; // Don't vote on own submissions
            const voteMap = sub.votes || {};
            return voteMap[pId] !== undefined; // They voted Yes or No
        });
    });

    const goToPrevCategory = () => {
        if (navigableCategories.length <= 1) return;
        const currentIndex = navigableCategories.indexOf(currentCategory);
        const prevIndex = currentIndex <= 0 ? navigableCategories.length - 1 : currentIndex - 1;
        setActiveCategory(navigableCategories[prevIndex]);
    };

    const goToNextCategory = () => {
        if (navigableCategories.length <= 1) return;
        const currentIndex = navigableCategories.indexOf(currentCategory);
        const nextIndex = currentIndex === -1 || currentIndex >= navigableCategories.length - 1 ? 0 : currentIndex + 1;
        setActiveCategory(navigableCategories[nextIndex]);
    };

    return (
        <div className="w-full flex flex-col lg:flex-row gap-8 text-white">
            {/* FULLSCREEN IMAGE MODAL */}
            {zoomedImage && (
                <div 
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
                    onClick={() => setZoomedImage(null)}
                >
                    <SafeImage 
                        src={zoomedImage} 
                        alt="Zoomed location" 
                        className="w-auto h-auto max-w-[95vw] max-h-[90vh] object-contain rounded-2xl shadow-2xl border-4 border-slate-700" 
                    />
                    <div className="absolute top-8 right-8 text-white font-bold bg-slate-900/50 px-4 py-2 rounded-full backdrop-blur-sm">
                        Click to close
                    </div>
                </div>
            )}

            {/* LEFT: Category Selection */}
            <div className="w-full lg:w-64 flex flex-col gap-2">
                <h2 className="text-xl font-bold text-slate-400 mb-4 uppercase tracking-wider">Categories</h2>
                {navigableCategories.map(cat => {
                    const categorySubs = submissions.filter(s => s.category === cat);
                    const count = categorySubs.length;
          
                    let badgeColor = "bg-slate-700 text-slate-400"; // Default for 0 submissions
                    if (count > 0) {
                        const isFinished = categorySubs.every(sub => {
                            if (sub.player_id === playerId) return true; // you don't vote on your own
                            return sub.votes && sub.votes[playerId] !== undefined;
                        });
                        // light red/gray if unfinished, green/gray if finished
                        badgeColor = isFinished ? "bg-green-900/50 text-green-400 border border-green-800/50" : "bg-red-900/50 text-red-400 border border-red-800/50";
                    }

                    return (
                        <button
                            key={cat} onClick={() => setActiveCategory(cat)}
                            className={`text-left px-4 py-3 rounded-xl font-medium transition-all flex justify-between items-center ${
                                currentCategory === cat ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                            }`}
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
                            disabled={navigableCategories.length <= 1}
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
                            disabled={navigableCategories.length <= 1}
                            className="p-3 hover:bg-slate-700 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                            title="Next category"
                            aria-label="Next category"
                        >
                            <span className="text-lg leading-none">&gt;</span>
                        </button>
                    </div>
                </div>
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
                                    className="w-full h-48 bg-slate-800 relative cursor-zoom-in group"
                                    onClick={() => setZoomedImage(`https://maps.googleapis.com/maps/api/streetview?size=1200x800&location=${sub.lat},${sub.lng}&heading=${sub.heading}&pitch=${sub.pitch}&fov=${getFov(sub.zoom)}&key=${apiKey}&return_error_code=true`)}
                                >
                                    <SafeImage 
                                        src={`https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${sub.lat},${sub.lng}&heading=${sub.heading}&pitch=${sub.pitch}&fov=${getFov(sub.zoom)}&key=${apiKey}&return_error_code=true`}
                                        alt="Found location"
                                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                    />
                                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                        <span className="text-white font-bold bg-black/50 px-3 py-1 rounded-full text-sm">🔍 Enlarge</span>
                                    </div>
                                    {statusOverlay}
                                </div>

                                <div className="p-4">
                                    <p className="text-lg font-bold text-slate-200 mb-2">
                                        <span className="text-indigo-400">{playersMap[sub.player_id] || 'Unknown'}</span>
                                    </p>
                
                                    <div className="w-full h-2 bg-slate-700 rounded overflow-hidden flex mb-4">
                                        {/* Voting percentage based on totalPlayers - 1 */}
                                        <div className="bg-green-500 h-full" style={{ width: `${totalVotesCast ? (yesVotes/Math.max(1, totalPlayers - 1))*100 : 0}%` }}></div>
                                        <div className="bg-red-500 h-full" style={{ width: `${totalVotesCast ? (noVotes/Math.max(1, totalPlayers - 1))*100 : 0}%` }}></div>
                                    </div>

                                    <div className="flex gap-2">
                                        {playerId === sub.player_id ? (
                                            <div className="flex-1 py-2 text-center text-slate-500 text-xs font-bold uppercase border border-slate-700 rounded bg-slate-800">
                                                Your Submission
                                            </div>
                                        ) : (
                                            <>
                                                <button onClick={() => handleVote(sub, true)} className={`flex-1 py-2 rounded font-bold uppercase text-xs border transition-all ${myVote === true ? 'bg-green-600 border-green-500 text-white' : 'bg-transparent border-slate-600 text-slate-400 hover:border-green-500 hover:text-green-500'}`}>Yes</button>
                                                <button onClick={() => handleVote(sub, false)} className={`flex-1 py-2 rounded font-bold uppercase text-xs border transition-all ${myVote === false ? 'bg-red-600 border-red-500 text-white' : 'bg-transparent border-slate-600 text-slate-400 hover:border-red-500 hover:text-red-500'}`}>No</button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}