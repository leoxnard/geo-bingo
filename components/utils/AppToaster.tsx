'use client';

/*
================================================================================
APP TOASTER
================================================================================
The single global react-hot-toast render target, mounted once in the root layout
so toasts fire on every surface (home, lobby, /account, community, daily …) — not
just inside the game page. Game-invite toasts in particular pop wherever the
invited player happens to be. Keep exactly one <Toaster> in the tree; a second
mount would duplicate every toast.
================================================================================
*/

import { Toaster } from 'react-hot-toast';
import { CiCircleAlert, CiCircleCheck } from 'react-icons/ci';

export default function AppToaster() {
    return (
        <Toaster
            toastOptions={{
                style: {
                    borderRadius: '20px',
                    background: '#333',
                    color: '#fff',
                },
                success: {
                    icon: <CiCircleCheck size="3em" color="#00b01d" />,
                    style: {
                        color: '#00b01d',
                    },
                },
                error: {
                    icon: <CiCircleAlert size="3em" color="#ff0000" />,
                    style: {
                        color: '#ff0000',
                    },
                    duration: 5000,
                },
            }}
        />
    );
}
