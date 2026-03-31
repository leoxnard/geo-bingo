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
                className="sr-only peer"
            />
            {/* Der Hintergrund des Schalters */}
            <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-400 peer-checked:bg-indigo-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
        </div>
    </label>
);

export const ToggleButton = ({ 
    classname, 
    active, 
    labelLeft, 
    labelRight, 
    onClick, 
    disabled, 
    title, 
    isHost, 
    position = 'middle',
    description,
}: { 
    classname?: string; 
    active: 'left' | 'right'; 
    labelLeft: string, 
    labelRight: string, 
    onClick: (val: 'left' | 'right') => void; 
    disabled?: boolean; 
    title: string; 
    isHost?: boolean; 
    position?: 'top' | 'middle' | 'bottom';
    description?: string;
}) => (
    <div className={`py-3 border-t border-slate-700
        ${position === 'top' ? 'pt-0 border-t-0' : ''}
        ${position === 'bottom' ? 'pb-0' : ''}
        ${classname}`}>
        <label className="flex justify-between font-bold mb-2 text-xl text-slate-300">
            <span>{title}</span>
        </label>
        
        {/* Button-Container */}
        <button 
            className="relative w-full flex bg-slate-900 rounded-lg p-1 transition-all focus:outline-none disabled:opacity-50"
            onClick={() => onClick(active === 'left' ? 'right' : 'left')}
            disabled={disabled}
            title={title}
        >
            {/* Slider */}
            <div 
                className={`
                    absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] 
                    rounded-md shadow-lg transition-transform duration-300 ease-in-out
                    ${active === 'right' ? 'translate-x-full' : 'translate-x-0'} 
                    ${isHost ? 'bg-indigo-600' : 'bg-slate-700'}
                `} 
            />

            {/* Labels */}
            <div className={`relative z-10 flex-1 py-2 text-sm font-semibold transition-colors duration-200 ${active === 'left' ? 'text-white' : 'text-slate-400'}`}>
                {labelLeft}
            </div>
            <div className={`relative z-10 flex-1 py-2 text-sm font-semibold transition-colors duration-200 ${active === 'right' ? 'text-white' : 'text-slate-400'}`}>
                {labelRight}
            </div>
        </button>
        {/* Description */}
        {description && (
            <p className="mt-2 text-xs text-slate-400 text-center min-h-[16px]">
                {description}
            </p>
        )}
    </div>
);

export type ToggleOption<T extends string | number> = {
    value: T;
    label: string;
};

interface MultiToggleButtonProps<T extends string | number> {
    classname?: string;
    options: ToggleOption<T>[];
    activeValue: T;
    onChange: (val: T) => void;
    disabled?: boolean;
    title: string;
    isHost?: boolean;
    position?: 'top' | 'middle' | 'bottom';
    sizeRatios?: number[]; // Neues optionales Array für die Breiten
    description?: string;
}

