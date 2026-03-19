'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [lobbyId, setLobbyId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const router = useRouter();

  // Load saved name on startup
  useEffect(() => {
    const savedName = localStorage.getItem('geoBingoPlayerName');
    if (savedName) setPlayerName(savedName);
  }, []);

  const handleSaveName = () => {
    const finalName = playerName.trim() || 'Anonymous Player';
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
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-slate-900 text-white">
      <h1 className="text-6xl font-bold mb-8 text-blue-400 tracking-tighter">GEO BINGO</h1>
      
      <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-md flex flex-col gap-6">
        
        {/* PLAYER NAME INPUT */}
        <div>
          <label className="text-sm text-slate-400 font-bold uppercase mb-2 block">Your Name</label>
          <input 
            type="text" 
            placeholder="Enter your name..."
            className="w-full p-4 rounded-xl bg-slate-900 border border-slate-600 focus:outline-none focus:border-blue-500 text-white font-medium text-lg"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
        </div>

        <div className="w-full h-px bg-slate-700 my-2"></div>

        <button 
          onClick={createGame}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all tracking-wide uppercase"
        >
          Create New Game
        </button>

        <div className="text-center text-slate-500 text-sm font-medium uppercase tracking-widest">or</div>

        <form onSubmit={joinGame} className="flex flex-col gap-3">
          <input 
            type="text" 
            placeholder="Enter Lobby ID..."
            className="p-4 rounded-xl bg-slate-700 border border-slate-600 focus:outline-none focus:border-blue-500 text-white font-medium"
            value={lobbyId}
            onChange={(e) => setLobbyId(e.target.value)}
          />
          <button 
            type="submit"
            className="w-full bg-slate-600 hover:bg-slate-500 text-white font-bold py-3 rounded-xl transition-all uppercase tracking-wide"
          >
            Join Game
          </button>
        </form>
      </div>
    </main>
  );
}