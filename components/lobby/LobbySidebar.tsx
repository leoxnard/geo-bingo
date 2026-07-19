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

import type { SupabaseClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import { FaRegCopy, FaCopy, FaRegEdit, FaPlus, FaRandom, FaTimes, FaEye, FaEyeSlash } from 'react-icons/fa';

import InviteFriendsButton from '@/components/invites/InviteFriendsButton';
import { FEATURES } from '@/lib/featureFlags';
import { useT } from '@/lib/i18n/I18nProvider';
import { categoryLanguageForLocale, CategoryLanguage, Locale, LOCALE_CODES, LOCALES } from '@/lib/i18n/locales';

import { Selection, ToggleSwitch } from '../utils/Elements';
import { shuffle } from '../utils/Functions';

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
    category_locale?: string | null;
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
    supabase: SupabaseClient;
    makeHost: (id: string) => void;
    kickPlayer: (id: string) => void;
    banPlayer: (id: string) => void;
    handleStartGame: () => void;
    handleLeaveLobby: () => void;
    setPlayers: (players: Player[] | ((prev: Player[]) => Player[])) => void;
    hideMapSymbols: boolean;
    hideMiniMap: boolean;
    aiEndGame: boolean;
    anonymousVoting: boolean;
    language: CategoryLanguage;
    updateGameModeInfo: (updates: Record<string, unknown>) => void;
    onCategoryLanguageChange?: (newLanguage: CategoryLanguage) => Promise<void>;
    translateCategories: boolean;
    displayLocale: Locale;
    onDisplayLocaleChange: (locale: Locale) => void;
    categorySource: 'manual' | 'ai' | 'nearbyPlaces' | 'nearbyStreetView';
    isGenerating: boolean;
    onPresetClick?: () => void;
}

const darkTeamColors = ['bg-emerald-950/40 border-emerald-900/50 text-emerald-200', 'bg-amber-950/40 border-amber-900/50 text-amber-200', 'bg-cyan-950/40 border-cyan-900/50 text-cyan-200', 'bg-slate-950/40 border-slate-900/50 text-slate-200', 'bg-rose-950/40 border-rose-900/50 text-rose-200', 'bg-indigo-950/40 border-indigo-900/50 text-indigo-200'];
const teamNames = ['Team Alpha', 'Team Bravo', 'Team Charlie', 'Team Delta', 'Team Echo', 'Team Foxtrot'];

