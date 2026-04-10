import Link from 'next/link';

export default function PrivacyPolicy() {
    return (
        <main className="flex min-h-screen flex-col items-center p-8 md:p-24 bg-slate-900 text-slate-300 leading-relaxed">
            <div className="bg-slate-800 p-8 md:p-12 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-3xl flex flex-col gap-6 mt-4">
                <h1 className="text-4xl font-bold text-indigo-400 tracking-tighter mb-4">Privacy Policy</h1>
                
                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">1. Data Controller</h2>
                    <p>
                        Responsible for data processing on this website:<br />
                        Leonard Sima<br />
                        Floriansmühlstrasse 1<br />
                        80939 Munich<br />
                        Germany<br />
                        Email: geobingo@leonardsima.de
                    </p>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">2. Data We Collect & Why</h2>
                    <p className="mb-2">We only collect data that is strictly necessary for the technical functionality and multiplayer experience of Geo Bingo:</p>
                    <ul className="list-disc pl-6 space-y-2">
                        <li><strong>Chosen Names:</strong> Your chosen player name is stored in your browser's LocalStorage and sent to our database to identify you in a game lobby.</li>
                        <li><strong>Session IDs:</strong> A random UUID is generated and stored in your browser's SessionStorage to keep you connected to your active game.</li>
                        <li><strong>Game State:</strong> Interactions during a game (like bingo board state, voting, game settings) are synchronized and temporarily stored in our database to allow multiplayer functionality.</li>
                        <li><strong>IP Addresses & Server Logs:</strong> Standard server logs are automatically created by our hosting provider for security and technical stability. These include your IP address, browser type, and time of access.</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">3. Local Storage & Cookies</h2>
                    <p>
                        We do not use tracking or advertising cookies. We only use functional browser storage (LocalStorage and SessionStorage) to remember your player name and current game session. You can clear this data at any time by clearing your browser data.
                    </p>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">4. Third-Party Services</h2>
                    <p className="mb-2">We use the following third-party service to run the multiplayer backend of this application:</p>
                    <ul className="list-disc pl-6">
                        <li><strong>Supabase:</strong> We use Supabase (provided by Supabase Inc.) as our database and real-time backend. Game lobbies, player names, and session states are processed and stored on their servers to synchronize the game between players.</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold text-slate-100 mb-2">5. Your Rights</h2>
                    <p>
                        Under the General Data Protection Regulation (GDPR), you have the right to request access to, correction of, or deletion of your personal data. Since we do not require accounts and most data is tied to temporary Session IDs or user-defined nicknames, we might not always be able to specifically identify "your" data without additional context. However, you can contact us at any time using the email address provided above.
                    </p>
                </section>

                <div className="w-full h-px bg-slate-700 my-6"></div>

                <Link href="/" className="text-center text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest text-sm font-bold">
                    Back to Home
                </Link>
            </div>
        </main>
    );
}