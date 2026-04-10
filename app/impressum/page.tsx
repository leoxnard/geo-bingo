import Link from 'next/link';

export default function Impressum() {
    return (
        <main className="flex min-h-screen flex-col items-center p-24 bg-slate-900 text-white leading-relaxed">
            <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-md flex flex-col gap-6 mt-12">
                <h1 className="text-3xl font-bold text-indigo-400 tracking-tighter mb-2">Legal Notice</h1>
                
                <div>
                    <h2 className="font-semibold text-lg text-slate-200">Information pursuant to § 5 TMG</h2>
                    <p className="mt-2 text-slate-400">Leonard Sima</p>
                    <p className="text-slate-400">Floriansmühlstrasse 1</p>
                    <p className="text-slate-400">80939 Munich</p>
                    <p className="text-slate-400">Germany</p>
                </div>

                <div>
                    <h2 className="font-semibold text-lg text-slate-200 mt-2">Contact</h2>
                    <p className="text-slate-400">Email: geobingo@leonardsima.de</p>
                </div>

                <div className="w-full h-px bg-slate-700 my-2"></div>

                <Link href="/" className="text-center text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest text-sm font-bold">
                    Back to Home
                </Link>
            </div>
        </main>
    );
}
