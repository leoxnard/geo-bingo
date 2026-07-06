'use client';

/*
================================================================================
ELEMENTS UTILITY COMPONENTS
================================================================================
Reusable UI components for the Geo Bingo application.
Includes buttons, sliders, toggles, input fields, and layout elements.
Provides consistent styling and interaction patterns across the app.
================================================================================
*/

import { useEffect, useRef, useState } from 'react';

import Image from 'next/image';
import toast from 'react-hot-toast';
import { FaRegQuestionCircle, FaRoute } from 'react-icons/fa';

import { useT } from '@/lib/i18n/I18nProvider';

const toggleFullscreen = async (containerRef: React.RefObject<HTMLDivElement | null>, setIsFullscreen: React.Dispatch<React.SetStateAction<boolean>>) => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
        try {
            await containerRef.current.requestFullscreen();
            setIsFullscreen(true);
        } catch (err) {
            console.error('Error attempting to enable fullscreen:', err);
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
    const { t } = useT();
    return (
        <button type="button" onClick={() => toggleFullscreen(containerRef, setIsFullscreen)} className="glass-dark absolute top-2 right-2 z-5 hidden sm:flex w-12 h-12 hover:brightness-125 text-white items-center justify-center rounded-md font-bold transition-transform hover:scale-105 active:scale-95" title={isFullscreen ? t('elements.exitFullscreen') : t('elements.enterFullscreen')}>
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

interface ExitButtonProps {
    onExit: () => void;
    style?: React.CSSProperties;
}

export const ExitButton = ({ onExit, style }: ExitButtonProps) => {
    const { t } = useT();
    return (
        <button type="button" onClick={onExit} style={style} className="hidden sm:flex w-12 h-12 bg-gradient-to-br from-rose-500/85 to-red-600/85 border border-red-300/60 shadow-[0_12px_24px_-8px_rgba(244,63,94,0.6),inset_0_1px_0_rgba(255,255,255,0.35)] hover:brightness-110 text-white items-center justify-center rounded-md font-bold transition-transform duration-300 hover:scale-105 active:scale-95" title={t('elements.exitStreetView')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
    );
};

interface CoverageToggleButtonProps {
    active: boolean;
    onClick: () => void;
    className?: string;
}

export const CoverageToggleButton = ({ active, onClick, className = '' }: CoverageToggleButtonProps) => {
    const { t } = useT();
    return (
        <button type="button" onClick={onClick} title={active ? t('map.hideCoverage') : t('map.showCoverage')} className={`glass-dark flex w-12 h-12 items-center justify-center rounded-md font-bold transition-transform hover:scale-105 active:scale-95 hover:brightness-125 ${active ? 'text-indigo-400' : 'text-white'} ${className}`}>
            <FaRoute size={18} />
        </button>
    );
};

export const GeoBingoLogo = ({ size = 60, className = '' }: { size?: number; className?: string }) => {
    return <Image src="/mappin.and.ellipse.png" alt="Geo BingBong Logo" loading="eager" width={size} height={size} className={`w-auto h-auto drop-shadow-[0_0_15px_rgba(96,165,250,0.5)] transform-gpu transition-transform ${className}`} />;
};

// Question-mark badge with a tooltip: hover (desktop) / tap (mobile) to open,
// outside tap to close. Stops propagation so it can sit inside clickable rows.
export const InfoHint = ({ text }: { text: string }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDocPointer = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', onDocPointer);
        return () => document.removeEventListener('pointerdown', onDocPointer);
    }, [open]);

    return (
        <span
            ref={ref}
            className="relative ml-1 inline-flex items-center align-middle cursor-help group"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen((v) => !v);
            }}
        >
            <FaRegQuestionCircle className="text-slate-400 hover:text-white transition-colors" size={14} />
            <span className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[240px] bg-slate-800 text-white text-xs p-2 rounded-lg shadow-xl border border-slate-600 z-[100] whitespace-normal text-center pointer-events-none ${open ? 'block' : 'hidden'}`}>{text}</span>
        </span>
    );
};

export const ToggleSwitch = ({ checked, onChange, disabled, label, tooltip }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string; tooltip?: string }) => {
    // Glue the last word and the "?" together (whitespace-nowrap) so a wrap can
    // only happen before the last word, never separating the icon from it.
    const words = label.trim().split(/\s+/);
    const lastWord = words.pop() ?? label;
    const head = words.join(' ');

    return (
        <label className="flex items-center justify-between gap-3 group">
            <span className="text-slate-300 font-medium text-sm group-hover:text-white transition-colors">
                {tooltip ? (
                    <>
                        {head && `${head} `}
                        <span className="whitespace-nowrap">
                            {lastWord}
                            <InfoHint text={tooltip} />
                        </span>
                    </>
                ) : (
                    label
                )}
            </span>
            <div className={`relative shrink-0 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => !disabled && onChange(e.target.checked)} className="sr-only peer" />
                {/* Der Hintergrund des Schalters */}
                <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-400 peer-checked:bg-indigo-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
            </div>
        </label>
    );
};

