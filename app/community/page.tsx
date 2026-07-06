/*
================================================================================
COMMUNITY PRESETS PAGE  (server shell)
================================================================================
Browse, vote on, and import community-made game presets. The interactive list
lives in the CommunityBrowse client component; this shell just sets metadata.
================================================================================
*/

import { Suspense } from 'react';

import type { Metadata } from 'next';

import CommunityBrowse from '@/components/community/CommunityBrowse';

export const metadata: Metadata = {
    title: 'Community Presets · Geo BingBong',
    alternates: { canonical: '/community' },
};

export default function CommunityPage() {
    return (
        // Suspense boundary required because CommunityBrowse reads the
        // ?preset= share-link param via useSearchParams.
        <Suspense fallback={<main className="min-h-dvh bg-slate-950" />}>
            <CommunityBrowse />
        </Suspense>
    );
}
