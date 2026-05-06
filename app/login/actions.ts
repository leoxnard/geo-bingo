'use server';

import { cookies } from 'next/headers';

export async function authenticate(user: string, pass: string) {
    if (user === process.env.BASIC_AUTH_USER && pass === process.env.BASIC_AUTH_PASSWORD) {
        const cookieStore = await cookies();

        cookieStore.set('geo-preview-auth', 'true', {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            path: '/',
        });

        return true;
    }
    return false;
}
