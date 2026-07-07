/*
================================================================================
BOUNDARY PRESET EXPORT ADMIN PAGE  (server shell)
================================================================================
Draw boundary areas and export them as JSON for the preset-generation script.
Access is enforced both here (feature flag) and inside the client component
(am_i_daily_admin allow-list); this shell just renders the interactive tool
and keeps the route out of search.
================================================================================
*/

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import PresetExportTool from '@/components/admin/PresetExportTool';
import { FEATURES } from '@/lib/featureFlags';

export const metadata: Metadata = {
    title: 'Boundary Preset Export',
    robots: { index: false, follow: false },
};

export default function PresetExportPage() {
    if (!FEATURES.presetExport) notFound();
    return <PresetExportTool />;
}
