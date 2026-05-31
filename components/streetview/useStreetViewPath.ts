'use client';

/*
================================================================================
useStreetViewPath HOOK
================================================================================
Owns the player's GPS breadcrumb trail while they hunt in Street View:
the ref that holds the points, a periodic save to supabase, a final
flush on unmount, and helpers for pushing a point with dedup and for
manually flushing before ending the round.

The ref is returned so renderers (the minimap polyline) can still read
the array directly without round-tripping through React state.
================================================================================
*/

import { useEffect, useRef } from 'react';

import { supabase } from '../../lib/supabase';
import type { PathPoint } from '../utils/types';

const AUTOSAVE_INTERVAL_MS = 5000;

export function useStreetViewPath(playerId: string) {
    const pathRef = useRef<PathPoint[]>([]);
    const lastSavedLengthRef = useRef<number>(0);

    useEffect(() => {
        const saveInterval = setInterval(async () => {
            const currentPath = pathRef.current;
            if (currentPath.length > lastSavedLengthRef.current) {
                const { error } = await supabase.from('players').update({ path: currentPath }).eq('id', playerId);
                if (error) {
                    console.error('SUPABASE ERROR:', error.message, error.details);
                } else {
                    lastSavedLengthRef.current = currentPath.length;
                }
            }
        }, AUTOSAVE_INTERVAL_MS);

        return () => {
            clearInterval(saveInterval);
            const pathAtCleanup = pathRef.current;
            if (pathAtCleanup.length > lastSavedLengthRef.current) {
                supabase.from('players').update({ path: pathAtCleanup }).eq('id', playerId).then();
            }
        };
    }, [playerId]);

    /**
     * Append a point unless it's the same coords as the last one (panorama
     * change events fire even when the player just rotates).
     */
    const recordPoint = (lat: number, lng: number) => {
        const last = pathRef.current[pathRef.current.length - 1];
        if (!last || last.lat !== lat || last.lng !== lng) {
            pathRef.current.push({ lat, lng, timestamp: Date.now() });
        }
    };

    /**
     * Manual save used before the player triggers an end-of-round vote, so the
     * latest points are durable even if the periodic interval hasn't fired yet.
     */
    const flushNow = () => {
        if (pathRef.current.length > lastSavedLengthRef.current) {
            void (async () => {
                try {
                    await supabase.from('players').update({ path: pathRef.current }).eq('id', playerId);
                } catch (err) {
                    console.error('Failed to save path:', err);
                }
            })();
            lastSavedLengthRef.current = pathRef.current.length;
        }
    };

    return { pathRef, recordPoint, flushNow };
}
