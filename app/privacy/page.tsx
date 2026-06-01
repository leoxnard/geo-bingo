import Link from 'next/link';

export default function PrivacyPolicy() {
    return (
        <main className="flex min-h-screen flex-col items-center p-8 md:p-24 bg-slate-900 text-slate-300 leading-relaxed">
            <div className="bg-slate-800 p-8 md:p-12 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-3xl flex flex-col gap-6 mt-4">
                <h1 className="text-4xl font-bold text-indigo-400 tracking-tighter mb-4">Privacy Policy</h1>

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
                            <strong>IP Addresses & Server Logs:</strong> Standard server logs are automatically created by our hosting provider (Vercel) for security and technical stability. These include your IP address, browser type, and time of access.
                        </li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">3. Local Storage & Cookies</h2>
                    <p>We do not use tracking or advertising cookies. We only use functional browser storage (LocalStorage and SessionStorage) to remember your player name and current game session. You can clear this data at any time by clearing your browser data.</p>
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
                    <p>Under the General Data Protection Regulation (GDPR), you have the right to request access to, correction of, or deletion of your personal data. Since we do not require accounts and most data is tied to temporary Session IDs or user-defined nicknames, we might not always be able to specifically identify "your" data without additional context. However, you can contact us at any time using the email address provided above.</p>
                </section>

                <div className="w-full h-px bg-slate-700 my-6"></div>

                <div className="flex items-center justify-center gap-6">
                    <Link href="/" className="text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest text-sm font-bold">
                        Back to Home
                    </Link>
                    <Link href="/impressum" className="text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest text-sm font-bold">
                        Legal Notice
                    </Link>
                </div>
            </div>
        </main>
    );
}
