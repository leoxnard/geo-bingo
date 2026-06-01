'use client';

import { useEffect } from 'react';

import Link from 'next/link';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error('[GlobalError]', error);
    }, [error]);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-slate-100 p-6">
            <div className="max-w-md w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-8 shadow-xl text-center">
                <h1 className="text-3xl font-black mb-3">Something broke</h1>
                <p className="text-slate-300 mb-6">An unexpected error knocked the game off the road. You can try again, or head back to the home screen.</p>
                {error.digest && <p className="text-xs text-slate-500 font-mono mb-6 break-all">ref: {error.digest}</p>}
                <div className="flex gap-3 justify-center">
                    <button type="button" onClick={reset} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-colors">
                        Try again
                    </button>
                    <Link href="/" className="px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold transition-colors">
                        Home
                    </Link>
                </div>
            </div>
        </div>
    );
}
