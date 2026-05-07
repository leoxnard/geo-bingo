'use client';

import { useEffect, useState } from 'react';

type ViewportState = {
    isReady: boolean;
    isNarrow: boolean;
    isPortrait: boolean;
    isLandscape: boolean;
    isMobileLandscape: boolean;
    isCompactMobile: boolean;
};

const MOBILE_BREAKPOINT = '(max-width: 932px)';
const PORTRAIT_QUERY = '(orientation: portrait)';

const initialState: ViewportState = {
    isReady: false,
    isNarrow: false,
    isPortrait: false,
    isLandscape: false,
    isMobileLandscape: false,
    isCompactMobile: false,
};

export function useViewport() {
    const [state, setState] = useState<ViewportState>(initialState);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }

        const narrowQuery = window.matchMedia(MOBILE_BREAKPOINT);
        const portraitQuery = window.matchMedia(PORTRAIT_QUERY);

        const updateState = () => {
            const isNarrow = narrowQuery.matches;
            const isPortrait = portraitQuery.matches;

            setState({
                isReady: true,
                isNarrow, // true if viewport width is less than or equal to 932px
                isPortrait, // true if device is in portrait orientation
                isLandscape: !isPortrait, // true if device is in landscape orientation
                isMobileLandscape: isNarrow && !isPortrait, // true if viewport is narrow and in landscape orientation
                isCompactMobile: isNarrow && isPortrait, // true if viewport is narrow and in portrait orientation
            });
        };

        updateState();

        narrowQuery.addEventListener('change', updateState);
        portraitQuery.addEventListener('change', updateState);

        return () => {
            narrowQuery.removeEventListener('change', updateState);
            portraitQuery.removeEventListener('change', updateState);
        };
    }, []);

    return state;
}
