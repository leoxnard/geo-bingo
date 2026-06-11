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

/**
 * The account's community display name: auth-user display_name → email local part
 * → "Anonymous". Account-scoped, independent of the per-device in-game lobby name.
 */
export function displayNameFor(user: User | null): string {
    const meta = user?.user_metadata?.display_name;
    if (typeof meta === 'string' && meta.trim()) return meta.trim();
    if (user?.email) return user.email.split('@')[0];
    return 'Anonymous';
}
