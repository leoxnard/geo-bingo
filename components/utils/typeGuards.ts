/*
================================================================================
RUNTIME TYPE GUARDS
================================================================================
Lightweight validators for data crossing the Supabase boundary (realtime
payloads, RPC results) before it is treated as an app type. Checks the
identity fields a row cannot function without; optional columns stay loose.
================================================================================
*/

import type { Submission } from './types';

export function isSubmissionRow(value: unknown): value is Submission {
    if (typeof value !== 'object' || value === null) return false;
    const row = value as Record<string, unknown>;
    return typeof row.id === 'string' && typeof row.player_id === 'string' && typeof row.category === 'string' && typeof row.lat === 'number' && typeof row.lng === 'number';
}
