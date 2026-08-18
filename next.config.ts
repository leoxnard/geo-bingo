import type { NextConfig } from 'next';
/** @type {import('next').NextConfig} */

const nextConfig: NextConfig = {
    reactStrictMode: true,
    turbopack: {},

    // Allow overriding the build output dir (e.g. for CI/sandbox verification
    // builds that can't write to .next). Defaults to the standard .next.
    distDir: process.env.NEXT_DIST_DIR || '.next',

    // Add X-Robots-Tag: noindex on non-production deployments (e.g. dev branch).
    // APP_ENV is set per deployment (Coolify env vars); it replaced VERCEL_ENV
    // when the app moved off Vercel. The check deliberately fails *open*: an
    // unset APP_ENV means indexable. Getting it the other way round silently
    // de-indexed production for as long as nobody set the variable.
    async headers() {
        const appEnv = process.env.APP_ENV;
        if (!appEnv || appEnv === 'production') return [];
        return [
            {
                source: '/:path*',
                headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
            },
        ];
    },

    webpack: (config) => {
        config.ignoreWarnings = [{ module: /node_modules\/@googlemaps\/markerclusterer/ }, { module: /node_modules\/@react-google-maps\/api/ }];
        return config;
    },
};

export default nextConfig;
