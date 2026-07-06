/*
================================================================================
ROOT LAYOUT
================================================================================
Global layout wrapper for the Geo Bingo application.
Provides font configuration, metadata, and global styles.
Sets up HTML structure and CSS imports for entire app.
================================================================================
*/

import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

import { GameInvitesProvider } from '@/components/invites/GameInvitesProvider';
import AppToaster from '@/components/utils/AppToaster';
import { getServerLocale } from '@/lib/i18n/getServerLocale';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { SettingsProvider } from '@/lib/settings/SettingsProvider';
import { SoundProvider } from '@/lib/sound/SoundProvider';

const geistSans = Geist({
    variable: '--font-geist-sans',
    subsets: ['latin'],
});

const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin'],
});

const SITE_TITLE = 'Geo BingBong — Free Multiplayer Street View Bingo';
const SITE_DESCRIPTION = 'Play Geo-Bingo online for free! Challenge your friends, explore the world, and test your geography skills. Who will get the first bingo?';

export const metadata: Metadata = {
    metadataBase: new URL('https://geobingbong.leonardsima.de'),
    title: {
        default: SITE_TITLE,
        // Sub-pages can set their own title; it renders as "<page> | Geo BingBong".
        template: '%s | Geo BingBong',
    },
    description: SITE_DESCRIPTION,
    applicationName: 'Geo BingBong',
    keywords: ['Geo-Bingo', 'Geobingo', 'Geography Game', 'Street View Game', 'Online Multiplayer Game', 'Bingo', 'Leonard Sima'],
    authors: [{ name: 'Leonard Sima' }],
    icons: {
        icon: '/mappin.and.ellipse.png',
        apple: '/mappin.and.ellipse.png',
    },
    robots: {
        index: true,
        follow: true,
    },
    openGraph: {
        type: 'website',
        siteName: 'Geo BingBong',
        title: SITE_TITLE,
        description: SITE_DESCRIPTION,
        url: '/',
        locale: 'en_US',
        images: [
            {
                url: '/mappin.and.ellipse.png',
                width: 279,
                height: 371,
                alt: 'Geo BingBong',
            },
        ],
    },
    twitter: {
        card: 'summary',
        title: SITE_TITLE,
        description: SITE_DESCRIPTION,
        images: ['/mappin.and.ellipse.png'],
    },
};

export const viewport: Viewport = {
    themeColor: '#0f172a',
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const locale = await getServerLocale();

    return (
        <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
            <body className="min-h-full flex flex-col">
                <I18nProvider initialLocale={locale}>
                    <SettingsProvider>
                        <SoundProvider>
                            <GameInvitesProvider>{children}</GameInvitesProvider>
                        </SoundProvider>
                    </SettingsProvider>
                </I18nProvider>
                <AppToaster />
                <Analytics />
                <SpeedInsights />
            </body>
        </html>
    );
}
