'use client';

/*
================================================================================
AiReasonLabel
================================================================================
The "AI verification failed" label with a hover tooltip showing the AI's reason.
The tooltip is rendered through a portal to <body> with fixed positioning so it
is never clipped by the scrolling category list (overflow-y-auto) it lives in.
================================================================================
*/

import { useCallback, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

export function AiReasonLabel({ reason }: { reason: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    const show = useCallback(() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setPos({ top: r.top - 8, left: r.right });
    }, []);
    const hide = useCallback(() => setPos(null), []);

    return (
        <span ref={ref} onMouseEnter={show} onMouseLeave={hide} onClick={(e) => e.stopPropagation()} className="text-[10px] font-bold uppercase whitespace-nowrap flex-shrink-0 text-red-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] underline decoration-dotted underline-offset-2 cursor-help">
            AI verification failed
            {pos &&
                typeof document !== 'undefined' &&
                createPortal(
                    <div style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translate(-100%, -100%)' }} className="w-max max-w-[220px] bg-slate-800 text-white text-xs p-2 rounded-lg shadow-xl border border-slate-600 z-[200] whitespace-normal text-left normal-case font-normal pointer-events-none">
                        <span className="font-bold text-red-300">Reason:</span> {reason}
                    </div>,
                    document.body,
                )}
        </span>
    );
}
