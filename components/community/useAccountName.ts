'use client';

/*
================================================================================
useAccountName
================================================================================
Resolves the effective username for the signed-in account, in one place so the
landing page, lobby and account screens all agree:

  • signed out          → { name: null }              (per-device lobby name applies)
  • Twitch linked       → { name: <twitch login>, twitchLocked: true }
  • plain account       → { name: displayNameFor(user) }

When an account has a linked Twitch identity, the Twitch handle is authoritative
and the name is not editable anywhere but the Twitch account itself — callers key
their "locked" UI off `twitchLocked`. A plain account name is still locked from
in-game editing (rename lives in account settings) but stays editable there.
================================================================================
*/

import { useEffect, useState } from 'react';

import { FEATURES } from '@/lib/featureFlags';
import { getTwitchLogin } from '@/lib/twitch';

import { displayNameFor, useUser } from './useUser';

export interface AccountName {
    /** Effective account username, or null when signed out. */
    name: string | null;
    /** True when the name is provided by a linked Twitch identity (fully uneditable). */
    twitchLocked: boolean;
    /** True while auth / Twitch identity is still resolving. */
    loading: boolean;
}

export function useAccountName(): AccountName {
    const { user, loading } = useUser();
    // Tagged with the user id it was resolved for, so a stale result from a previous
    // account is never applied to the next. Set only inside the async callbacks
    // (no synchronous setState in the effect body).
    const [twitch, setTwitch] = useState<{ userId: string; login: string | null } | null>(null);

    useEffect(() => {
        if (!user || !FEATURES.twitchAuth) return;
        let alive = true;
        getTwitchLogin()
            .then((login) => alive && setTwitch({ userId: user.id, login }))
            .catch(() => alive && setTwitch({ userId: user.id, login: null }));
        return () => {
            alive = false;
        };
    }, [user]);

    if (!user) return { name: null, twitchLocked: false, loading };

    const resolved = twitch?.userId === user.id;
    if (resolved && twitch?.login) return { name: twitch.login, twitchLocked: true, loading: false };
    return { name: displayNameFor(user), twitchLocked: false, loading: loading || (FEATURES.twitchAuth && !resolved) };
}