// A monochrome glyph from /public/icons rendered via CSS mask so it takes on the
// current text color (`bg-current`) — letting it dim/brighten with its label.
export const MaskIcon = ({ name, className = '' }: { name: string; className?: string }) => (
    <span
        aria-hidden
        className={`inline-block bg-current ${className}`}
        style={{
            WebkitMaskImage: `url(/icons/${name}.svg)`,
            maskImage: `url(/icons/${name}.svg)`,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
        }}
    />
);

export const ToggleButton = ({ classname, active, labelLeft, labelRight, iconLeft, iconRight, onClick, disabled, title, isHost, position = 'middle', description }: { classname?: string; active: 'left' | 'right'; labelLeft: string; labelRight: string; iconLeft?: string; iconRight?: string; onClick: (val: 'left' | 'right') => void; disabled?: boolean; title: string; isHost?: boolean; position?: 'top' | 'middle' | 'bottom'; description?: string }) => (
    <div
        className={`py-3 border-t border-white/10
        ${position === 'top' ? 'pt-0 border-t-0' : ''}
        ${position === 'bottom' ? 'pb-0' : ''}
        ${classname}`}
    >
        <label className="flex justify-between font-bold mb-2 text-xl text-slate-300">
            <span>{title}</span>
        </label>

        {/* Button-Container */}
        <button className="glass-inset relative w-full flex rounded-xl p-1 transition-all focus:outline-none disabled:opacity-50" onClick={() => onClick(active === 'left' ? 'right' : 'left')} disabled={disabled} title={title}>
            {/* Slider */}
            <div
                className={`
                    absolute top-1 bottom-1 left-1 w-[calc(50%-4px)]
                    rounded-lg transition-transform duration-300 ease-in-out
                    ${active === 'right' ? 'translate-x-full' : 'translate-x-0'}
                    ${isHost ? 'bg-gradient-to-r from-indigo-500 to-violet-500 shadow-[0_8px_16px_-6px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]' : 'bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'}
                `}
            />

            {/* Labels */}
            <div className={`relative z-10 flex-1 flex flex-col items-center justify-center gap-1 py-2 text-sm font-semibold transition-colors duration-200 ${active === 'left' ? 'text-white' : 'text-slate-400'}`}>
                {iconLeft && <MaskIcon name={iconLeft} className="h-6 w-24" />}
                {labelLeft}
            </div>
            <div className={`relative z-10 flex-1 flex flex-col items-center justify-center gap-1 py-2 text-sm font-semibold transition-colors duration-200 ${active === 'right' ? 'text-white' : 'text-slate-400'}`}>
                {iconRight && <MaskIcon name={iconRight} className="h-6 w-24" />}
                {labelRight}
            </div>
        </button>
        {/* Description */}
        {description && <p className="mt-2 text-xs text-slate-400 text-center min-h-[16px]">{description}</p>}
    </div>
);

export type ToggleOption<T extends string | number> = {
    value: T;
    label: string;
    shortLabel?: string;
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
    sizeRatios?: number[];
    description?: string;
    allowedValues?: T[];
    columns?: number;
}

