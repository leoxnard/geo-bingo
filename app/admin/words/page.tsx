/*
================================================================================
WORD POOL ADMIN PAGE  (server shell)
================================================================================
Curate the community word pool harvested from finished games. Access is
enforced both here (feature flag) and inside the client component
(am_i_daily_admin allow-list); this shell just renders the interactive admin
window and keeps the route out of search.
================================================================================
*/

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import WordPoolAdmin from '@/components/admin/WordPoolAdmin';
import { FEATURES } from '@/lib/featureFlags';

export const metadata: Metadata = {
    title: 'Word Pool Admin',
    robots: { index: false, follow: false },
};

export default function WordsAdminPage() {
    if (!FEATURES.exploreWords) notFound();
    return <WordPoolAdmin />;
}
