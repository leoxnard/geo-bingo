/*
================================================================================
TWITCH AUTH — DATA LAYER
================================================================================
Thin wrappers over Supabase Auth's Twitch OAuth. Two entry points that both open
the Twitch consent screen and redirect back to `redirectTo`:

  • signInWithTwitch — for a logged-out visitor. Creates a new geobingo account
    from the Twitch identity (or signs in if that Twitch account was seen before).
  • linkTwitch — for an already-signed-in account. Attaches Twitch as an extra
    identity via linkIdentity (requires "Manual Linking" enabled in the Supabase
    Auth settings).

The linked handle is never stored in our own tables: Supabase records the
identity in auth.identities, which is the single source of truth. getTwitchLogin
reads it back for display; server-side join enforcement reads the same table via
the current_user_has_twitch() RPC (see 20260719_twitch_auth.sql).
================================================================================
*/

import { supabase } from './supabase';

/** Start the Twitch OAuth flow for a logged-out visitor (sign up / sign in). */
export async function signInWithTwitch(redirectTo?: string): Promise<{ error?: string }> {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'twitch',
        options: { redirectTo: redirectTo ?? (typeof window !== 'undefined' ? window.location.href : undefined) },
    });
    return { error: error?.message };
}

/** Link Twitch to the account that is already signed in. */
export async function linkTwitch(redirectTo?: string): Promise<{ error?: string }> {
    const { error } = await supabase.auth.linkIdentity({
        provider: 'twitch',
        options: { redirectTo: redirectTo ?? (typeof window !== 'undefined' ? window.location.href : undefined) },
    });
    return { error: error?.message };
}

/**
 * The signed-in account's linked Twitch handle, or null if none is linked (or if
 * the visitor is a guest). Reads auth.identities via getUserIdentities — the
 * display name lives in identity_data (name / user_name / nickname / preferred_username).
 */
export async function getTwitchLogin(): Promise<string | null> {
    const { data, error } = await supabase.auth.getUserIdentities();
    if (error || !data?.identities) return null;
    const twitch = data.identities.find((i) => i.provider === 'twitch');
    if (!twitch) return null;
    const d = (twitch.identity_data ?? {}) as Record<string, unknown>;
    const handle = d.user_name ?? d.preferred_username ?? d.nickname ?? d.name ?? d.full_name;
    return typeof handle === 'string' && handle.trim() ? handle.trim() : 'Twitch';
}

/** Whether the signed-in account has a linked Twitch identity. Guests → false. */
export async function hasTwitchLinked(): Promise<boolean> {
    const { data, error } = await supabase.auth.getUserIdentities();
    if (error || !data?.identities) return false;
    return data.identities.some((i) => i.provider === 'twitch');
}
