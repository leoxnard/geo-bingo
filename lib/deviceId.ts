/*
================================================================================
DEVICE ID
================================================================================
A stable, anonymous identity for the current browser, used to enforce
one-vote-per-device on community presets. Unlike preset *submission* (which
requires a real account), voting needs no login — we just persist a random UUID
in localStorage. Clearing storage yields a new identity; that is an accepted
trade-off for a lightweight, login-free voting flow.
================================================================================
*/

const KEY = 'geoBingoDeviceId';

/** Returns the persisted device id, creating one on first use. */
export const getDeviceId = (): string => {
    if (typeof window === 'undefined') return '';
    let id = localStorage.getItem(KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(KEY, id);
    }
    return id;
};
