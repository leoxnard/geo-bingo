'use client';

/*
================================================================================
STREET VIEW MAP PANEL
================================================================================
The left column of the play screen: the Google Map + Street View panorama, the
floating minimap, the fullscreen category side-panel, and the exit / return-to-
start buttons. All map instances and refs are owned by the parent StreetView and
passed in so the parent can keep its effects and listeners in one place.
================================================================================
*/

import { GoogleMap, Polygon, StreetViewPanorama } from '@react-google-maps/api';
import { FaChevronLeft } from 'react-icons/fa';
import { GoMoveToStart } from 'react-icons/go';

import { useT } from '@/lib/i18n/I18nProvider';

import { ROOMY_MAX, ROOMY_MIN, getAiVerdictState, getStreetViewImageUrl, resolveHint, type HintMap, panoOptions, safeStartCenter } from './streetViewHelpers';
import { ExitButton, FullscreenButton } from '../utils/Elements';
import { mapOptions } from '../utils/mapUtils';
import { BoundaryPolygon, Submission } from '../utils/types';

interface StreetViewMapPanelProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    panelRef: React.RefObject<HTMLDivElement | null>;
    streetViewRef: React.RefObject<google.maps.StreetViewPanorama | null>;
    minimapCenter: google.maps.LatLng | { lat: number; lng: number };
    isMobileLandscape: boolean;
    isPortrait: boolean;
    isNarrow: boolean;
    gameId: string;
    mapCenter: { lat: number; lng: number };
    mapZoom: number;
    additionalMapOptions: Record<string, unknown>;
    additionalMiniMapOptions: Record<string, unknown>;
    parsedBoundaries: BoundaryPolygon[];
    setMainMapInstance: (map: google.maps.Map | null) => void;
    setMinimapInstance: (map: google.maps.Map | null) => void;
    setPanoInstance: (pano: google.maps.StreetViewPanorama | null) => void;
    onLoad: (pano: google.maps.StreetViewPanorama) => void;
    onUnmount: () => void;
    inStreetView: boolean;
    hideMiniMap: boolean;
    isFullscreen: boolean;
    fsPanelOpen: boolean;
    setFsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setIsFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
    measuredPanelWidth: number;
    startingPoint: string;
    myBoard: string[];
    mySubmissions: Submission[];
    otherSubmissions: Submission[];
    exclusiveMode: boolean;
    allowHints: boolean;
    submittingCategory: string | null;
    textSizeClass: string;
    handleSubmit: (category: string) => void;
    hintByCategory?: HintMap;
}

