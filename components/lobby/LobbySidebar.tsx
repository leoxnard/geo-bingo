'use client';

/*
================================================================================
LOBBY SIDEBAR COMPONENT
================================================================================
Manages player list, game settings, and lobby controls.
Handles player joining, team assignment, and game start functionality.
Provides game code sharing and lobby management features.
================================================================================
*/

import { useState, useRef, useEffect } from 'react';

import toast from 'react-hot-toast';
import { FaRegCopy, FaCopy, FaRegEdit, FaPlus, FaRandom, FaTimes, FaEye, FaEyeSlash } from 'react-icons/fa';

import { ToggleSwitch } from '../utils/Elements';
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
    makeHost: (id: string) => void;
    kickPlayer: (id: string) => void;
    banPlayer: (id: string) => void;
    handleStartGame: () => void;
    handleLeaveLobby: () => void;
    setPlayers: (players: Player[] | ((prev: Player[]) => Player[])) => void;
    hideMapSymbols: boolean;
    hideMiniMap: boolean;
    blurLobbyInfo: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateGameModeInfo: (updates: any) => void;
    categorySource: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';
    isGenerating: boolean;
}

const darkTeamColors = ['bg-emerald-950/40 border-emerald-900/50 text-emerald-200', 'bg-amber-950/40 border-amber-900/50 text-amber-200', 'bg-cyan-950/40 border-cyan-900/50 text-cyan-200', 'bg-slate-950/40 border-slate-900/50 text-slate-200', 'bg-rose-950/40 border-rose-900/50 text-rose-200', 'bg-indigo-950/40 border-indigo-900/50 text-indigo-200'];
const teamNames = ['Team Alpha', 'Team Bravo', 'Team Charlie', 'Team Delta', 'Team Echo', 'Team Foxtrot'];

