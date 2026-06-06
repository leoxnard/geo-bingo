'use client';

/*
================================================================================
useUser
================================================================================
Tracks the current Supabase Auth user. Authentication is only required to
*submit* a community preset — browsing, voting and importing all work logged
out — so this hook is consumed narrowly (the AuthGate and the submit step),
not app-wide.
================================================================================
*/

import { useEffect, useState } from 'react';

import type { User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export function useUser() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        supabase.auth.getUser().then(({ data }) => {
            if (mounted) {
                setUser(data.user);
                setLoading(false);
            }
        });

        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
            setLoading(false);
        });

        return () => {
            mounted = false;
            sub.subscription.unsubscribe();
        };
    }, []);

    return { user, loading };
}

/** Best-effort display name for preset authorship: stored player name → email local part → "Anonymous". */
export function displayNameFor(user: User | null): string {
    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('geoBingoPlayerName');
        if (stored && stored.trim()) return stored.trim();
    }
    if (user?.email) return user.email.split('@')[0];
    return 'Anonymous';
}
