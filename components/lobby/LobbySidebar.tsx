'use client';

import { useState, useRef, useEffect } from 'react';
import { FaRegCopy, FaCopy, FaRegEdit, FaPlus, FaRandom, FaTimes } from "react-icons/fa";
import { shuffle } from '../utils/Functions';

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

const darkTeamColors = [
    'bg-emerald-950/40 border-emerald-900/50 text-emerald-200',
    'bg-amber-950/40 border-amber-900/50 text-amber-200',
    'bg-cyan-950/40 border-cyan-900/50 text-cyan-200',
    'bg-slate-950/40 border-slate-900/50 text-slate-200',
    'bg-rose-950/40 border-rose-900/50 text-rose-200',
    'bg-indigo-950/40 border-indigo-900/50 text-indigo-200',
];
const teamNames = ['Team Alpha', 'Team Bravo', 'Team Charlie', 'Team Delta', 'Team Echo', 'Team Foxtrot'];

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
    const [teamCount, setTeamCount] = useState(1);

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsMounted(true);
        }, 0);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (teamMode === 'teams' && players.length > 0) {
            const maxTeam = Math.max(...players.map(p => p.team || 0));
            if (maxTeam >= teamCount) {
                setTeamCount(maxTeam + 1);
            }
        }
    }, [players, teamMode, teamCount]);

    const handleCopyGameId = () => {
        navigator.clipboard.writeText(gameId);
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 800);
    };

    const handleCopyGameLink = () => {
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
        if (error) showToast('Could not update name.');
        else showToast('Name updated.');
        setIsEditingSelfName(false);
    };

    const handleUpdatePlayerTeam = async (targetPlayerId: string, teamIndex: number) => {
        setPlayers(prev => prev.map(p => p.id === targetPlayerId ? { ...p, team: teamIndex } : p));
        const { error } = await supabase.from('players').update({ team: teamIndex }).eq('id', targetPlayerId);
        if (error) showToast('Could not update team.');
    };

    const handleRandomizeTeams = async () => {
        if (teamCount < 2) return;
        
        const shuffledPlayers = shuffle([...players]);
        const updatedPlayers = shuffledPlayers.map((p, i) => ({
            ...p,
            team: i % teamCount
        }));

        setPlayers(updatedPlayers);

        const updates = updatedPlayers.map(p => 
            supabase.from('players').update({ team: p.team }).eq('id', p.id)
        );
        
        await Promise.all(updates);
    };

    const handleRemoveTeam = async (teamIndexToRemove: number) => {
        if (teamCount <= 1) return;

        const updatedPlayers = players.map(p => {
            const currentTeam = p.team || 0;
            if (currentTeam === teamIndexToRemove) {
                return { ...p, team: 0 }; 
            } else if (currentTeam > teamIndexToRemove) {
                return { ...p, team: currentTeam - 1 };
            }
            return p;
        });

        setPlayers(updatedPlayers);
        setTeamCount(prev => prev - 1);

        const updates = updatedPlayers
            .filter(p => (p.team || 0) >= teamIndexToRemove || (players.find(old => old.id === p.id)?.team === teamIndexToRemove))
            .map(p => supabase.from('players').update({ team: p.team }).eq('id', p.id));
        
        await Promise.all(updates);
    };

    // --- Drag & Drop Handler ---
    const handleDragStart = (e: React.DragEvent, draggedPlayerId: string) => {
        e.dataTransfer.setData('playerId', draggedPlayerId);
    };

    const handleDrop = (e: React.DragEvent, teamIndex: number) => {
        e.preventDefault();
        const droppedPlayerId = e.dataTransfer.getData('playerId');
        if (droppedPlayerId) {
            const player = players.find(p => p.id === droppedPlayerId);
            if (player && (player.team || 0) !== teamIndex) {
                handleUpdatePlayerTeam(droppedPlayerId, teamIndex);
            }
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const renderPlayerItem = (p: Player) => (
        <li 
            key={p.id} 
            draggable
            onDragStart={(e) => handleDragStart(e, p.id)}
            className="flex flex-col gap-2 bg-slate-900 p-3 rounded-lg border border-slate-700 cursor-grab active:cursor-grabbing hover:bg-slate-800 transition-colors"
        >
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

            {isHost && p.id !== playerId && (
                <div className="flex gap-2 w-full mt-1 border-t border-slate-800 pt-2">
                    <button type="button" onClick={() => makeHost(p.id)} className="text-[10px] flex-[2] bg-indigo-900/50 text-indigo-400 hover:bg-indigo-600 hover:text-white py-1 rounded">Make Host</button>
                    <button type="button" onClick={() => kickPlayer(p.id)} className="text-[10px] flex-1 bg-orange-900/50 text-orange-400 hover:bg-orange-600 hover:text-white py-1 rounded">Kick</button>
                    <button type="button" onClick={() => banPlayer(p.id)} className="text-[10px] flex-1 bg-red-900/50 text-red-400 hover:bg-red-600 hover:text-white py-1 rounded">Ban</button>
                </div>
            )}
        </li>
    );

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
                        >
                            {copiedId ? <FaCopy /> : <FaRegCopy />}
                        </button>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 p-2 rounded-lg">
                        <span className="text-sm font-bold text-slate-400 w-12 tracking-widest">Link:</span>
                        <span className="flex-1 font-mono text-slate-300 truncate">
                            {isMounted ? (window.location.href.replace('http://', '').replace('https://', '')) : '...'}
                        </span>
                        <button 
                            type="button" 
                            onClick={handleCopyGameLink} 
                            className={`p-2 rounded-md transition-all ${copiedLink ? 'bg-green-600/40 text-green-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-400'}`}
                            title="Copy Game Link"
                        >
                            {copiedLink ? <FaCopy /> : <FaRegCopy />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Player / Teams List */}
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 h-fit">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-slate-300">Players ({players.length})</h2>
                    
                    {/* Team Controls (Only Host or enabled for everyone depending on preference, here visible if teams mode) */}
                    {teamMode === 'teams' && (
                        <div className="flex gap-2">
                            <button 
                                onClick={handleRandomizeTeams}
                                className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition"
                                title="Randomize Teams"
                            >
                                <FaRandom />
                            </button>
                            <button 
                                onClick={() => setTeamCount(prev => Math.min(prev + 1, darkTeamColors.length))}
                                disabled={teamCount >= darkTeamColors.length}
                                className={`p-2 rounded transition ${teamCount >= darkTeamColors.length ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                                title="Add Team"
                            >
                                <FaPlus />
                            </button>
                        </div>
                    )}
                </div>

                {/* Free For All Mode */}
                {teamMode === 'ffa' && (
                    <ul className="space-y-3">
                        {players.map(renderPlayerItem)}
                    </ul>
                )}

                {/* Teams Mode */}
                {teamMode === 'teams' && (
                    <div className="space-y-4">
                        {Array.from({ length: teamCount }).map((_, teamIndex) => {
                            const teamPlayers = players.filter(p => (p.team || 0) === teamIndex);
                            const colorClass = darkTeamColors[teamIndex % darkTeamColors.length];
                            
                            return (
                                <div 
                                    key={teamIndex}
                                    onDrop={(e) => handleDrop(e, teamIndex)}
                                    onDragOver={handleDragOver}
                                    className={`p-3 rounded-xl border-2 transition-all ${colorClass} min-h-[100px] relative`}
                                >
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-xs font-bold uppercase opacity-80 tracking-wider">
                                            {teamNames[teamIndex % teamNames.length]} ({teamPlayers.length})
                                        </h3>
                                        
                                        {teamCount > 1 && (
                                            <button 
                                                onClick={() => handleRemoveTeam(teamIndex)}
                                                className="text-current opacity-50 hover:opacity-100 hover:text-red-400 transition-all p-1"
                                                title="Team entfernen"
                                            >
                                                <FaTimes />
                                            </button>
                                        )}
                                    </div>
                                    
                                    <div className="space-y-2">
                                        {teamPlayers.length > 0 ? (
                                            teamPlayers.map(renderPlayerItem)
                                        ) : (
                                            <div className="text-center text-xs opacity-50 py-2 border-2 border-dashed border-current rounded-lg">
                                                Spieler hierher ziehen
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {isHost ? (
                    <button type="button" 
                        onClick={handleStartGame} 
                        disabled={categories.length === 0}
                        className={`w-full py-4 rounded-xl font-bold mt-8 tracking-wider uppercase ${categories.length === 0 ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white'}`}
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