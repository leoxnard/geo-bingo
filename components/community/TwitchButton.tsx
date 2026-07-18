'use client';

/*
================================================================================
TWITCH BUTTON
================================================================================
Shared "Continue with Twitch" / "Connect Twitch" action. Twitch-purple glass
button matching the design kit (press feedback, edge-lit highlight, sheen). Used
on the sign-in surface (AuthGate) and the account page.
================================================================================
*/

import { useState } from 'react';

import { FaTwitch } from 'react-icons/fa';

interface TwitchButtonProps {
    label: string;
    onClick: () => Promise<{ error?: string }> | void;
    disabled?: boolean;
}

export default function TwitchButton({ label, onClick, disabled }: TwitchButtonProps) {
    const [busy, setBusy] = useState(false);

    const handle = async () => {
        if (busy || disabled) return;
        setBusy(true);
        // On success this navigates away (OAuth redirect), so we never reset busy;
        // only an immediate error path returns here.
        const res = await onClick();
        if (res && res.error) setBusy(false);
    };

    return (
        <button type="button" onClick={handle} disabled={busy || disabled} className="btn-sheen press flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#772ce8] to-[#9146ff] py-3 font-bold uppercase text-white shadow-[0_16px_32px_-10px_rgba(145,70,255,0.6),inset_0_1px_0_rgba(255,255,255,0.3)] transition-all disabled:opacity-50">
            <FaTwitch size={18} /> {label}
        </button>
    );
}
