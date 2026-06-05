/*
================================================================================
HOW TO PLAY  (server component, /how-to-play)
================================================================================
A standalone, fully server-rendered page explaining the game. Linked from the
landing page and the lobby. No 'use client': ships zero JS and gives crawlers
real, structured prose (semantic <h1>/<h2>, an alternating step walkthrough and a
features grid) on its own indexable URL.

Each step has a SCREENSHOT SLOT — see <ScreenshotPlaceholder>. To drop in a real
image, replace the placeholder with e.g.
    <Image src="/images/howto/step-1.jpeg" alt={step.title} width={1280} height={800} className="rounded-2xl border border-slate-700" />
================================================================================
*/

import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { FiArrowLeft, FiArrowRight, FiCheckCircle, FiFlag, FiGift, FiGrid, FiTag, FiUsers } from 'react-icons/fi';

import { getServerLocale } from '@/lib/i18n/getServerLocale';
import { Locale } from '@/lib/i18n/locales';
import { translate } from '@/lib/i18n/translate';

export async function generateMetadata(): Promise<Metadata> {
    const locale = await getServerLocale();
    return {
        title: translate(locale, 'landing.howTitle'),
        description: translate(locale, 'landing.aboutText'),
        alternates: { canonical: '/how-to-play' },
    };
}

/** SCREENSHOT SLOT. Renders a step screenshot, sized by the parent (16:10-ish). */
function Screenshot({ label, source }: { label: string; source: string }) {
    return <Image src={source} alt={label} width={3456} height={2166} className="h-auto w-full rounded-2xl border border-slate-700 shadow-lg" />;
}

export default async function HowToPlayPage() {
    const locale: Locale = await getServerLocale();
    const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

    const steps = [
        { title: t('landing.step1Title'), text: t('landing.step1Text'), source: '/images/how-to-play/step-1.jpeg' },
        { title: t('landing.step2Title'), text: t('landing.step2Text'), source: '/images/how-to-play/step-2.jpeg' },
        { title: t('landing.step3Title'), text: t('landing.step3Text'), source: '/images/how-to-play/step-3.jpeg' },
        { title: t('landing.step4Title'), text: t('landing.step4Text'), source: '/images/how-to-play/step-4.jpeg' },
    ];

    const features = [
        { icon: FiUsers, title: t('landing.feature1Title'), text: t('landing.feature1Text') },
        { icon: FiGrid, title: t('landing.feature2Title'), text: t('landing.feature2Text') },
        { icon: FiFlag, title: t('landing.feature3Title'), text: t('landing.feature3Text') },
        { icon: FiTag, title: t('landing.feature4Title'), text: t('landing.feature4Text') },
        { icon: FiCheckCircle, title: t('landing.feature5Title'), text: t('landing.feature5Text') },
        { icon: FiGift, title: t('landing.feature6Title'), text: t('landing.feature6Text') },
    ];

    return (
        <main className="min-h-dvh bg-slate-900 text-white">
            {/* Top bar */}
            <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-8">
                <Link href="/" className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white">
                    <FiArrowLeft aria-hidden /> {t('landing.backHome')}
                </Link>
                <div className="flex items-center gap-2">
                    <Image src="/mappin.and.ellipse.png" alt="" width={28} height={28} className="h-auto w-auto" />
                    <span className="text-lg font-bold tracking-tighter text-indigo-400">Geo BingBong</span>
                </div>
            </header>

            {/* Hero */}
            <section className="mx-auto max-w-3xl px-4 pb-12 pt-10 text-center sm:px-8 sm:pb-16 sm:pt-16">
                <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-indigo-400">{t('landing.aboutTitle')}</p>
                <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('landing.howTitle')}</h1>
                <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">{t('landing.aboutText')}</p>
            </section>

            {/* Steps — alternating text / screenshot rows */}
            <section className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-8 sm:gap-20 sm:px-8 sm:py-12">
                {steps.map((step, i) => (
                    <div key={i} className={`flex flex-col items-center gap-6 sm:gap-10 md:flex-row ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}>
                        <div className="flex-1">
                            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600/15 text-xl font-bold text-indigo-400 ring-1 ring-inset ring-indigo-500/30">{String(i + 1).padStart(2, '0')}</div>
                            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{step.title}</h2>
                            <p className="mt-3 text-base leading-relaxed text-slate-400">{step.text}</p>
                        </div>
                        <div className="w-full flex-1">
                            <Screenshot label={t('landing.screenshot')} source={step.source} />
                        </div>
                    </div>
                ))}
            </section>

            {/* Features */}
            <section className="border-t border-slate-800">
                <div className="mx-auto max-w-5xl px-4 py-16 sm:px-8 sm:py-20">
                    <h2 className="mb-10 text-center text-2xl font-bold tracking-tight sm:text-3xl">{t('landing.featuresTitle')}</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {features.map((feature, i) => {
                            const Icon = feature.icon;
                            return (
                                <div key={i} className="flex gap-4 rounded-2xl border border-slate-700 bg-slate-800/60 p-6">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600/15 text-indigo-400 ring-1 ring-inset ring-indigo-500/30">
                                        <Icon size={22} aria-hidden />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-white">{feature.title}</h3>
                                        <p className="mt-1 text-sm leading-relaxed text-slate-400">{feature.text}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="border-t border-slate-800">
                <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-4 py-16 text-center sm:px-8">
                    <p className="max-w-xl text-lg font-medium text-slate-300">{t('home.tagline')}</p>
                    <Link href="/" className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-4 font-bold uppercase tracking-wide text-white transition-all hover:bg-indigo-500">
                        {t('landing.ctaPlay')} <FiArrowRight aria-hidden />
                    </Link>
                </div>
            </section>
        </main>
    );
}
