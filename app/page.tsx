'use client';

/*
================================================================================
HOME PAGE
================================================================================
Main landing page for the Geo Bingo application.
Provides game creation, joining, and player name setup.
Features animated logo and name generation functionality.
================================================================================
*/

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { GeoBingoLogo } from '@/components/utils/Elements';
import { useViewport } from '@/components/utils/useViewport';

import { adjectives, badAdjectives, animals } from '../lib/names';

export default function Home() {
    const [lobbyId, setLobbyId] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('geoBingoLastLobbyId') || '';
        }
        return '';
    });
    const [showBadNames, setShowBadNames] = useState(false);
    const router = useRouter();
    const [playerName, setPlayerName] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('geoBingoPlayerName') || '';
        }
        return '';
    });
    const { isNarrow } = useViewport();

    const handleSaveName = () => {
        const finalName = playerName.trim() || `${showBadNames ? badAdjectives[Math.floor(Math.random() * badAdjectives.length)] : adjectives[Math.floor(Math.random() * adjectives.length)]}${animals[Math.floor(Math.random() * animals.length)]}`;
        localStorage.setItem('geoBingoPlayerName', finalName);
    };

    const createGame = () => {
        handleSaveName();
        const id = Math.random().toString(36).substring(2, 8);
        router.push(`/game/${id}`);
    };

    const joinGame = (e: React.FormEvent) => {
        e.preventDefault();
        if (lobbyId.trim() !== '') {
            handleSaveName();
            router.push(`/game/${lobbyId.trim()}`);
        }
    };

    return (
        <main className="flex min-h-dvh flex-col items-center justify-start sm:justify-center px-4 py-0 sm:px-8 sm:pb-0 sm:py-16 lg:p-24 lg:pb-0 bg-slate-900 text-white">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-6 sm:mb-12 hover">
                <GeoBingoLogo size={isNarrow ? 50 : 80} className="animate-pulse" />
                <h1 className="text-3xl sm:text-6xl font-bold text-indigo-400 tracking-tighter text-center sm:text-left">Geo BingBong</h1>
            </div>

            <div className="bg-slate-800 p-4 md:p-8 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-md flex flex-col gap-3 md:gap-6">
                {/* PLAYER NAME INPUT */}
                <div>
                    <button type="button" className="text-sm text-slate-400 font-bold uppercase mb-2 block" onClick={() => setShowBadNames(!showBadNames)}>
                        {showBadNames ? 'Your badass name' : 'Your name'}
                    </button>
                    <input type="text" placeholder="Enter your name..." className="w-full p-4 rounded-xl bg-slate-900 border border-slate-600 focus:outline-none focus:border-indigo-500 text-white font-medium text-lg" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
                </div>

                <div className="w-full h-px bg-slate-700 md:my-2"></div>

                <button type="button" onClick={createGame} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl transition-all tracking-wide uppercase">
                    Create New Game
                </button>

                <div className="text-center text-slate-500 text-sm font-medium uppercase tracking-widest">or</div>

                <form onSubmit={joinGame} className="flex flex-col gap-3">
                    <input type="text" placeholder="Enter Lobby ID..." className="p-4 rounded-xl bg-slate-700 border border-slate-600 focus:outline-none focus:border-indigo-500 text-white font-medium" value={lobbyId} onChange={(e) => setLobbyId(e.target.value)} />
                    <button type="submit" className="w-full bg-slate-600 hover:bg-slate-500 text-white font-bold py-3 rounded-xl transition-all uppercase tracking-wide">
                        Join Game
                    </button>
                </form>
            </div>

            <div className="mt-auto mb-2 pt-8 text-slate-500 text-sm font-medium flex gap-4">
                <a href="/impressum" className="hover:text-slate-300 transition-colors">
                    Legal Notice
                </a>
                <a href="/privacy" className="hover:text-slate-300 transition-colors">
                    Privacy Policy
                </a>
            </div>
        </main>
    );
}
