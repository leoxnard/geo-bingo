'use client';

import { useState, useRef, useEffect } from 'react';
import { FaRegCopy, FaCopy, FaRegEdit } from "react-icons/fa";

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
}

interface LobbySidebarProps {
    gameId: string;
    players: Player[];
    onlinePlayers: string[];
    playerId: string;
    gameHostId: string;
    isHost: boolean;
    teamMode: 'ffa' | 'teams';
    categories: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    showToast: (message: string) => void;
    makeHost: (id: string) => void;
    kickPlayer: (id: string) => void;
    banPlayer: (id: string) => void;
    handleStartGame: () => void;
    handleLeaveLobby: () => void;
    setPlayers: (players: Player[] | ((prev: Player[]) => Player[])) => void;
}

const teamColors = ['bg-indigo-500', 'bg-rose-500', 'bg-emerald-500', 'bg-amber-500'];
const teamNames = ['Blue Team', 'Red Team', 'Green Team', 'Yellow Team'];

export default function LobbySidebar({
    gameId, players, onlinePlayers, playerId, gameHostId, isHost,
    teamMode, categories, supabase, showToast, makeHost, kickPlayer,
    banPlayer, handleStartGame, handleLeaveLobby, setPlayers
}: LobbySidebarProps) {
    const [copiedId, setCopiedId] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [isEditingSelfName, setIsEditingSelfName] = useState(false);
    const [selfNameInput, setSelfNameInput] = useState('');
    const selfNameInputRef = useRef<HTMLInputElement>(null);
    
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsMounted(true);
        }, 0);
        
        return () => clearTimeout(timer);
    }, []);

    const handleCopyGameId = () => {
        navigator.clipboard.writeText(gameId);
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 800);
    };

    const handleCopyGameLink = () => {
        // Read directly from the browser window when clicked
        if (typeof window !== 'undefined') {
            navigator.clipboard.writeText(window.location.href);
            setCopiedLink(true);
            setTimeout(() => setCopiedLink(false), 800);
        }
    };

    const saveSelfName = async () => {
        const currentName = players.find(p => p.id === playerId)?.name || '';
        const nextName = selfNameInput.trim();

        if (!nextName || nextName === currentName) {
            setIsEditingSelfName(false);
            return;
        }

        localStorage.setItem('geoBingoPlayerName', nextName);
        setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, name: nextName } : p));

        const { error } = await supabase.from('players').update({ name: nextName }).eq('id', playerId);
        if (error) {
            showToast('Could not update name.');
        } else {
            showToast('Name updated.');
        }
        setIsEditingSelfName(false);
    };

    const handleUpdateSelfTeam = async (teamIndex: number) => {
        setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, team: teamIndex } : p));
        const { error } = await supabase.from('players').update({ team: teamIndex }).eq('id', playerId);
        if (error) showToast('Could not update team.');
    };

    return (
        <div className="flex flex-col gap-6 w-full lg:w-80">
            {/* Invite Box */}
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 h-fit">
                <h2 className="text-xl font-semibold mb-4 text-slate-300">Invite Friends</h2>
                <div className="space-y-3">
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 p-2 rounded-lg">
                        <span className="text-sm font-bold text-slate-400 w-12 tracking-widest">ID:</span>
                        <span className="flex-1 font-mono text-slate-300 text-lg truncate">{gameId}</span>
                        <button 
                            type="button" 
                            onClick={handleCopyGameId} 
                            className={`p-2 rounded-md transition-all ${copiedId ? 'bg-green-600/40 text-green-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-400'}`}
                            title="Copy Game ID"
                            aria-label="Copy Game ID"
                        >
                            {copiedId ? <FaCopy /> : <FaRegCopy />}
                        </button>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 p-2 rounded-lg">
                        <span className="text-sm font-bold text-slate-400 w-12 tracking-widest">Link:</span>
                        <span className="flex-1 font-mono text-slate-300 truncate">
                            {isMounted ? window.location.href : '...'}
                        </span>
                        <button 
                            type="button" 
                            onClick={handleCopyGameLink} 
                            className={`p-2 rounded-md transition-all ${copiedLink ? 'bg-green-600/40 text-green-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-400'}`}
                            title="Copy Game Link"
                            aria-label="Copy Game Link"
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
                                <div className={`min-w-[8px] h-2 rounded-full animate-pulse ${onlinePlayers.includes(p.id) ? 'bg-green-500' : 'bg-orange-500'}`} />
                                <div className="flex-1 min-w-0 flex items-center gap-2">
                                    {p.id === playerId && isEditingSelfName ? (
                                        <input
                                            title='rename_input'
                                            ref={selfNameInputRef}
                                            value={selfNameInput}
                                            onChange={e => setSelfNameInput(e.target.value)}
                                            onBlur={saveSelfName}
                                            onKeyDown={e => e.key === 'Enter' && saveSelfName()}
                                            className="flex-1 bg-transparent border-b border-indigo-400 outline-none text-white"
                                            autoFocus
                                        />
                                    ) : (
                                        <span className={`flex-1 truncate ${p.id === playerId ? 'text-green-400' : 'text-white'}`}>
                                            {p.name} {p.id === gameHostId ? '(Host)' : ''}
                                        </span>
                                    )}
                                    {p.id === playerId && (
                                        <button type="button" title='rename' onClick={() => { setSelfNameInput(p.name); setIsEditingSelfName(true); }} className="text-slate-400 hover:text-white">
                                            <FaRegEdit className="text-xs" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {teamMode === 'teams' && (
                                <div className="flex items-center justify-between mt-1 border-t border-slate-800 pt-2">
                                    <span className="text-xs text-slate-400 font-semibold uppercase">Team</span>
                                    {p.id === playerId ? (
                                        <div className="flex gap-2">
                                            {teamColors.map((color, idx) => (
                                                <button type="button" 
                                                    key={idx} 
                                                    onClick={() => handleUpdateSelfTeam(idx)}
                                                    className={`w-5 h-5 rounded-full border-2 transition-all ${color} ${(p.team || 0) === idx ? 'border-white scale-110' : 'border-slate-800 opacity-40 hover:opacity-100'}`}
                                                    title={teamNames[idx]}
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className={`text-[10px] px-2 py-0.5 rounded text-white font-bold ${teamColors[p.team || 0]}`}>
                                            {teamNames[p.team || 0]}
                                        </div>
                                    )}
                                </div>
                            )}

                            {isHost && p.id !== playerId && (
                                <div className="flex gap-2 w-full mt-1 border-t border-slate-800 pt-2">
                                    <button type="button" onClick={() => makeHost(p.id)} className="text-[10px] flex-[2] bg-indigo-900/50 text-indigo-400 hover:bg-indigo-600 hover:text-white py-1 rounded">Make Host</button>
                                    <button type="button" onClick={() => kickPlayer(p.id)} className="text-[10px] flex-1 bg-orange-900/50 text-orange-400 hover:bg-orange-600 hover:text-white py-1 rounded">Kick</button>
                                    <button type="button" onClick={() => banPlayer(p.id)} className="text-[10px] flex-1 bg-red-900/50 text-red-400 hover:bg-red-600 hover:text-white py-1 rounded">Ban</button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>

                {isHost ? (
                    <button type="button" 
                        onClick={handleStartGame} 
                        disabled={categories.length === 0}
                        className={`w-full py-4 rounded-xl font-bold mt-8 tracking-wider uppercase ${categories.length === 0 ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500'}`}
                    >
                        START GAME
                    </button>
                ) : (
                    <div className="w-full bg-slate-700 text-slate-400 text-center py-4 rounded-xl font-bold mt-8 uppercase">Waiting for host...</div>
                )}

                <button type="button" onClick={handleLeaveLobby} className="w-full py-3 rounded-xl font-bold mt-3 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors">
                    LEAVE LOBBY
                </button>
            </div>
        </div>
    );
}