'use client';

/*
================================================================================
PLAYER MANAGEMENT PANEL
================================================================================
Host-only overlay for the playing and voting views. Lists everyone in the game
with a live-presence dot, plus kick / ban / make-host controls. Reuses the host
handlers from GameRoom and mirrors the lobby sidebar row markup. Controlled: the
parent owns the open state and renders its own trigger button (styled to match
each view), so this only draws the dialog.
================================================================================
*/

import { FaTimes } from 'react-icons/fa';

import type { Player } from '@/components/utils/types';
import { useT } from '@/lib/i18n/I18nProvider';

interface PlayerManagementPanelProps {
    open: boolean;
    onClose: () => void;
    players: Player[];
    onlinePlayers?: string[];
    playerId: string;
    gameHostId?: string;
    kickPlayer?: (id: string) => Promise<void> | void;
    banPlayer?: (id: string) => Promise<void> | void;
    makeHost?: (id: string) => Promise<void> | void;
}

export default function PlayerManagementPanel({ open, onClose, players, onlinePlayers = [], playerId, gameHostId, kickPlayer, banPlayer, makeHost }: PlayerManagementPanelProps) {
    const { t } = useT();

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[70]" onClick={onClose}>
            <div role="dialog" aria-label={t('players.panelTitle')} onClick={(e) => e.stopPropagation()} className="glass-dark absolute left-3 top-16 w-72 rounded-2xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-black uppercase tracking-widest text-indigo-300">{t('players.panelTitle')}</h3>
                    <button type="button" onClick={onClose} aria-label={t('common.close')} className="press text-slate-400 hover:text-white">
                        <FaTimes />
                    </button>
                </div>
                <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
                    {players.map((p) => (
                        <li key={p.id} className="glass-inset flex flex-col gap-2 rounded-lg p-3">
                            <div className="flex items-center gap-3">
                                <div className={`h-2 min-w-[8px] animate-pulse rounded-full ${onlinePlayers.includes(p.id) ? 'bg-green-500' : 'bg-orange-500'}`} />
                                <span className={`flex-1 truncate ${p.id === playerId ? 'text-green-400' : 'text-white'}`}>
                                    {p.name} {p.id === gameHostId ? `(${t('common.host')})` : ''}
                                </span>
                            </div>

                            {p.id !== playerId && (
                                <div className="mt-1 flex w-full gap-2 border-t border-white/10 pt-2">
                                    <button type="button" onClick={() => makeHost?.(p.id)} className="press flex-[2] rounded bg-indigo-500/20 py-1 text-[10px] text-indigo-300 transition-colors hover:bg-indigo-600 hover:text-white">
                                        {t('sidebar.makeHost')}
                                    </button>
                                    <button type="button" onClick={() => kickPlayer?.(p.id)} className="press flex-1 rounded bg-orange-500/20 py-1 text-[10px] text-orange-300 transition-colors hover:bg-orange-600 hover:text-white">
                                        {t('sidebar.kick')}
                                    </button>
                                    <button type="button" onClick={() => banPlayer?.(p.id)} className="press flex-1 rounded bg-red-500/20 py-1 text-[10px] text-red-300 transition-colors hover:bg-red-600 hover:text-white">
                                        {t('sidebar.ban')}
                                    </button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
