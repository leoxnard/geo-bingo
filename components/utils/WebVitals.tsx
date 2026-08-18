'use client';

/*
================================================================================
WEB VITALS
================================================================================
Replaces Vercel Speed Insights: Next reports the Core Web Vitals it already
measures, and we forward them to Umami as plain events. No extra dependency —
`useReportWebVitals` ships with Next — and no personal data, just a metric name,
a number and Google's good/needs-improvement/poor rating.

CLS is a unitless ratio in the 0–0.25 range, so it is scaled by 1000 before
rounding; without that every sample would land on 0. All other metrics are
milliseconds.
================================================================================
*/

import { useReportWebVitals } from 'next/web-vitals';

import { track } from '@/lib/analytics';

// The metrics worth a dashboard row. Next also reports Next-specific timings
// (hydration, render) that say little about what players actually experience.
const TRACKED = new Set(['LCP', 'CLS', 'INP', 'FCP', 'TTFB']);

export default function WebVitals() {
    useReportWebVitals((metric) => {
        if (!TRACKED.has(metric.name)) return;
        track('web-vital', {
            metric: metric.name,
            value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
            rating: metric.rating ?? 'unknown',
        });
    });

    return null;
}
