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
                const { error } = await supabase.rpc('update_player', { p_id: playerId, p_patch: { path: currentPath } });
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
                supabase.rpc('update_player', { p_id: playerId, p_patch: { path: pathAtCleanup } }).then();
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
        const lengthAtFlush = pathRef.current.length;
        if (lengthAtFlush > lastSavedLengthRef.current) {
            void (async () => {
                // supabase.rpc reports failures via { error } rather than throwing,
                // so only advance the saved cursor on success — otherwise the
                // autosave interval can retry the not-yet-saved points.
                const { error } = await supabase.rpc('update_player', { p_id: playerId, p_patch: { path: pathRef.current } });
                if (error) {
                    console.error('Failed to save path:', error.message);
                } else {
                    lastSavedLengthRef.current = Math.max(lastSavedLengthRef.current, lengthAtFlush);
                }
            })();
        }
    };

    return { pathRef, recordPoint, flushNow };
}