export const MultiToggleButton = <T extends string | number>({
    classname = '',
    options,
    activeValue,
    onChange,
    disabled,
    title,
    isHost,
    position = 'middle',
    sizeRatios,
    description,
}: MultiToggleButtonProps<T>) => {
    const activeIndex = options.findIndex((opt) => opt.value === activeValue);
    const safeActiveIndex = activeIndex >= 0 ? activeIndex : 0;

    const ratios = sizeRatios && sizeRatios.length === options.length 
        ? sizeRatios 
        : options.map(() => 1);

    const totalRatioSum = ratios.reduce((acc, val) => acc + val, 0);
    const currentRatio = ratios[safeActiveIndex];
    const prevRatiosSum = ratios.slice(0, safeActiveIndex).reduce((acc, val) => acc + val, 0);

    return (
        <div className={`py-3 border-t border-slate-700
            ${position === 'top' ? 'pt-0 border-t-0' : ''}
            ${position === 'bottom' ? 'pb-0' : ''}
            ${classname}`}>
            
            <label className="flex justify-between font-bold mb-2 text-xl text-slate-300">
                <span>{title}</span>
            </label>
            
            {/* Button-Container */}
            <div 
                className={`relative w-full flex bg-slate-900 rounded-lg p-1 transition-all ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
                title={title}
            >
                {/* Dynamischer Slider */}
                <div 
                    className={`
                        absolute top-1 bottom-1 left-1 rounded-md shadow-lg 
                        transition-transform duration-300 ease-in-out
                        ${isHost ? 'bg-indigo-600' : 'bg-slate-700'}
                    `}
                    style={{ 
                        width: `calc((100% - 8px) * ${currentRatio / totalRatioSum})`,
                        transform: `translateX(${(prevRatiosSum / currentRatio) * 100}%)`
                    }} 
                />

                {/* Option Labels */}
                {options.map((option, index) => {
                    const isActive = activeValue === option.value;
                    return (
                        <button
                            key={option.value}
                            onClick={() => onChange(option.value)}
                            disabled={disabled}
                            className={`
                                relative z-10 py-2 text-sm font-semibold transition-colors duration-200 focus:outline-none
                                ${isActive ? 'text-white' : 'text-slate-400 hover:text-slate-300'}
                            `}
                            style={{ flex: ratios[index] }}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>

            {/* Description */}
            {description && (
                <p className="mt-2 text-xs text-slate-400 text-center min-h-[16px]">
                    {description}
                </p>
            )}
        </div>
    );
};

export const RangeSlider = ({ 
    classname,
    title,
    min,
    max,
    minLabel = String(min),
    maxLabel = String(max),
    step = 1,
    value,
    displayValue,
    disabled,
    onChange,
    onCommit,
    position = 'middle',
    description
}: { 
    classname?: string;
    title: string;
    min: number; 
    max: number;
    minLabel?: string;
    maxLabel?: string;
    step?: number;
    value: number;
    displayValue?: string;
    disabled?: boolean;
    onChange: (val: number) => void;
    onCommit: () => void;
    position?: 'top' | 'middle' | 'bottom';
    description?: string;
}) => (
    <div className={`py-3 border-t border-slate-700 
        ${position === 'top' ? 'pt-0 border-t-0' : ''}
        ${position === 'bottom' ? 'pb-0' : ''}
        ${classname}`}>
        <div className="flex justify-between items-center mb-3">
            <label className="font-bold text-xl text-slate-300">
                {title}
            </label>
            {/* Der formatierte Wert aus deiner Logik */}
            <span className="font-black text-indigo-400 tabular-nums">
                {displayValue || value}
            </span>
        </div>

        <div className="p-4 bg-slate-900 rounded-xl shadow-inner flex flex-col gap-2">
            <input
                type="range"
                title={title}
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(parseInt(e.target.value))}
                onMouseUp={onCommit} 
                onTouchEnd={onCommit}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            />
            <div className="flex justify-between text-[10px] tracking-widest text-slate-500 font-bold px-1">
                <span>{minLabel}</span>
                <span>{maxLabel}</span>
            </div>
        </div>

        {description && (
            <p className="mt-2 text-xs text-slate-400 text-center italic">
                {description}
            </p>
        )}
    </div>
);

export const Selection = ({
    classname,
    title,
    options,
    value,
    onChange,
    disabled,
    position = 'middle',
    description
}: {
    classname?: string;
    title: string;
    options: { label: string; value: string }[];
    value: string;
    onChange: (val: string) => void;
    disabled?: boolean;
    position?: 'top' | 'middle' | 'bottom' | 'clean';
    description?: string;
}) => (
    <div className={`
        ${position === 'middle' ? 'py-3 border-t border-slate-700' : ''}
        ${position === 'top' ? 'pb-3 border-t border-slate-700 border-t-0' : ''}
        ${position === 'bottom' ? 'pt-3 border-t border-slate-700' : ''}
        ${classname}`}>
        
        <div className="flex items-center justify-between gap-4">
            <label className="text-sm text-slate-300 flex-shrink-0">
                {title}
            </label>
            
            <select 
                title={title}
                value={value} 
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className="h-[42px] px-3 w-full max-w-[200px] sm:max-w-[250px] rounded-lg bg-slate-900 border border-slate-600 text-sm text-white cursor-pointer transition-colors focus:outline-none focus:border-indigo-500 hover:border-slate-500 disabled:opacity-50"
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>

        {description && (
            <p className="mt-2 text-xs text-slate-400 italic">
                {description}
            </p>
        )}
    </div>
);
