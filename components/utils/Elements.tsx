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
            className="absolute top-2 right-2 z-5 hidden sm:flex w-12 h-12 bg-slate-800/30 hover:bg-slate-700/80 text-white items-center justify-center rounded-md shadow-[0_0_15px_rgba(0,0,0,0.4)] border border-slate-500 font-bold transition-transform hover:scale-105 active:scale-95 backdrop-blur-sm"
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

export const ToggleSwitch = ({ checked, onChange, disabled, label }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string }) => (
    <label className="flex items-center justify-between group">
      <span className="text-slate-300 font-medium text-sm group-hover:text-white transition-colors">
        {label}
      </span>
      <div className={`relative ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          className="sr-only peer" // Sr-only verbirgt die Standard-Checkbox visuell
        />
        {/* Der Hintergrund des Schalters */}
        <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-400 peer-checked:bg-indigo-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
      </div>
    </label>
  );