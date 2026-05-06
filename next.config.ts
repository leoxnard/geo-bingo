import type { NextConfig } from 'next';
/** @type {import('next').NextConfig} */

const nextConfig: NextConfig = {
    reactStrictMode: false,
    turbopack: {},

    webpack: (config) => {
        config.ignoreWarnings = [{ module: /node_modules\/@googlemaps\/markerclusterer/ }, { module: /node_modules\/@react-google-maps\/api/ }];
        return config;
    },
};

export default nextConfig;