export default function StreetViewMapPanel(props: StreetViewMapPanelProps) {
    const { t } = useT();
    const { containerRef, panelRef, streetViewRef, minimapCenter, isMobileLandscape, isPortrait, isNarrow, gameId, mapCenter, mapZoom, additionalMapOptions, additionalMiniMapOptions, parsedBoundaries, setMainMapInstance, setMinimapInstance, setPanoInstance, onLoad, onUnmount } = props;
    const { inStreetView, hideMiniMap, isFullscreen, fsPanelOpen, setFsPanelOpen, setIsFullscreen, measuredPanelWidth, startingPoint, myBoard, mySubmissions, otherSubmissions, exclusiveMode, allowHints, submittingCategory, textSizeClass, handleSubmit, hintByCategory } = props;

    const renderBoundaries = (keyPrefix: string) =>
        parsedBoundaries.map((boundary, index) =>
            boundary.points && boundary.points.length >= 3 ? (
                <Polygon
                    key={`${keyPrefix}-${boundary.id || index}`}
                    paths={boundary.points}
                    options={{
                        fillColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                        fillOpacity: 0.2,
                        strokeColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                        strokeOpacity: 1,
                        strokeWeight: 4,
                        clickable: false,
                    }}
                />
            ) : null,
        );

    return (
        <div ref={containerRef} className={`${isMobileLandscape ? 'basis-[58%] min-h-0 h-full' : isPortrait ? 'flex-[1.2] min-h-[48svh] h-full' : 'flex-1 h-full'} border-2 border-slate-700 rounded-2xl overflow-hidden shadow-2xl relative bg-slate-800 absolute-safari-fix`}>
            <GoogleMap key={gameId} mapContainerClassName="google-map-container absolute inset-0" center={mapCenter} zoom={mapZoom} options={mapOptions(additionalMapOptions)} onLoad={(map) => setMainMapInstance(map)} onUnmount={() => setMainMapInstance(null)}>
                {renderBoundaries('main')}

                <StreetViewPanorama
                    options={panoOptions}
                    onLoad={(pano) => {
                        setPanoInstance(pano);
                        onLoad(pano);
                    }}
                    onUnmount={() => {
                        setPanoInstance(null);
                        onUnmount();
                    }}
                />
            </GoogleMap>

            {/* Minimap */}
            {inStreetView && !hideMiniMap && (
                <div style={{ transform: isFullscreen && fsPanelOpen ? `translateX(${measuredPanelWidth}px)` : undefined }} className={`absolute ${isNarrow ? 'w-20 h-20 bottom-1 left-1 hover:w-28 hover:h-28' : 'w-28 h-28 bottom-6 left-6 hover:w-44 hover:h-44'} z-[500] rounded-xl overflow-hidden border-2 border-indigo-500 shadow-[0_0_20px_rgba(79,70,229,0.5)] transition-all duration-300 minimap-wrapper duration-300 ease-out`}>
                    <style>{`.minimap-wrapper .gmnoprint { display: none !important; }`}</style>
                    <GoogleMap mapContainerClassName="w-full h-full" onLoad={(map) => setMinimapInstance(map)} onUnmount={() => setMinimapInstance(null)} center={minimapCenter} zoom={isNarrow ? 14 : 16} options={mapOptions(additionalMiniMapOptions)}>
                        {renderBoundaries('mini')}
                    </GoogleMap>
                    {startingPoint !== 'open-world' && <div className="absolute inset-0 z-50 bg-transparent"></div>}
                </div>
            )}

            {!isMobileLandscape && <FullscreenButton isFullscreen={isFullscreen} containerRef={containerRef} setIsFullscreen={setIsFullscreen} />}

            {isFullscreen && (
                <div ref={panelRef} className={`absolute z-10 top-0 left-0 bottom-0 h-full bg-slate-900/40 backdrop-blur-xs border-r border-white/10 transition-transform duration-300 ease-out ${fsPanelOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                    <ul className={`h-full grid grid-cols-1 auto-rows-min p-1 gap-1.5 overflow-y-auto place-content-center justify-items-stretch ${fsPanelOpen ? '' : 'pointer-events-none'}`}>
                        {myBoard.map((cat) => {
                            const foundSub = mySubmissions.find((s) => s.category === cat);
                            const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some((s) => s.category === cat);
                            const hint = allowHints ? resolveHint(cat, hintByCategory || {}) : null;
                            const isDisabled = submittingCategory === cat || !inStreetView || isBlocked;
                            const streetViewImageUrl = foundSub ? getStreetViewImageUrl(foundSub) : '';

                            return (
                                <li
                                    key={cat}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            if (!isDisabled) handleSubmit(cat);
                                        }
                                    }}
                                    onClick={() => {
                                        if (!isDisabled) handleSubmit(cat);
                                    }}
                                    style={{ minHeight: ROOMY_MIN, maxHeight: ROOMY_MAX }}
                                    className={`relative p-1 whitespace-nowrap flex items-center justify-center w-full max-w-full rounded-xl border transition-colors ${foundSub ? 'shadow-md border-slate-600' : isBlocked ? 'bg-slate-900 border-red-500 opacity-60' : 'bg-slate-800 border-slate-600 hover:bg-slate-700/30'} ${foundSub?.ai_verdict === false ? ' !border-red-500' : foundSub?.ai_verdict === true ? ' !border-green-500' : ''} ${!foundSub && !isBlocked && inStreetView ? 'cursor-pointer' : ''} ${isDisabled ? 'opacity-70' : ''}`}
                                >
                                    <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                                        {foundSub && <img src={streetViewImageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
                                        {foundSub && <div className="absolute inset-0 bg-black/50 z-0"></div>}
                                    </div>
                                    <div className={`relative z-10 font-bold text-center ${getAiVerdictState(foundSub) === 'rejected' ? 'text-red-400' : foundSub ? 'text-white' : isBlocked ? 'text-red-400' : 'text-slate-300'} ${textSizeClass}`}>
                                        {cat}
                                        {hint && (
                                            <div className="mt-1 text-xs text-slate-400 font-normal">
                                                {t('sv.hint')} <em>{hint}</em>
                                            </div>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    <button type="button" onClick={() => setFsPanelOpen((open) => !open)} className="absolute top-1/2 left-full -translate-y-1/2 -ml-px w-5 h-14 rounded-r-lg bg-slate-900/40 backdrop-blur-sm border border-l-0 border-white/10 text-white shadow-md flex items-center justify-center" title={fsPanelOpen ? t('sv.hideCategories') : t('sv.showCategories')}>
                        <FaChevronLeft className={`transition-transform duration-300 ${fsPanelOpen ? '' : 'rotate-180'}`} size={11} />
                    </button>
                </div>
            )}

            {inStreetView && startingPoint === 'open-world' && (
                <div style={isFullscreen && fsPanelOpen ? { transform: `translateX(${measuredPanelWidth}px)` } : undefined} className="absolute top-2 left-2 z-50 duration-300 ease-out">
                    <ExitButton onExit={() => streetViewRef.current?.setVisible(false)} />
                </div>
            )}

            {startingPoint !== 'open-world' && (
                // Panel-open offset lives on the wrapper so the button's own hover:scale doesn't fight it.
                <div style={{ transform: isFullscreen && fsPanelOpen ? `translateX(${measuredPanelWidth}px)` : undefined }} className="absolute top-2 left-2 z-5 transition-transform duration-300 ease-out hidden sm:block">
                    <button type="button" onClick={() => streetViewRef.current?.setPosition(new google.maps.LatLng(startingPoint ? JSON.parse(startingPoint) : safeStartCenter))} className="flex w-12 h-12 bg-slate-800/30 hover:bg-slate-700/80 text-white text-[30px] items-center justify-center rounded-md shadow-[0_0_15px_rgba(0,0,0,0.4)] border border-slate-500 font-bold transition-transform hover:scale-105 active:scale-95 backdrop-blur-sm" title={t('sv.returnToStart')}>
                        <GoMoveToStart />
                    </button>
                </div>
            )}
        </div>
    );
}
