import Link from 'next/link';

import GlassAmbience from '@/components/utils/GlassAmbience';

export default function PrivacyPolicy() {
    return (
        <main className="relative flex min-h-screen flex-col items-center overflow-hidden bg-slate-950 p-8 md:p-24 text-slate-300 leading-relaxed">
            <GlassAmbience drifters={false} />
            <div className="glass relative mt-4 flex w-full max-w-3xl flex-col gap-6 rounded-3xl p-8 md:p-12">
                <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text pb-[0.12em] text-4xl font-extrabold tracking-tighter text-transparent mb-4">Privacy Policy</h1>

                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">1. Data Controller</h2>
                    <p>
                        Responsible for data processing on this website:
                        <br />
                        Leonard Sima
                        <br />
                        Floriansmühlstrasse 1<br />
                        80939 Munich
                        <br />
                        Germany
                        <br />
                        Email: geobingo@leonardsima.de
                    </p>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">2. Data We Collect & Why</h2>
                    <p className="mb-2">We only collect data that is strictly necessary for the technical functionality and multiplayer experience of Geo BingBong:</p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li>
                            <strong>Chosen Names:</strong> Your chosen player name is stored in your browser's LocalStorage and sent to our database to identify you in a game lobby.
                        </li>
                        <li>
                            <strong>Session IDs:</strong> A random UUID is generated and stored in your browser's SessionStorage to keep you connected to your active game.
                        </li>
                        <li>
                            <strong>Game State:</strong> Interactions during a game (like bingo board state, voting, game settings) are synchronized and temporarily stored in our database to allow multiplayer functionality.
                        </li>
                        <li>
                            <strong>Account &amp; Email Address (optional):</strong> You can optionally create an account by signing in with your email address via a one-time magic link (Supabase Auth). Your email is used solely for authentication — we do not send marketing emails. Creating an account enables additional features: appearing on the Daily Challenge leaderboard, saving community presets you create, and tracking your personal stats (challenges completed and won).
                        </li>
                        <li>
                            <strong>Daily Challenge Attempts (account holders only):</strong> If you are signed in and complete or forfeit a Daily Challenge, your result (time, whether you found it or gave up, the Street View viewpoint you captured) is stored permanently in our database and displayed on the public leaderboard. Anonymous players can play but their results are not recorded.
                        </li>
                        <li>
                            <strong>Community Presets:</strong> If you create a community preset while signed in, your account ID is linked to that preset as its author, enabling you to edit or delete it later.
                        </li>
                        <li>
                            <strong>IP Addresses & Server Logs:</strong> Standard server logs are automatically created by our hosting provider (Vercel) for security and technical stability. These include your IP address, browser type, and time of access.
                        </li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">3. Local Storage & Cookies</h2>
                    <p>We do not use tracking or advertising cookies. We use functional browser storage (LocalStorage and SessionStorage) to remember your player name, current game session, and — if you are signed in — your authentication session token (a JWT issued by Supabase Auth). You can clear this data at any time by signing out and clearing your browser data.</p>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">4. Third-Party Services</h2>
                    <p className="mb-2">We use the following third-party services to run and operate this application. Where a provider processes data outside the EU, that transfer is governed by the provider&apos;s own data-protection safeguards:</p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li>
                            <strong>Supabase:</strong> We use Supabase (provided by Supabase Inc.) as our database and real-time backend. Game lobbies, player names, and session states are processed and stored on their servers to synchronize the game between players.
                        </li>
                        <li>
                            <strong>Vercel:</strong> This website is hosted on Vercel (Vercel Inc.). Vercel processes server logs (including your IP address) to deliver and secure the site. We also use Vercel Analytics and Speed Insights, which collect aggregated, cookieless usage and performance metrics (such as page views and load times) without tracking you across other websites.
                        </li>
                        <li>
                            <strong>Google Maps &amp; Street View:</strong> The game embeds the Google Maps JavaScript API and Street View (provided by Google). When you load a game, Google receives technical data such as your IP address in order to deliver map tiles and Street View imagery.
                        </li>
                        <li>
                            <strong>Google Gemini:</strong> To generate game categories and to verify submissions, the relevant text and the Street View image you captured are sent to Google&apos;s Gemini API for processing.
                        </li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">5. Your Rights</h2>
                    <p className="mb-2">Under the General Data Protection Regulation (GDPR), you have the right to request access to, correction of, or deletion of your personal data.</p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li>
                            <strong>Account holders:</strong> You can delete your account and all associated data (Daily Challenge results, community presets, stats) by contacting us at the email address above. We will process your request promptly.
                        </li>
                        <li>
                            <strong>Anonymous players:</strong> Most data is tied to temporary Session IDs or user-defined nicknames and cannot be reliably linked to a specific individual. If you believe data exists that can be attributed to you, please contact us with as much context as possible.
                        </li>
                    </ul>
                </section>

                <div className="my-6 h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>

                <div className="flex flex-wrap items-center justify-center gap-3">
                    <Link href="/" className="glass press rounded-full px-4 py-2 text-sm font-bold uppercase tracking-widest text-slate-300 transition-colors hover:text-white">
                        Back to Home
                    </Link>
                    <Link href="/impressum" className="glass press rounded-full px-4 py-2 text-sm font-bold uppercase tracking-widest text-slate-300 transition-colors hover:text-white">
                        Legal Notice
                    </Link>
                </div>
            </div>
        </main>
    );
}
