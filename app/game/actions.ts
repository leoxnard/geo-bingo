'use server';

export async function checkAiKeysAvailable() {
    return {
        aiEnabled: !!process.env.NEXT_PUBLIC_GEMINI_API_KEY,
        mapsEnabled: !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    };
}
