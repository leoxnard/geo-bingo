/*
================================================================================
COMMUNITY PRESET BUILDER PAGE  (server shell)
================================================================================
The 5-step preset authoring wizard. Reachable blank from /community, or
pre-seeded from the lobby "publish" path (via sessionStorage). All the
interactivity lives in the CommunityBuilder client component.
================================================================================
*/

import type { Metadata } from 'next';

import CommunityBuilder from '@/components/community/CommunityBuilder';

export const metadata: Metadata = {
    title: 'Create a Preset · Geo BingBong',
    robots: { index: false },
};

export default function CreatePresetPage() {
    return <CommunityBuilder />;
}
