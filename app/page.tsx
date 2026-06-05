/*
================================================================================
HOME PAGE  (server component)
================================================================================
Landing page for Geo BingBong: the interactive hero (create / join a game) plus
a server-rendered footer. The locale is resolved server-side (cookie →
Accept-Language → default) so the footer copy is already translated in the first
paint. The how-to-play / features content lives on its own indexable page at
/how-to-play, linked from the hero.
================================================================================
*/

import type { Metadata } from 'next';

import HomeInteractive from '@/components/home/HomeInteractive';
import { getServerLocale } from '@/lib/i18n/getServerLocale';
import { translate } from '@/lib/i18n/translate';

export const metadata: Metadata = {
    alternates: { canonical: '/' },
};

export default async function Home() {
    const locale = await getServerLocale();

    return (
        <main className="flex min-h-dvh flex-col bg-slate-900 text-white">
            <HomeInteractive />

            <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-6 text-sm font-medium text-slate-500">
                <a href="/how-to-play" className="transition-colors hover:text-slate-300">
                    {translate(locale, 'home.howToPlay')}
                </a>
                <span aria-hidden className="text-slate-700">
                    ·
                </span>
                <a href="/impressum" className="transition-colors hover:text-slate-300">
                    {translate(locale, 'home.legalNotice')}
                </a>
                <span aria-hidden className="text-slate-700">
                    ·
                </span>
                <a href="/privacy" className="transition-colors hover:text-slate-300">
                    {translate(locale, 'home.privacyPolicy')}
                </a>
            </footer>
        </main>
    );
}
