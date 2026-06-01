import type { Metadata } from 'next';

// Game rooms are dynamic, private, and infinite (one per code) — keep them out
// of search indexes. This server-component layout can export metadata even
// though the page itself is a client component.
export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

export default function GameLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
