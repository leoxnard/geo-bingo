/*
================================================================================
GLASS AMBIENCE
================================================================================
The shared background layer of the glassmorphism look: vibrant blurred color
blobs drifting behind the glass panels, a faint map graticule fading out from
the center, and a field of tiny drifting emojis (streetview-hunt props) rising
slowly through the scene. Pure markup — server-renderable, no hooks — and fully
inert (aria-hidden + pointer-events-none). Positions/durations are a fixed
deterministic layout so SSR and client render identically.
================================================================================
*/

// One drifting emoji: horizontal position + loop duration/offset. Durations are
// long (40–70s) and opacities low so the layer stays ambient, never busy.
type Drifter = { emoji: string; left: string; dur: number; delay: number; size: string; o?: number };

const DRIFTERS: Drifter[] = [
    { emoji: '📍', left: '4%', dur: 52, delay: -7, size: 'text-2xl' },
    { emoji: '🚕', left: '13%', dur: 64, delay: -31, size: 'text-xl' },
    { emoji: '⛲', left: '22%', dur: 47, delay: -18, size: 'text-2xl' },
    { emoji: '🗿', left: '31%', dur: 70, delay: -55, size: 'text-xl' },
    { emoji: '🚦', left: '41%', dur: 58, delay: -9, size: 'text-lg' },
    { emoji: '🗼', left: '52%', dur: 66, delay: -40, size: 'text-2xl' },
    { emoji: '🐕', left: '61%', dur: 49, delay: -25, size: 'text-xl' },
    { emoji: '🚲', left: '70%', dur: 61, delay: -48, size: 'text-2xl' },
    { emoji: '⛪', left: '79%', dur: 55, delay: -14, size: 'text-xl' },
    { emoji: '🦩', left: '87%', dur: 68, delay: -36, size: 'text-lg' },
    { emoji: '🛵', left: '93%', dur: 46, delay: -22, size: 'text-xl', o: 0.1 },
    { emoji: '🌵', left: '9%', dur: 72, delay: -60, size: 'text-lg', o: 0.1 },
];

export default function GlassAmbience({ drifters = true, alpha = 0.7 }: { drifters?: boolean; alpha?: number }) {
    return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden select-none" style={{ opacity: alpha }}>
            <div className="glass-blob animate-blob-a -top-32 -left-24 h-[28rem] w-[28rem] bg-indigo-600/50" />
            <div className="glass-blob animate-blob-b top-1/4 -right-32 h-[26rem] w-[26rem] bg-fuchsia-500/35" />
            <div className="glass-blob animate-blob-c -bottom-40 left-1/3 h-[30rem] w-[30rem] bg-cyan-400/25" />
            <div className="glass-blob animate-blob-b top-[60%] -left-20 h-72 w-72 bg-amber-400/20" />
            <div className="geo-graticule absolute inset-0" />

            {drifters &&
                DRIFTERS.map((d) => (
                    <span key={`${d.emoji}-${d.left}`} className={`animate-emoji-drift ${d.size}`} style={{ left: d.left, '--drift-dur': `${d.dur}s`, '--drift-delay': `${d.delay}s`, ...(d.o !== undefined && { '--drift-o': d.o }) } as React.CSSProperties}>
                        {d.emoji}
                    </span>
                ))}
        </div>
    );
}
