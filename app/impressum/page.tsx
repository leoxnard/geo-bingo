import Image from 'next/image';
import Link from 'next/link';

import GlassAmbience from '@/components/utils/GlassAmbience';

export default function Impressum() {
    return (
        <main className="relative flex min-h-screen flex-col items-center overflow-hidden bg-slate-950 px-4 py-16 text-white leading-relaxed sm:p-24">
            <GlassAmbience drifters={false} />
            <div className="glass relative mt-4 flex w-full max-w-md flex-col gap-3 rounded-3xl p-8 sm:mt-12">
                <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text pb-[0.12em] text-3xl font-extrabold tracking-tighter text-transparent">Legal Notice</h1>

                <div>
                    <h2 className="font-semibold text-lg text-slate-200">Information pursuant to § 5 TMG</h2>
                    <div className="glass-inset mt-2 w-fit rounded-xl p-3">
                        <Image src="/images/address-info.png" alt="Address Details" width={270} height={60} className="pointer-events-none select-none" />
                    </div>
                </div>

                <div>
                    <h2 className="font-semibold text-lg text-slate-200 mt-2">Contact</h2>
                    <div className="glass-inset mt-2 w-fit rounded-xl p-3">
                        <Image src="/images/email-info.png" alt="Contact Email" width={270} height={60} className="pointer-events-none select-none" />
                    </div>
                </div>

                <div>
                    <h2 className="font-semibold text-lg text-slate-200 mt-2">Hosting</h2>
                    <p className="text-slate-300 text-sm">This website runs on privately operated hardware in Germany; no commercial hosting provider is involved. The domain is registered with netcup GmbH, Daimlerstraße 25, 76185 Karlsruhe, Germany. Delivery of the site is routed through Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA.</p>
                </div>

                <div>
                    <h2 className="font-semibold text-lg text-slate-200 mt-2">Data Protection</h2>
                    <p className="text-slate-300 text-sm">
                        See our{' '}
                        <Link href="/privacy" className="text-indigo-300 hover:text-indigo-200 transition-colors underline">
                            Privacy Policy
                        </Link>{' '}
                        for how personal data is processed.
                    </p>
                </div>

                <div className="my-2 h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>

                <div className="flex flex-wrap items-center justify-center gap-3">
                    <Link href="/" className="glass press rounded-full px-4 py-2 text-sm font-bold uppercase tracking-widest text-slate-300 transition-colors hover:text-white">
                        Back to Home
                    </Link>
                    <Link href="/privacy" className="glass press rounded-full px-4 py-2 text-sm font-bold uppercase tracking-widest text-slate-300 transition-colors hover:text-white">
                        Privacy
                    </Link>
                </div>
            </div>
        </main>
    );
}
