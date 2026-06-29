/*
================================================================================
DAILY CHALLENGE PAGE  (server shell)
================================================================================
The hub behind the home "Play Daily Challenge" button: today's challenge, the
global leaderboard, the last 7 days, and (signed in) lifetime stats. The
interactive part lives in the DailyHub client component.
================================================================================
*/

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import DailyHub from '@/components/daily/DailyHub';
import { FEATURES } from '@/lib/featureFlags';

export const metadata: Metadata = {
    title: 'Daily Challenge · Geo BingBong',
    alternates: { canonical: '/daily' },
};

export default function DailyPage() {
    if (!FEATURES.dailyChallenge) notFound();
    return <DailyHub />;
}
