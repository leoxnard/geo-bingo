/*
================================================================================
ADMIN HUB PAGE  (server shell)
================================================================================
Single entry point that links to every admin subpage (/admin/daily, /admin/words,
/admin/presets). Access is enforced inside the client component via the
am_i_daily_admin allow-list — the shell just renders the hub and keeps the route
out of search. Each linked subpage re-checks the same gate, so this hub is only a
convenience shell.
================================================================================
*/

import type { Metadata } from 'next';

import AdminHub from '@/components/admin/AdminHub';

export const metadata: Metadata = {
    title: 'Admin',
    robots: { index: false, follow: false },
};

export default function AdminPage() {
    return <AdminHub />;
}
