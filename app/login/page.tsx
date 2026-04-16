"use client";

/*
================================================================================
LOGIN PAGE
================================================================================
User authentication interface for the Geo Bingo application.
Provides username/password input and authentication handling.
Features error display and form validation functionality.
================================================================================
*/

import { useState } from "react";

import { authenticate } from "./actions";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(false);

    const success = await authenticate(username, password);

    if (success) {
      window.location.href = "/";
    } else {
      setError(true);
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-slate-900 text-white">
      <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12">
        <h1 className="text-6xl font-bold text-indigo-400 tracking-tighter hidden sm:block uppercase">
          Preview Login
        </h1>
      </div>

      <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-md flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">
              Username
            </label>
            <input
              type="text"
              placeholder="Username"
              className="w-full p-3 rounded-xl bg-slate-900 border border-slate-600 focus:border-indigo-500 text-white outline-none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">
              Password
            </label>
            <input
              type="password"
              placeholder="Password"
              className={`w-full p-3 rounded-xl bg-slate-900 border ${error ? "border-red-500" : "border-slate-600"} focus:border-indigo-500 text-white outline-none`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-red-500 text-xs font-medium text-center">
              Login-Daten falsch!
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl transition-all uppercase mt-2 disabled:opacity-50"
          >
            {isLoading ? "Checking..." : "Unlock App"}
          </button>
        </form>
      </div>
    </main>
  );
}
