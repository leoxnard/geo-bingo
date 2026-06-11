import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Fail fast with a clear message instead of letting createClient blow up (or
// silently misbehave) deep inside the app when the env isn't configured.
if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.local).');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