export const MultiToggleButton = <T extends string | number>({ classname = '', options, activeValue, onChange, disabled, title, isHost, position = 'middle', sizeRatios, description, allowedValues, columns }: MultiToggleButtonProps<T>) => {
    const { t } = useT();
    const activeIndex = options.findIndex((opt) => opt.value === activeValue);
    const safeActiveIndex = activeIndex >= 0 ? activeIndex : 0;

    /* --- POSITION COMPUTATION --- */
    const isGrid = !!columns && columns > 0;
    const cols = columns || options.length;
    const rows = Math.ceil(options.length / cols);

    const activeRow = Math.floor(safeActiveIndex / cols);
    const activeCol = safeActiveIndex % cols;

    const ratios = !isGrid && sizeRatios && sizeRatios.length === options.length ? sizeRatios : options.map(() => 1);
    const totalRatioSum = ratios.reduce((acc, val) => acc + val, 0);
    const currentRatio = ratios[safeActiveIndex];
    const prevRatiosSum = ratios.slice(0, safeActiveIndex).reduce((acc, val) => acc + val, 0);

    const widthPct = isGrid ? 100 / cols : (currentRatio / totalRatioSum) * 100;
    const heightPct = isGrid ? 100 / rows : 100;
    const leftPct = isGrid ? activeCol * (100 / cols) : (prevRatiosSum / totalRatioSum) * 100;
    const topPct = isGrid ? activeRow * (100 / rows) : 0;

    return (
        <div
            className={`py-3 border-t border-white/10
            ${position === 'top' ? 'pt-0 border-t-0' : ''}
            ${position === 'bottom' ? 'pb-0' : ''}
            ${classname}`}
        >
            <label className="flex justify-between font-bold mb-2 text-xl text-slate-300">
                <span>{title}</span>
            </label>

            {/* --- BUTTON CONTAINER --- */}
            <div className={`glass-inset rounded-xl p-1 w-full ${disabled ? 'opacity-50 pointer-events-none' : ''}`} title={title}>
                <div className={`relative w-full ${isGrid ? 'grid' : 'flex'}`} style={isGrid ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : undefined}>
                    {/* --- SLIDER BACKGROUND --- */}
                    <div
                        className={`
                            absolute rounded-lg pointer-events-none z-0
                            transition-all duration-300 ease-in-out
                            ${isHost ? 'bg-gradient-to-r from-indigo-500 to-violet-500 shadow-[0_8px_16px_-6px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]' : 'bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'}
                        `}
                        style={{
                            width: `${widthPct}%`,
                            height: `${heightPct}%`,
                            left: `${leftPct}%`,
                            top: `${topPct}%`,
                        }}
                    />

                    {/* --- OPTIONS --- */}
                    {options.map((option, index) => {
                        const isActive = activeValue === option.value;
                        const isOptionDisabled = disabled || (allowedValues && !allowedValues.includes(option.value));
                        return (
                            <button
                                key={option.value}
                                type="button"
                                // Blocked options are clickable (to show the hint), so give them the
                                // "denied" cue instead of the default click via the sound provider.
                                data-sound={isOptionDisabled ? 'denied' : undefined}
                                onClick={() => {
                                    if (!isOptionDisabled) {
                                        onChange(option.value);
                                    } else {
                                        toast.error(t('elements.setStartingPointFirst'));
                                    }
                                }}
                                className={`
                                    relative z-10 py-2 px-1 text-sm font-semibold transition-colors duration-200 focus:outline-none cursor-pointer
                                    whitespace-nowrap overflow-hidden text-ellipsis
                                    ${isActive ? 'text-white' : isOptionDisabled ? 'text-slate-400/30' : 'text-slate-400 hover:text-slate-300'}
                                `}
                                style={!isGrid ? { flex: ratios[index] } : undefined}
                                title={option.label}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* --- DESCRIPTION --- */}
            {description && <p className="mt-2 text-xs text-slate-400 text-center min-h-[16px]">{description}</p>}
        </div>
    );
};

export const RangeSlider = ({ classname, title, min, max, minLabel = String(min), maxLabel = String(max), step = 1, value, displayValue, disabled, onChange, onCommit, position = 'middle', description }: { classname?: string; title: string; min: number; max: number; minLabel?: string; maxLabel?: string; step?: number; value: number; displayValue?: string; disabled?: boolean; onChange: (val: number) => void; onCommit: () => void; position?: 'top' | 'middle' | 'bottom'; description?: string }) => (
    <div
        className={`py-3 border-t border-white/10 
        ${position === 'top' ? 'pt-0 border-t-0' : ''}
        ${position === 'bottom' ? 'pb-0' : ''}
        ${classname}`}
    >
        <div className="flex justify-between items-center mb-3">
            <label className="font-bold text-xl text-slate-300">{title}</label>
            {/* Der formatierte Wert aus deiner Logik */}
            <span className="font-black text-indigo-400 tabular-nums">{displayValue || value}</span>
        </div>

        <div className="p-4 bg-slate-900 rounded-xl shadow-inner flex flex-col gap-2">
            <input type="range" title={title} min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(parseInt(e.target.value))} onMouseUp={onCommit} onTouchEnd={onCommit} className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all" />
            <div className="flex justify-between text-[10px] tracking-widest text-slate-500 font-bold px-1">
                <span>{minLabel}</span>
                <span>{maxLabel}</span>
            </div>
        </div>

        {description && <p className="mt-2 text-xs text-slate-400 text-center italic">{description}</p>}
    </div>
);

export const Selection = ({ classname, title, options, value, onChange, disabled, position = 'middle', description }: { classname?: string; title: string; options: { label: string; value: string }[]; value: string; onChange: (val: string) => void; disabled?: boolean; position?: 'top' | 'middle' | 'bottom' | 'clean'; description?: string }) => (
    <div
        className={`
        ${position === 'middle' ? 'py-3 border-t border-white/10' : ''}
        ${position === 'top' ? 'pb-3 border-t border-white/10 border-t-0' : ''}
        ${position === 'bottom' ? 'pt-3 border-t border-white/10' : ''}
        ${classname}`}
    >
        <div className="flex items-center justify-between gap-4">
            <label className="text-sm text-slate-300 flex-shrink-0">{title}</label>

            <select title={title} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-[42px] px-3 w-full max-w-[200px] sm:max-w-[250px] rounded-lg bg-slate-900 border border-slate-600 text-sm text-white cursor-pointer transition-colors focus:outline-none focus:border-indigo-500 hover:border-slate-500 disabled:opacity-50">
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </div>

        {description && <p className="mt-2 text-xs text-slate-400 italic">{description}</p>}
    </div>
);
