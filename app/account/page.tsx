/*
================================================================================
ACCOUNT / PROFILE PAGE  (server shell)
================================================================================
The player's personal profile: lifetime multiplayer stats (games played,
win-rate, categories found), Daily Challenge counters, recent games, and a
friends list with one-tap invites. The interactive part lives in the
AccountProfile client component. Gated behind FEATURES.playerProfiles.
================================================================================
*/

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import AccountProfile from '@/components/account/AccountProfile';
import { FEATURES } from '@/lib/featureFlags';

export const metadata: Metadata = {
    title: 'Profile · Geo BingBong',
    alternates: { canonical: '/account' },
};

export default function AccountPage() {
    if (!FEATURES.playerProfiles) notFound();
    return <AccountProfile />;
}
