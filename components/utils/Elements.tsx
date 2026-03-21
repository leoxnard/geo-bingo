'use client';


import Image from 'next/image';


const toggleFullscreen = async (containerRef: React.RefObject<HTMLDivElement | null>, setIsFullscreen: React.Dispatch<React.SetStateAction<boolean>>) => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
        try {
            await containerRef.current.requestFullscreen();
            setIsFullscreen(true);
        } catch (err) {
            console.error("Error attempting to enable fullscreen:", err);
        }
    } else {
        if (document.exitFullscreen) {
            await document.exitFullscreen();
            setIsFullscreen(false);
        }
    }
};

interface FullscreenButtonProps {
    isFullscreen: boolean;
    containerRef: React.RefObject<HTMLDivElement | null>;
    setIsFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const FullscreenButton = ({ isFullscreen, containerRef, setIsFullscreen }: FullscreenButtonProps) => {

    return (
        <button
            type="button"
            onClick={() => toggleFullscreen(containerRef, setIsFullscreen)}
            className="absolute top-2 right-2 z-[1000] hidden sm:flex w-12 h-12 bg-slate-800/30 hover:bg-slate-700/80 text-white items-center justify-center rounded-md shadow-[0_0_15px_rgba(0,0,0,0.4)] border border-slate-500 font-bold transition-transform hover:scale-105 active:scale-95 backdrop-blur-sm"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
            {isFullscreen ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
                </svg>
            ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                </svg>
            )} 
        </button>
    );
};

export const GeoBingoLogo = ({ size = 60, className = "" }: { size?: number, className?: string }) => {
    return (
        <Image 
            src="/mappin.and.ellipse.png"
            alt="Geo Bingo Logo"
            loading="eager"
            width={size}
            height={size}
            className={`w-auto h-auto drop-shadow-[0_0_15px_rgba(96,165,250,0.5)] transform-gpu transition-transform ${className}`}
        />
    );
};