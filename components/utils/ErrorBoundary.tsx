'use client';

/*
================================================================================
ERROR BOUNDARY
================================================================================
Catches render/runtime errors thrown inside a phase view (StreetView /
VotingView / PodiumView) so a single crashing phase shows a localized fallback
with a retry, instead of bubbling to the global app/error.tsx screen and tearing
the whole game route (toasts, lobby context) down. Keyed per phase by the caller
so a phase transition mounts a fresh boundary automatically.
================================================================================
*/

import { Component, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: unknown) {
        console.error('[ErrorBoundary]', error);
    }

    reset = () => this.setState({ hasError: false });

    render() {
        if (!this.state.hasError) return this.props.children;
        if (this.props.fallback) return this.props.fallback;

        return (
            <div className="min-h-dvh flex flex-col items-center justify-center bg-slate-900 text-slate-100 p-6 text-center">
                <h2 className="text-2xl font-black mb-3">This screen hit a snag</h2>
                <p className="text-slate-300 mb-6 max-w-sm">Something went wrong rendering this part of the game. You can try reloading it.</p>
                <button type="button" onClick={this.reset} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-colors">
                    Try again
                </button>
            </div>
        );
    }
}
