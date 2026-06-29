/*
================================================================================
DAILY CHALLENGE ADMIN PAGE  (server shell)
================================================================================
Curate the daily-challenge candidate pool. Access is enforced both here (feature
flag) and inside the client component (am_i_daily_admin allow-list); this shell
just renders the interactive admin window and keeps the route out of search.
================================================================================
*/

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import DailyAdminReview from '@/components/admin/DailyAdminReview';
import { FEATURES } from '@/lib/featureFlags';

export const metadata: Metadata = {
    title: 'Daily Challenge Admin',
    robots: { index: false, follow: false },
};

export default function DailyAdminPage() {
    if (!FEATURES.dailyChallenge) notFound();
    return <DailyAdminReview />;
}
