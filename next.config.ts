import type { NextConfig } from 'next';
/** @type {import('next').NextConfig} */

const nextConfig: NextConfig = {
    reactStrictMode: true,
    turbopack: {},

    // Add X-Robots-Tag: noindex on non-production deployments (e.g. dev branch).
    // VERCEL_ENV is set by Vercel automatically; locally it's undefined.
    async headers() {
        if (process.env.VERCEL_ENV === 'production') return [];
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
