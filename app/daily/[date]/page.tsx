/*
================================================================================
DAILY CHALLENGE PLAY PAGE  (server shell)
================================================================================
Plays a specific day's challenge. `date` is 'today' or a 'YYYY-MM-DD' string
(any of the last 7 days, from the hub). The interactive Street View hunt lives in
the DailyChallengeView client component.
================================================================================
*/

import { notFound } from 'next/navigation';

import DailyChallengeView from '@/components/daily/DailyChallengeView';
import { FEATURES } from '@/lib/featureFlags';

export default async function DailyDatePage({ params }: { params: Promise<{ date: string }> }) {
    if (!FEATURES.dailyChallenge) notFound();
    const { date } = await params;
    return <DailyChallengeView date={date} />;
}
