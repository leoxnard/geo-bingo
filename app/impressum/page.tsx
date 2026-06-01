import Image from 'next/image';
import Link from 'next/link';

export default function Impressum() {
    return (
        <main className="flex min-h-screen flex-col items-center p-24 bg-slate-900 text-white leading-relaxed">
            <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-md flex flex-col gap-3 mt-12">
                <h1 className="text-3xl font-bold text-indigo-400 tracking-tighter mb-2">Legal Notice</h1>

                <div>
                    <h2 className="font-semibold text-lg text-slate-200">Information pursuant to § 5 TMG</h2>
                    <div className="">
                        <Image src="/images/address-info.png" alt="Address Details" width={270} height={60} className="pointer-events-none select-none" />
                    </div>
                </div>

                <div>
                    <h2 className="font-semibold text-lg text-slate-200 mt-2">Contact</h2>
                    <div className="">
                        <Image src="/images/email-info.png" alt="Contact Email" width={270} height={60} className="pointer-events-none select-none" />
                    </div>
                </div>

                <div>
                    <h2 className="font-semibold text-lg text-slate-200 mt-2">Hosting</h2>
                    <p className="text-slate-300 text-sm">This website is hosted by Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, USA.</p>
                </div>

                <div>
                    <h2 className="font-semibold text-lg text-slate-200 mt-2">Data Protection</h2>
                    <p className="text-slate-300 text-sm">
                        See our{' '}
                        <Link href="/privacy" className="text-indigo-400 hover:text-indigo-300 transition-colors underline">
                            Privacy Policy
                        </Link>{' '}
                        for how personal data is processed.
                    </p>
                </div>

                <div className="w-full h-px bg-slate-700 my-2"></div>

                <div className="flex items-center justify-center gap-6">
                    <Link href="/" className="text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest text-sm font-bold">
                        Back to Home
                    </Link>
                    <Link href="/privacy" className="text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest text-sm font-bold">
                        Privacy
                    </Link>
                </div>
            </div>
        </main>
    );
}
