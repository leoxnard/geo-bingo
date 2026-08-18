'use client';

/*
================================================================================
ANALYTICS SCRIPT
================================================================================
Loads the Umami tracker from our own analytics host. Mounted once in the root
layout; renders nothing when the env vars are unset (local dev, forks), so the
app runs identically with and without measurement.

Umami hooks the History API itself, so client-side route changes are counted
without a router effect here — do not add one, it would double-count.

`data-domains` pins tracking to the production host: preview deploys and any
local build that happens to have the env vars set stay out of the real stats.
================================================================================
*/

import Script from 'next/script';

import { UMAMI_SRC, UMAMI_WEBSITE_ID, isAnalyticsEnabled } from '@/lib/analytics';

const PRODUCTION_HOST = 'geobingbong.leonardsima.de';

export default function Analytics() {
    if (!isAnalyticsEnabled) return null;

    return <Script src={UMAMI_SRC} data-website-id={UMAMI_WEBSITE_ID} data-domains={PRODUCTION_HOST} strategy="afterInteractive" />;
}