export default function LobbySidebar(props: LobbySidebarProps) {
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

    const maxTeam = props.players.length > 0 ? Math.max(...props.players.map((p) => p.team || 0)) : 0;
    const displayTeamCount = props.teamMode === 'teams' ? Math.max(teamCount, maxTeam + 1) : teamCount;

    const handleCopyGameId = () => {
        navigator.clipboard.writeText(props.gameId);
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
        const currentName = props.players.find((p) => p.id === props.playerId)?.name || '';
        const nextName = selfNameInput.trim();

        if (!nextName || nextName === currentName) {
            setIsEditingSelfName(false);
            return;
        }

        localStorage.setItem('geoBingoPlayerName', nextName);
        props.setPlayers((prev) => prev.map((p) => (p.id === props.playerId ? { ...p, name: nextName } : p)));

        const { error } = await props.supabase.from('players').update({ name: nextName }).eq('id', props.playerId);
        if (error) toast.error('Could not update name.');
        else toast.success('Name updated.');
        setIsEditingSelfName(false);
    };

    const handleUpdatePlayerTeam = async (targetPlayerId: string, teamIndex: number) => {
        props.setPlayers((prev) => prev.map((p) => (p.id === targetPlayerId ? { ...p, team: teamIndex } : p)));
        const { error } = await props.supabase.from('players').update({ team: teamIndex }).eq('id', targetPlayerId);
        if (error) toast.error('Could not update team.');
    };

    const handleRandomizeTeams = async () => {
        if (displayTeamCount < 2) return;

        const shuffledPlayers = shuffle([...props.players]);
        const updatedPlayers = shuffledPlayers.map((p, i) => ({
            ...p,
            team: i % displayTeamCount,
        }));

        props.setPlayers(updatedPlayers);

        const updates = updatedPlayers.map((p) => props.supabase.from('players').update({ team: p.team }).eq('id', p.id));

        await Promise.all(updates);
    };

    const handleRemoveTeam = async (teamIndexToRemove: number) => {
        if (displayTeamCount <= 1) return;

        const updatedPlayers = props.players.map((p) => {
            const currentTeam = p.team || 0;
            if (currentTeam === teamIndexToRemove) {
                return { ...p, team: 0 };
            } else if (currentTeam > teamIndexToRemove) {
                return { ...p, team: currentTeam - 1 };
            }
            return p;
        });

        props.setPlayers(updatedPlayers);
        setTeamCount(displayTeamCount - 1);

        const updates = updatedPlayers.filter((p) => (p.team || 0) >= teamIndexToRemove || props.players.find((old) => old.id === p.id)?.team === teamIndexToRemove).map((p) => props.supabase.from('players').update({ team: p.team }).eq('id', p.id));

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
            const player = props.players.find((p) => p.id === droppedPlayerId);
            if (player && (player.team || 0) !== teamIndex) {
                handleUpdatePlayerTeam(droppedPlayerId, teamIndex);
            }
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const renderPlayerItem = (p: Player) => (
        <li key={p.id} draggable onDragStart={(e) => handleDragStart(e, p.id)} className="flex flex-col gap-2 bg-slate-900 p-3 rounded-lg border border-slate-700 cursor-grab active:cursor-grabbing hover:bg-slate-800 transition-colors">
            <div className="flex items-center gap-3">
                <div className={`min-w-[8px] h-2 rounded-full animate-pulse ${props.onlinePlayers.includes(p.id) ? 'bg-green-500' : 'bg-orange-500'}`} />
                <div className="flex-1 min-w-0 flex items-center gap-2">
                    {p.id === props.playerId && isEditingSelfName ? (
                        <input title="rename_input" ref={selfNameInputRef} value={selfNameInput} onChange={(e) => setSelfNameInput(e.target.value)} onBlur={saveSelfName} onKeyDown={(e) => e.key === 'Enter' && saveSelfName()} className="flex-1 bg-transparent border-b border-indigo-400 outline-none text-white" autoFocus />
                    ) : (
                        <span className={`flex-1 truncate ${p.id === props.playerId ? 'text-green-400' : 'text-white'}`}>
                            {p.name} {p.id === props.gameHostId ? '(Host)' : ''}
                        </span>
                    )}
                    {p.id === props.playerId && (
                        <button
                            type="button"
                            title="rename"
                            onClick={() => {
                                setSelfNameInput(p.name);
                                setIsEditingSelfName(true);
                            }}
                            className="text-slate-400 hover:text-white"
                        >
                            <FaRegEdit className="text-xs" />
                        </button>
                    )}
                </div>
            </div>

            {props.isHost && p.id !== props.playerId && (
                <div className="flex gap-2 w-full mt-1 border-t border-slate-800 pt-2">
                    <button type="button" onClick={() => props.makeHost(p.id)} className="text-[10px] flex-[2] bg-indigo-900/50 text-indigo-400 hover:bg-indigo-600 hover:text-white py-1 rounded">
                        Make Host
                    </button>
                    <button type="button" onClick={() => props.kickPlayer(p.id)} className="text-[10px] flex-1 bg-orange-900/50 text-orange-400 hover:bg-orange-600 hover:text-white py-1 rounded">
                        Kick
                    </button>
                    <button type="button" onClick={() => props.banPlayer(p.id)} className="text-[10px] flex-1 bg-red-900/50 text-red-400 hover:bg-red-600 hover:text-white py-1 rounded">
                        Ban
                    </button>
                </div>
            )}
        </li>
    );

    return (
        <div className="flex flex-col gap-4 sm:gap-6 w-full lg:w-80">
            {/* Invite Box */}
            <div className="bg-slate-800 p-4 sm:p-6 rounded-xl border border-slate-700 h-fit">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-slate-300">Invite Friends</h2>
                    {props.isHost && (
                        <button
                            type="button"
                            onClick={() => props.updateGameModeInfo({ blur_lobby_info: !props.blurLobbyInfo })}
                            className="p-2 mr-2 rounded-md transition-all bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200"
                            title={props.blurLobbyInfo ? 'Show lobby ID & link' : 'Blur lobby ID & link'}
                        >
                            {props.blurLobbyInfo ? <FaEyeSlash /> : <FaEye />}
                        </button>
                    )}
                </div>
                <div className="space-y-3">
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 p-2 rounded-lg overflow-hidden">
                        <span className="text-sm font-bold text-slate-400 w-12 tracking-widest shrink-0">ID:</span>
                        <span className="flex-1 min-w-0 font-mono text-slate-300 text-lg truncate select-none px-2" style={props.blurLobbyInfo ? { color: 'transparent', textShadow: '0 0 12px rgba(203, 213, 225, 0.9), 0 0 6px rgba(203, 213, 225, 0.7)' } : undefined}>{props.gameId}</span>
                        <button type="button" onClick={handleCopyGameId} className={`shrink-0 p-2 rounded-md transition-all ${copiedId ? 'bg-green-600/40 text-green-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-400'}`} title="Copy Game ID">
                            {copiedId ? <FaCopy /> : <FaRegCopy />}
                        </button>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 p-2 rounded-lg overflow-hidden">
                        <span className="text-sm font-bold text-slate-400 w-12 tracking-widest shrink-0">Link:</span>
                        <span className="flex-1 min-w-0 font-mono text-slate-300 truncate select-none px-2" style={props.blurLobbyInfo ? { color: 'transparent', textShadow: '0 0 12px rgba(203, 213, 225, 0.9), 0 0 6px rgba(203, 213, 225, 0.7)' } : undefined}>{isMounted ? window.location.href.replace('http://', '').replace('https://', '') : '...'}</span>
                        <button type="button" onClick={handleCopyGameLink} className={`shrink-0 p-2 rounded-md transition-all ${copiedLink ? 'bg-green-600/40 text-green-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-400'}`} title="Copy Game Link">
                            {copiedLink ? <FaCopy /> : <FaRegCopy />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Player / Teams List */}
            <div className="bg-slate-800 p-4 sm:p-6 rounded-xl border border-slate-700 h-fit">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-slate-300">Players ({props.players.length})</h2>

                    {/* Team Controls (Only Host or enabled for everyone depending on preference, here visible if teams mode) */}
                    {props.teamMode === 'teams' && (
                        <div className="flex gap-2">
                            <button onClick={handleRandomizeTeams} className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition" title="Randomize Teams">
                                <FaRandom />
                            </button>
                            <button onClick={() => setTeamCount(Math.min(displayTeamCount + 1, darkTeamColors.length))} disabled={displayTeamCount >= darkTeamColors.length} className={`p-2 rounded-lg transition ${displayTeamCount >= darkTeamColors.length ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`} title="Add Team">
                                <FaPlus />
                            </button>
                        </div>
                    )}
                </div>

                {/* Free For All Mode */}
                {props.teamMode === 'ffa' && <ul className="space-y-3">{props.players.map(renderPlayerItem)}</ul>}

                {/* Teams Mode */}
                {props.teamMode === 'teams' && (
                    <div className="space-y-4">
                        {Array.from({ length: displayTeamCount }).map((_, teamIndex) => {
                            const teamPlayers = props.players.filter((p) => (p.team || 0) === teamIndex);
                            const colorClass = darkTeamColors[teamIndex % darkTeamColors.length];

                            return (
                                <div key={teamIndex} onDrop={(e) => handleDrop(e, teamIndex)} onDragOver={handleDragOver} className={`p-3 rounded-xl border-2 transition-all ${colorClass} min-h-[100px] relative`}>
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-xs font-bold uppercase opacity-80 tracking-wider">
                                            {teamNames[teamIndex % teamNames.length]} ({teamPlayers.length})
                                        </h3>

                                        {displayTeamCount > 1 && (
                                            <button onClick={() => handleRemoveTeam(teamIndex)} className="text-current opacity-50 hover:opacity-100 hover:text-red-400 transition-all p-1" title="Team entfernen">
                                                <FaTimes />
                                            </button>
                                        )}
                                    </div>

                                    <div className="space-y-2">{teamPlayers.length > 0 ? teamPlayers.map(renderPlayerItem) : <div className="text-center text-xs opacity-50 py-2 border-2 border-dashed border-current rounded-lg">Drop players here</div>}</div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {props.isHost ? (
                    <button
                        type="button"
                        onClick={props.handleStartGame}
                        disabled={(props.categories.length === 0 && (props.categorySource === 'manual' || props.categorySource === 'ai')) || props.isGenerating}
                        className={`w-full py-4 rounded-xl font-bold mt-8 tracking-wider ${(props.categories.length === 0 && (props.categorySource === 'manual' || props.categorySource === 'ai')) || props.isGenerating ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-green-700 text-white hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-500'}`}
                    >
                        {props.isGenerating ? 'Generating...' : 'Start Game'}
                    </button>
                ) : (
                    <div className="w-full bg-slate-700 text-slate-400 text-center py-4 rounded-xl font-bold mt-8">{props.isGenerating ? 'Generating...' : 'Waiting for host...'}</div>
                )}

                <button type="button" onClick={props.handleLeaveLobby} className="w-full py-3 rounded-xl font-bold mt-3 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors">
                    Leave Lobby
                </button>
            </div>
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 h-fit">
                <h2 className="text-xl font-semibold mb-6 text-slate-100 border-b border-slate-700 pb-3">More Game Settings</h2>

                <div className="flex flex-col gap-5">
                    <ToggleSwitch label="Hide Map Symbols (POIs)" checked={props.hideMapSymbols} disabled={!props.isHost} onChange={(checked) => props.updateGameModeInfo({ hide_map_symbols: checked })} />
                    <ToggleSwitch label="Hide Mini Map" checked={props.hideMiniMap} disabled={!props.isHost} onChange={(checked) => props.updateGameModeInfo({ hide_minimap: checked })} />
                    {!props.isHost && <p className="text-xs text-slate-500 pt-4 border-t border-slate-700/50 text-center">Only the game host can change these settings.</p>}
                </div>
            </div>
        </div>
    );
}
