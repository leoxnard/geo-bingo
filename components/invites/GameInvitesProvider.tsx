'use client';

/*
================================================================================
GAME INVITES PROVIDER
================================================================================
App-wide state for "join my game" invitations, mounted once in the root layout so
it works wherever the invited player is (home, another lobby, /account …), not
only on the game page.

On sign-in it loads any live invitations and subscribes to postgres_changes
(INSERT on `game_invitations`, filtered to this account). A fresh insert pops a
toast with a Join button; pre-existing ones are seeded silently so a reload does
not spam. Every invitation self-expires 2 minutes after `created_at` — a local
timer drops it from the badge/list, and the RPCs never return stale rows, so the
2-minute limit is enforced without ever showing the player a countdown.

`useGameInvites()` feeds the invitations button next to the options gear
(GameInvitesButton). When the feature flag is off the provider is an inert
passthrough and the context stays empty.
================================================================================
*/

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { FaGamepad } from 'react-icons/fa';

import { useUser } from '@/components/community/useUser';
import type { GameInvitation } from '@/components/utils/types';
import { FEATURES } from '@/lib/featureFlags';
import { useT } from '@/lib/i18n/I18nProvider';
import { dismissGameInvitation, getMyGameInvitations } from '@/lib/invites';
import { supabase } from '@/lib/supabase';

const INVITE_TTL_MS = 2 * 60 * 1000;

interface GameInvitesContextValue {
    invites: GameInvitation[];
    join: (invite: GameInvitation) => void;
    dismiss: (id: string) => void;
}

const GameInvitesContext = createContext<GameInvitesContextValue>({
    invites: [],
    join: () => {},
    dismiss: () => {},
});

export function useGameInvites() {
    return useContext(GameInvitesContext);
}

export function GameInvitesProvider({ children }: { children: React.ReactNode }) {
    // Feature off → inert passthrough (context stays at its empty default).
    if (!FEATURES.gameInvites) return <>{children}</>;
    return <ActiveProvider>{children}</ActiveProvider>;
}

function ActiveProvider({ children }: { children: React.ReactNode }) {
    const { user } = useUser();
    const { t } = useT();
    const router = useRouter();
    const [invites, setInvites] = useState<GameInvitation[]>([]);
    const seenRef = useRef<Set<string>>(new Set());
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // Remove an invite locally and clear its expiry timer.
    const drop = useCallback((id: string) => {
        setInvites((prev) => prev.filter((i) => i.id !== id));
        const tm = timersRef.current.get(id);
        if (tm) {
            clearTimeout(tm);
            timersRef.current.delete(id);
        }
    }, []);

    const dismiss = useCallback(
        (id: string) => {
            drop(id);
            void dismissGameInvitation(id).catch(() => {});
        },
        [drop],
    );

    const join = useCallback(
        (invite: GameInvitation) => {
            dismiss(invite.id);
            router.push(`/game/${invite.game_id}`);
        },
        [dismiss, router],
    );

    const showInviteToast = useCallback(
        (invite: GameInvitation) => {
            toast(
                (tt) => (
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-white">
                            <span className="font-bold">{invite.inviter_name}</span> {t('invites.invitedYouShort')}
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                toast.dismiss(tt.id);
                                join(invite);
                            }}
                            className="press shrink-0 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-[0_8px_16px_-6px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]"
                        >
                            {t('invites.join')}
                        </button>
                    </div>
                ),
                { duration: 15000, icon: <FaGamepad className="text-indigo-400" /> },
            );
        },
        [join, t],
    );

    // Replace the live set: filter to unexpired, arm one expiry timer each, and
    // (only for realtime arrivals) toast the ones we have not announced yet.
    const ingest = useCallback(
        (list: GameInvitation[], toastNew: boolean) => {
            const now = Date.now();
            const live = list.filter((i) => now - new Date(i.created_at).getTime() < INVITE_TTL_MS);
            setInvites(live);

            for (const inv of live) {
                if (!timersRef.current.has(inv.id)) {
                    const remaining = INVITE_TTL_MS - (now - new Date(inv.created_at).getTime());
                    timersRef.current.set(
                        inv.id,
                        setTimeout(() => drop(inv.id), Math.max(0, remaining)),
                    );
                }
                if (toastNew && !seenRef.current.has(inv.id)) showInviteToast(inv);
                seenRef.current.add(inv.id);
            }
        },
        [drop, showInviteToast],
    );

    useEffect(() => {
        if (!user) return; // signed out: consumers see [] via the context gate below
        let alive = true;

        // Seed silently — do not toast invitations that were already waiting.
        getMyGameInvitations()
            .then((list) => alive && ingest(list, false))
            .catch(() => {});

        const channel = supabase
            .channel(`game-invites-${user.id}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_invitations', filter: `invitee_id=eq.${user.id}` }, () => {
                getMyGameInvitations()
                    .then((list) => alive && ingest(list, true))
                    .catch(() => {});
            })
            .subscribe();

        return () => {
            alive = false;
            supabase.removeChannel(channel);
        };
    }, [user, ingest]);

    return <GameInvitesContext.Provider value={{ invites: user ? invites : [], join, dismiss }}>{children}</GameInvitesContext.Provider>;
}
