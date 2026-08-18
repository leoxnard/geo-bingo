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

`data-domains` pins tracking to the hosts named in NEXT_PUBLIC_UMAMI_DOMAINS, so
a preview deploy stays out of the production stats. It is deliberately not
hardcoded: the same Umami instance collects several subdomains, and each
deployment decides for itself which host it is allowed to report as.
================================================================================
*/

import Script from 'next/script';

import { UMAMI_DOMAINS, UMAMI_SRC, UMAMI_WEBSITE_ID, isAnalyticsEnabled } from '@/lib/analytics';

export default function Analytics() {
    if (!isAnalyticsEnabled) return null;

    return <Script src={UMAMI_SRC} data-website-id={UMAMI_WEBSITE_ID} data-domains={UMAMI_DOMAINS} strategy="afterInteractive" />;
}
