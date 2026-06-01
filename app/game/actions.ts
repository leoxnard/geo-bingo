'use server';

import { cookies } from 'next/headers';

export async function checkAiKeysAvailable() {
    const cookieStore = await cookies();
    const cookieAuth = cookieStore.get('geo-preview-auth')?.value === 'true';
    const isDeveloper = cookieAuth || (!!process.env.BASIC_AUTH_USER && !!process.env.BASIC_AUTH_PASSWORD);

    return {
        aiEnabled: !!process.env.GEMINI_API_KEY,
        mapsEnabled: !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
        isDeveloper: isDeveloper,
    };
}