export default function LobbySidebar(props: LobbySidebarProps) {
    const { t } = useT();
    const [copiedId, setCopiedId] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [isEditingSelfName, setIsEditingSelfName] = useState(false);
    const [selfNameInput, setSelfNameInput] = useState('');
    const selfNameInputRef = useRef<HTMLInputElement>(null);
    const [langBusy, setLangBusy] = useState(false);

    // Changing the board language re-translates the categories (preset reuse or
    // DeepL) via the parent; fall back to a plain language change if no handler.
    const handleLanguageSelect = async (value: CategoryLanguage) => {
        if (!props.onCategoryLanguageChange) {
            props.updateGameModeInfo({ language: value });
            return;
        }
        setLangBusy(true);
        try {
            await props.onCategoryLanguageChange(value);
        } finally {
            setLangBusy(false);
        }
    };

    const [isMounted, setIsMounted] = useState(false);
    const [teamCount, setTeamCount] = useState(1);
    const [blurLobbyInfo, setBlurLobbyInfo] = useState(true);

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

        const { error } = await props.supabase.rpc('update_player', { p_id: props.playerId, p_patch: { name: nextName } });
        if (error) toast.error(t('sidebar.couldNotUpdateName'));
        else toast.success(t('sidebar.nameUpdated'));
        setIsEditingSelfName(false);
    };

    const handleUpdatePlayerTeam = async (targetPlayerId: string, teamIndex: number) => {
        props.setPlayers((prev) => prev.map((p) => (p.id === targetPlayerId ? { ...p, team: teamIndex } : p)));
        const { error } = await props.supabase.rpc('update_player', { p_id: targetPlayerId, p_patch: { team: teamIndex } });
        if (error) toast.error(t('sidebar.couldNotUpdateTeam'));
    };

    const handleRandomizeTeams = async () => {
        if (displayTeamCount < 2) return;

        const shuffledPlayers = shuffle([...props.players]);
        const updatedPlayers = shuffledPlayers.map((p, i) => ({
            ...p,
            team: i % displayTeamCount,
        }));

        props.setPlayers(updatedPlayers);

        // No bulk rpc; loop over update_player. small enough to parallelize.
        const updates = updatedPlayers.map((p) => props.supabase.rpc('update_player', { p_id: p.id, p_patch: { team: p.team } }));

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

        const updates = updatedPlayers.filter((p) => (p.team || 0) >= teamIndexToRemove || props.players.find((old) => old.id === p.id)?.team === teamIndexToRemove).map((p) => props.supabase.rpc('update_player', { p_id: p.id, p_patch: { team: p.team } }));

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
        <li key={p.id} draggable onDragStart={(e) => handleDragStart(e, p.id)} className="glass-inset flex flex-col gap-2 p-3 rounded-lg cursor-grab active:cursor-grabbing transition-all hover:brightness-125">
            <div className="flex items-center gap-3">
                <div className={`min-w-[8px] h-2 rounded-full animate-pulse ${props.onlinePlayers.includes(p.id) ? 'bg-green-500' : 'bg-orange-500'}`} />
                <div className="flex-1 min-w-0 flex items-center gap-2">
                    {p.id === props.playerId && isEditingSelfName ? (
                        <input title={t('sidebar.rename')} ref={selfNameInputRef} value={selfNameInput} onChange={(e) => setSelfNameInput(e.target.value)} onBlur={saveSelfName} onKeyDown={(e) => e.key === 'Enter' && saveSelfName()} className="flex-1 bg-transparent border-b border-indigo-400 outline-none text-white" autoFocus />
                    ) : (
                        <span className={`flex-1 truncate ${p.id === props.playerId ? 'text-green-400' : 'text-white'}`}>
                            {p.name} {p.id === props.gameHostId ? `(${t('common.host')})` : ''}
                        </span>
                    )}
                    {p.id === props.playerId && (
                        <button
                            type="button"
                            title={t('sidebar.rename')}
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
                <div className="flex gap-2 w-full mt-1 border-t border-white/10 pt-2">
                    <button type="button" onClick={() => props.makeHost(p.id)} className="press text-[10px] flex-[2] bg-indigo-500/20 text-indigo-300 hover:bg-indigo-600 hover:text-white py-1 rounded transition-colors">
                        {t('sidebar.makeHost')}
                    </button>
                    <button type="button" onClick={() => props.kickPlayer(p.id)} className="press text-[10px] flex-1 bg-orange-500/20 text-orange-300 hover:bg-orange-600 hover:text-white py-1 rounded transition-colors">
                        {t('sidebar.kick')}
                    </button>
                    <button type="button" onClick={() => props.banPlayer(p.id)} className="press text-[10px] flex-1 bg-red-500/20 text-red-300 hover:bg-red-600 hover:text-white py-1 rounded transition-colors">
                        {t('sidebar.ban')}
                    </button>
                </div>
            )}
        </li>
    );

    const me = props.players.find((p) => p.id === props.playerId);
    const iHaveSetLanguage = !!me?.category_locale;
    // Guests who still need to pick a display language. The host itself never
    // counts — excluded both by host id and by being the viewer (this button is
    // host-only) so it can never wait on itself. Offline players don't block,
    // to avoid ghost deadlocks.
    const pendingLanguagePlayers = props.translateCategories ? props.players.filter((p) => p.id !== props.gameHostId && p.id !== props.playerId && props.onlinePlayers.includes(p.id) && !p.category_locale) : [];
    const waitingForLanguages = pendingLanguagePlayers.length > 0;

    return (
        <div className="flex flex-col gap-4 sm:gap-6 w-full lg:w-80">
            {/* Your category language — the one setting a guest controls, so it
                sits up top with an accent until chosen. */}
            {props.translateCategories && !props.isHost && (
                <div className={`p-5 rounded-2xl h-fit transition-all ${iHaveSetLanguage ? 'glass' : 'glass border border-indigo-400/50 shadow-[0_0_34px_-8px_rgba(99,102,241,0.65)]'}`}>
                    <h2 className="flex items-center gap-2 text-lg font-bold text-slate-100 mb-1">{iHaveSetLanguage ? t('sidebar.myCategoryLanguage') : t('sidebar.chooseLanguagePrompt')}</h2>
                    <p className="text-xs text-slate-400 mb-4">{t('sidebar.chooseLanguageHint')}</p>
                    <Selection position="clean" stacked title={t('sidebar.myCategoryLanguage')} value={iHaveSetLanguage ? props.displayLocale : '__none__'} onChange={(v) => v !== '__none__' && props.onDisplayLocaleChange(v as Locale)} options={[...(iHaveSetLanguage ? [] : [{ label: t('sidebar.selectLanguagePlaceholder'), value: '__none__' }]), ...LOCALE_CODES.map((code) => ({ label: LOCALES[code].label, value: code }))]} />
                </div>
            )}

            {/* Invite Box */}
            <div className="glass p-4 sm:p-6 rounded-2xl h-fit">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-slate-300">{t('sidebar.inviteFriends')}</h2>
                    <div className="flex items-center gap-2">
                        {FEATURES.gameInvites && <InviteFriendsButton gameId={props.gameId} />}
                        <button type="button" onClick={() => setBlurLobbyInfo(!blurLobbyInfo)} className="p-2 glass press rounded-md p-2 text-slate-400 hover:text-slate-200" title={blurLobbyInfo ? t('sidebar.showInfo') : t('sidebar.blurInfo')}>
                            {blurLobbyInfo ? <FaEyeSlash /> : <FaEye />}
                        </button>
                    </div>
                </div>
                <div className="space-y-3">
                    <div className="glass-inset flex items-center gap-2 p-2 rounded-lg overflow-hidden">
                        <span className="text-sm font-bold text-slate-400 w-12 tracking-widest shrink-0">{t('sidebar.idLabel')}</span>
                        <span className="flex-1 min-w-0 font-mono text-slate-300 text-lg truncate select-none px-2" style={blurLobbyInfo ? { color: 'transparent', textShadow: '0 0 12px rgba(203, 213, 225, 0.9), 0 0 6px rgba(203, 213, 225, 0.7)' } : undefined}>
                            {props.gameId}
                        </span>
                        <button type="button" onClick={handleCopyGameId} className={`shrink-0 p-2 glass press rounded-md p-2 hover:text-slate-200 transition-all ${copiedId ? 'bg-green-600/40 text-green-400' : 'text-slate-400'}`} title={t('sidebar.copyGameId')}>
                            {copiedId ? <FaCopy /> : <FaRegCopy />}
                        </button>
                    </div>
                    <div className="glass-inset flex items-center gap-2 p-2 rounded-lg overflow-hidden">
                        <span className="text-sm font-bold text-slate-400 w-12 tracking-widest shrink-0">{t('sidebar.linkLabel')}</span>
                        <span className="flex-1 min-w-0 font-mono text-slate-300 truncate select-none px-2" style={blurLobbyInfo ? { color: 'transparent', textShadow: '0 0 12px rgba(203, 213, 225, 0.9), 0 0 6px rgba(203, 213, 225, 0.7)' } : undefined}>
                            {isMounted ? window.location.href.replace('http://', '').replace('https://', '') : '...'}
                        </span>
                        <button type="button" onClick={handleCopyGameLink} className={`shrink-0 p-2 glass press rounded-md p-2 hover:text-slate-200 transition-all ${copiedLink ? 'bg-green-600/40 text-green-400' : 'text-slate-400'}`} title={t('sidebar.copyGameLink')}>
                            {copiedLink ? <FaCopy /> : <FaRegCopy />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Player / Teams List */}
            <div className="glass p-4 sm:p-6 rounded-2xl h-fit">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-slate-300">{t('sidebar.players', { count: props.players.length })}</h2>

                    {/* Team Controls (Only Host or enabled for everyone depending on preference, here visible if teams mode) */}
                    {props.teamMode === 'teams' && (
                        <div className="flex gap-2">
                            <button onClick={handleRandomizeTeams} className="glass press p-2 text-slate-300 hover:text-white rounded-lg transition" title={t('sidebar.randomizeTeams')}>
                                <FaRandom />
                            </button>
                            <button onClick={() => setTeamCount(Math.min(displayTeamCount + 1, darkTeamColors.length))} disabled={displayTeamCount >= darkTeamColors.length} className={`p-2 rounded-lg transition ${displayTeamCount >= darkTeamColors.length ? 'glass-inset text-slate-600 cursor-not-allowed' : 'btn-sheen press bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_10px_20px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]'}`} title={t('sidebar.addTeam')}>
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
                                            <button onClick={() => handleRemoveTeam(teamIndex)} className="text-current opacity-50 hover:opacity-100 hover:text-red-400 transition-all p-1" title={t('sidebar.removeTeam')}>
                                                <FaTimes />
                                            </button>
                                        )}
                                    </div>

                                    <div className="space-y-2">{teamPlayers.length > 0 ? teamPlayers.map(renderPlayerItem) : <div className="text-center text-xs opacity-50 py-2 border-2 border-dashed border-current rounded-lg">{t('sidebar.dropPlayersHere')}</div>}</div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {props.isHost ? (
                    (() => {
                        const noCategories = props.categories.length === 0 && (props.categorySource === 'manual' || props.categorySource === 'ai');
                        const startDisabled = noCategories || props.isGenerating || waitingForLanguages;
                        return (
                            <>
                                <button type="button" onClick={props.handleStartGame} disabled={startDisabled} className={`w-full py-4 rounded-xl font-bold mt-8 tracking-wider ${startDisabled ? 'glass-inset text-slate-500 cursor-not-allowed' : 'btn-sheen press bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-[0_16px_32px_-10px_rgba(16,185,129,0.6),inset_0_1px_0_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-emerald-400'}`}>
                                    {props.isGenerating ? t('common.generating') : t('sidebar.startGame')}
                                </button>
                                {waitingForLanguages && !props.isGenerating && (
                                    <p className="mt-2 text-xs text-amber-400/90 text-center">
                                        {t('sidebar.waitingForLanguages')}
                                        <span className="block text-amber-300/80">{pendingLanguagePlayers.map((p) => p.name).join(', ')}</span>
                                    </p>
                                )}
                            </>
                        );
                    })()
                ) : (
                    <div className="glass-inset w-full text-slate-400 text-center py-4 rounded-xl font-bold mt-8">{props.isGenerating ? t('common.generating') : t('common.waitingForHost')}</div>
                )}

                <button type="button" onClick={props.handleLeaveLobby} className="glass press w-full py-3 rounded-xl font-bold mt-3 text-slate-300 hover:text-white transition-colors">
                    {t('sidebar.leaveLobby')}
                </button>
            </div>

            {/* More Game Settings */}
            <div className="glass p-6 rounded-2xl h-fit">
                <h2 className="text-xl font-semibold mb-6 text-slate-100 border-b border-white/10 pb-3">{t('sidebar.moreGameSettings')}</h2>

                <div className="flex flex-col gap-5">
                    {props.isHost && (
                        <button type="button" onClick={props.onPresetClick} className="btn-sheen press w-full py-2.5 rounded-lg font-medium bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_10px_20px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-indigo-400">
                            {t('community.browseTitle')}
                        </button>
                    )}
                    <Selection position="clean" stacked title={t('sidebar.categoryLanguage')} value={props.language} onChange={(v) => handleLanguageSelect(v as CategoryLanguage)} disabled={!props.isHost || langBusy} options={LOCALE_CODES.map((code) => ({ label: LOCALES[code].label, value: categoryLanguageForLocale(code) }))} description={langBusy ? t('common.generating') : undefined} />
                    <ToggleSwitch label={t('sidebar.translateIndividually')} tooltip={t('sidebar.translateIndividuallyTooltip')} checked={props.translateCategories} disabled={!props.isHost} onChange={(checked) => props.updateGameModeInfo({ translate_categories: checked })} />
                    {FEATURES.hideMapSymbols && <ToggleSwitch label={t('sidebar.hideMapSymbols')} tooltip={t('sidebar.hideMapSymbolsTooltip')} checked={props.hideMapSymbols} disabled={!props.isHost} onChange={(checked) => props.updateGameModeInfo({ hide_map_symbols: checked })} />}
                    {FEATURES.hideMiniMap && <ToggleSwitch label={t('sidebar.hideMiniMap')} tooltip={t('sidebar.hideMiniMapTooltip')} checked={props.hideMiniMap} disabled={!props.isHost} onChange={(checked) => props.updateGameModeInfo({ hide_minimap: checked })} />}
                    {FEATURES.aiVerifyEndGame && <ToggleSwitch label={t('sidebar.aiVerifyEndGame')} tooltip={t('sidebar.aiVerifyEndGameTooltip')} checked={props.aiEndGame} disabled={!props.isHost} onChange={(checked) => props.updateGameModeInfo({ ai_end_game: checked })} />}
                    <ToggleSwitch label={t('sidebar.anonymousVoting')} tooltip={t('sidebar.anonymousVotingTooltip')} checked={props.anonymousVoting} disabled={!props.isHost} onChange={(checked) => props.updateGameModeInfo({ anonymous_voting: checked })} />
                    {!props.isHost && <p className="text-xs text-slate-500 pt-4 border-t border-white/10 text-center">{t('sidebar.onlyHostCanChange')}</p>}
                </div>
            </div>
        </div>
    );
}
