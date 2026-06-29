'use client';

/*
================================================================================
STREET VIEW EXPLORER
================================================================================
The map used by the community preset builder. Two modes:

  * 'capture'  — a game-like split view: a minimap on the LEFT and the navigable
                 panorama on the RIGHT. The left map shows every saved spot
                 (amber) plus a "you are here" dot (blue); dropping the Pegman on
                 it repositions the right panorama (the left never opens into
                 Street View itself). The place search lives on the left map.
                 "Save spot" grabs the right panorama's position + POV and asks
                 for a category name, previewing the exact view.

  * 'simulate' — a single panorama dropped at the preset's starting point to walk
                 around and sanity-check; movement is reverted if it leaves the
                 boundaries.

This is intentionally separate from the heavy in-game StreetView component, which
is wired to realtime game state, scoring and AI verification.
================================================================================
*/

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { GoogleMap, MarkerF, PolygonF, StreetViewPanorama } from '@react-google-maps/api';
import toast from 'react-hot-toast';
import { FaCamera, FaSearch, FaStreetView } from 'react-icons/fa';

import { getStreetViewImageUrl } from '@/components/streetview/streetViewHelpers';
import { isLocationAllowed, mapOptions } from '@/components/utils/mapUtils';
import type { BoundaryPolygon, CommunityCategory } from '@/components/utils/types';
import { useT } from '@/lib/i18n/I18nProvider';

interface Viewpoint {
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    zoom: number;
}

// Imperative API for the builder: jump the panorama to a saved viewpoint (via a
// ref, so the move happens in the parent's click handler, not a prop effect).
export interface StreetViewExplorerHandle {
    openViewpoint: (vp: Viewpoint) => void;
    // Read the panorama's current position + POV (used by the Daily Challenge play
    // view to capture a "find" without going through the save-spot modal).
    readViewpoint: () => Viewpoint | null;
}

interface StreetViewExplorerProps {
    isLoaded: boolean;
    mode?: 'capture' | 'simulate';
    onSave?: (cat: CommunityCategory) => void;
    /** Reports the current panorama viewpoint (or null when none open) so the
     *  builder can "snapshot" the live view into a category. */
    onViewpointChange?: (vp: Viewpoint | null) => void;
    /** Saved categories — plotted on the left minimap (capture mode). */
    spots?: CommunityCategory[];
    /** Existing category names — used to block duplicates at save time. */
    existingNames?: string[];
    /** Boundary JSON string used to gate movement in 'simulate' mode. */
    gameBoundary?: string;
    /** Where the panorama opens. Falls back to a default street. */
    initialPosition?: { lat: number; lng: number };
    /** Hovered category name from the category list (for minimap zoom effect). */
    hoveredSpot?: string | null;
    /** Daily Challenge manual-select: show a start-point picker in the save modal
     *  (the chosen point is returned on the saved category as startLat/startLng). */
    allowStartPoint?: boolean;
    /** Daily Challenge manual-select: render the capture panorama as a centred
     *  square so the live framing matches the square still that gets saved. */
    panoAspectSquare?: boolean;
    /** Daily Challenge manual-select: report the captured viewpoint up instead of
     *  opening the internal name/start modal — the parent drives the next step
     *  (naming + start point + boundaries). When set, no overlay is shown. */
    onCaptureSpot?: (vp: Viewpoint) => void;
}

const DEFAULT_POSITION = { lat: 20, lng: 0 };

const StreetViewExplorer = forwardRef<StreetViewExplorerHandle, StreetViewExplorerProps>(function StreetViewExplorer({ isLoaded, mode = 'capture', onSave, onViewpointChange, spots = [], existingNames = [], gameBoundary = '[]', initialPosition, hoveredSpot, allowStartPoint = false, panoAspectSquare = false, onCaptureSpot }, ref) {
    const { t } = useT();
    const exploreMapRef = useRef<google.maps.Map | null>(null); // map that owns the navigable panorama
    const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
    const miniMapRef = useRef<google.maps.Map | null>(null); // left minimap (capture only)
    const youAreHereRef = useRef<google.maps.Marker | null>(null);
    const youAreHereConeRef = useRef<google.maps.Marker | null>(null); // facing-direction cone
    const lastValidRef = useRef<google.maps.LatLng | null>(null);
    const prevMiniZoomRef = useRef<number>(3);
    const prevMiniCenterRef = useRef<google.maps.LatLngLiteral | null>(null);

    const [pendingSpot, setPendingSpot] = useState<Viewpoint | null>(null);
    const [pendingStart, setPendingStart] = useState<{ lat: number; lng: number } | null>(null);
    const [categoryName, setCategoryName] = useState('');
    const [categoryHint, setCategoryHint] = useState('');
    const [search, setSearch] = useState('');
    // Capture mode starts with NO open panorama — the author picks the first
    // position on the minimap. Simulate mode opens at the start immediately.
    const [opened, setOpened] = useState(mode === 'simulate');

    const start = initialPosition ?? DEFAULT_POSITION;

    // Boundary polygons to show on the minimap (so the author sees the game area).
    const boundaryPolys = useMemo<BoundaryPolygon[]>(() => {
        if (!gameBoundary || gameBoundary === '[]') return [];
        try {
            const parsed = JSON.parse(gameBoundary);
            return Array.isArray(parsed) ? (parsed as BoundaryPolygon[]) : [];
        } catch {
            return [];
        }
    }, [gameBoundary]);

    // Hidden until a position is picked (capture mode); no exit button, no zoom
    // +/- (wheel only), walk arrows + compass stay.
    const panoOptions = useMemo<google.maps.StreetViewPanoramaOptions>(() => ({ visible: mode === 'simulate', clickToGo: true, linksControl: true, disableDoubleClickZoom: false, addressControl: false, showRoadLabels: false, fullscreenControl: false, motionTracking: false, motionTrackingControl: false, zoomControl: false, enableCloseButton: false, scrollwheel: true }), [mode]);

    const getPano = useCallback((): google.maps.StreetViewPanorama | null => {
        return panoRef.current ?? exploreMapRef.current?.getStreetView() ?? null;
    }, []);

    const readViewpoint = useCallback((): Viewpoint | null => {
        const pano = getPano();
        const pos = pano?.getPosition();
        if (!pano || !pos) return null;
        const pov = pano.getPov();
        return {
            lat: pos.lat(),
            lng: pos.lng(),
            heading: pov.heading ?? 0,
            pitch: pov.pitch ?? 0,
            zoom: pano.getZoom() ?? 3,
        };
    }, [getPano]);

    // Open the panorama at a chosen location (capture mode picks the first one).
    const openAt = useCallback(
        (loc: google.maps.LatLng | google.maps.LatLngLiteral) => {
            const pano = getPano();
            if (!pano) return;
            pano.setPosition(loc);
            pano.setVisible(true);
            setOpened(true);
            youAreHereRef.current?.setPosition(loc);
            youAreHereConeRef.current?.setPosition(loc);
            youAreHereRef.current?.setVisible(true);
            youAreHereConeRef.current?.setVisible(true);
            miniMapRef.current?.panTo(loc);
            onViewpointChange?.(readViewpoint());
        },
        [getPano, onViewpointChange, readViewpoint],
    );

    // Open the panorama at a fully-specified viewpoint (position + POV + zoom),
    // restoring exactly what was captured. Used when a saved spot is focused.
    const openViewpoint = useCallback(
        (vp: Viewpoint) => {
            const pano = getPano();
            if (!pano) return;
            const loc = { lat: vp.lat, lng: vp.lng };
            pano.setPosition(loc);
            pano.setPov({ heading: vp.heading, pitch: vp.pitch });
            pano.setZoom(vp.zoom);
            pano.setVisible(true);
            setOpened(true);
            youAreHereRef.current?.setPosition(loc);
            youAreHereConeRef.current?.setPosition(loc);
            youAreHereRef.current?.setVisible(true);
            youAreHereConeRef.current?.setVisible(true);
            miniMapRef.current?.panTo(loc);
            onViewpointChange?.(readViewpoint());
        },
        [getPano, onViewpointChange, readViewpoint],
    );

    // Let the builder jump the panorama to a saved spot (thumbnail click).
    useImperativeHandle(ref, () => ({ openViewpoint, readViewpoint }), [openViewpoint, readViewpoint]);

    // The navigable panorama (right side in capture; the only map in simulate).
    const onExploreMapLoad = useCallback(
        (map: google.maps.Map) => {
            exploreMapRef.current = map;
            const pano = map.getStreetView();
            panoRef.current = pano;
            // Simulate drops you in at the start; capture waits until a position
            // is picked on the minimap (so re-renders never snap it back).
            if (mode === 'simulate') pano.setPosition(start);

            pano.addListener('position_changed', () => {
                const pos = pano.getPosition();
                if (!pos) return;

                if (mode === 'simulate') {
                    if (isLocationAllowed({ lat: pos.lat(), lng: pos.lng() }, gameBoundary)) {
                        lastValidRef.current = pos;
                    } else if (lastValidRef.current) {
                        pano.setPosition(lastValidRef.current);
                    }
                } else {
                    // Keep the "you are here" dot + cone + minimap centre in sync.
                    youAreHereRef.current?.setPosition(pos);
                    youAreHereConeRef.current?.setPosition(pos);
                    miniMapRef.current?.panTo(pos);
                    onViewpointChange?.(readViewpoint());
                }
            });

            // Rotate the minimap direction cone + report the live viewpoint.
            if (mode === 'capture') {
                pano.addListener('pov_changed', () => {
                    const cone = youAreHereConeRef.current;
                    if (cone) {
                        const icon = cone.getIcon() as google.maps.Symbol;
                        cone.setIcon({ ...icon, rotation: pano.getPov().heading });
                    }
                    onViewpointChange?.(readViewpoint());
                });
            }
        },
        [mode, gameBoundary, start, onViewpointChange, readViewpoint],
    );

    // Left minimap (capture only). The Pegman repositions the right panorama only
    // when dropped (not while hovering); the minimap never stays in panorama view.
    const onMiniMapLoad = useCallback(
        (map: google.maps.Map) => {
            miniMapRef.current = map;
            // Remove any markers from a previous load (React strict-mode / remount)
            // so we never leave an orphaned "you are here" pin stuck at the start.
            youAreHereConeRef.current?.setMap(null);
            youAreHereRef.current?.setMap(null);
            // Facing-direction cone (rotates with the panorama heading), like the
            // in-game minimap. Hidden until the author opens a first position.
            youAreHereConeRef.current = new google.maps.Marker({
                map,
                position: start,
                visible: false,
                zIndex: 998,
                clickable: false,
                icon: { path: 'M -4,0 L -10,-30 A 30,30 0 0,1 10,-30 L 4,0 Z', fillColor: '#38bdf8', fillOpacity: 0.35, strokeWeight: 0, scale: 1.5, anchor: new google.maps.Point(0, 0), rotation: 0 },
            });
            youAreHereRef.current = new google.maps.Marker({
                map,
                position: start,
                visible: false,
                zIndex: 999,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#38bdf8', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 },
            });

            // Dropping the Pegman opens the panorama at that point.
            const sv = map.getStreetView();
            sv.addListener('visible_changed', () => {
                if (!sv.getVisible()) return;
                setTimeout(() => {
                    const pos = sv.getPosition();
                    if (pos) openAt(pos);
                    sv.setVisible(false);
                }, 0);
            });
        },
        [openAt, start],
    );

    // Clicking the minimap opens Street View at the nearest panorama.
    const onMiniMapClick = useCallback(
        (e: google.maps.MapMouseEvent) => {
            if (!e.latLng) return;
            const svc = new google.maps.StreetViewService();
            svc.getPanorama({ location: e.latLng, radius: 100 }, (data, status) => {
                if (status === google.maps.StreetViewStatus.OK && data?.location?.latLng) {
                    openAt(data.location.latLng);
                } else {
                    toast.error(t('community.noStreetViewHere'));
                }
            });
        },
        [openAt, t],
    );

    const runSearch = async () => {
        const q = search.trim();
        if (!q) return;
        try {
            const { places } = await google.maps.places.Place.searchByText({ textQuery: q, fields: ['location'], maxResultCount: 1 });
            const loc = places[0]?.location;
            if (loc) {
                openAt(loc);
            } else {
                toast.error(t('community.searchNoResult'));
            }
        } catch {
            toast.error(t('community.searchNoResult'));
        }
    };

    const handleSaveClick = () => {
        const vp = readViewpoint();
        if (!vp) return;
        // Daily admin: skip the overlay and hand the viewpoint to the parent.
        if (onCaptureSpot) {
            onCaptureSpot(vp);
            return;
        }
        setPendingSpot(vp);
        setCategoryName('');
    };

    // Effect to zoom minimap when hovering a spot (from category list)
    useEffect(() => {
        if (!miniMapRef.current || mode !== 'capture') return;
        if (hoveredSpot) {
            const spot = spots.find((s) => s.categoryName === hoveredSpot);
            if (spot) {
                // Remember where we were so we can return exactly here on hover end
                prevMiniZoomRef.current = miniMapRef.current.getZoom() ?? 3;
                const center = miniMapRef.current.getCenter();
                prevMiniCenterRef.current = center ? { lat: center.lat(), lng: center.lng() } : null;
                miniMapRef.current.panTo({ lat: spot.lat, lng: spot.lng });
                miniMapRef.current.setZoom(10);
            }
        } else {
            miniMapRef.current.setZoom(prevMiniZoomRef.current);
            if (prevMiniCenterRef.current) {
                miniMapRef.current.panTo(prevMiniCenterRef.current);
            }
        }
    }, [hoveredSpot, spots, mode]);

    const confirmSave = () => {
        const name = categoryName.trim();
        if (!pendingSpot || !name || !onSave) return;
        if (existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
            toast.error(t('community.duplicateCategory'));
            return;
        }
        const hint = categoryHint.trim();
        onSave({ categoryName: name, hint: hint || undefined, ...pendingSpot, ...(pendingStart ? { startLat: pendingStart.lat, startLng: pendingStart.lng } : {}) });
        setPendingSpot(null);
        setPendingStart(null);
        setCategoryName('');
        setCategoryHint('');
    };

    if (!isLoaded) return <div className="h-full w-full flex items-center justify-center bg-slate-800 text-slate-400">{t('common.loading')}</div>;

    return (
        <div className="relative h-full w-full">
            {mode === 'capture' ? (
                <div className="flex h-full w-full flex-col md:flex-row">
                    {/* Left: (mini)map with saved spots, you-are-here dot, droppable Pegman + search */}
                    <div className="relative h-1/2 w-full md:h-full md:w-1/2 border-b md:border-b-0 md:border-r border-slate-800">
                        <GoogleMap mapContainerClassName="absolute inset-0" center={start} zoom={3} options={mapOptions()} onLoad={onMiniMapLoad} onClick={onMiniMapClick}>
                            {boundaryPolys
                                .filter((b) => (b.points?.length ?? 0) >= 3)
                                .map((b) => (
                                    <PolygonF key={b.id} paths={b.points} onUnmount={(p) => p.setMap(null)} options={{ fillColor: b.type === 'allow' ? '#008000' : '#ff0000', fillOpacity: 0.1, strokeColor: b.type === 'allow' ? '#008000' : '#ff0000', strokeOpacity: 0.6, strokeWeight: 2, clickable: false }} />
                                ))}
                            {spots.map((s, i) => {
                                const vp: Viewpoint = { lat: s.lat, lng: s.lng, heading: s.heading, pitch: s.pitch, zoom: s.zoom };
                                return (
                                    <MarkerF
                                        key={i}
                                        position={{ lat: s.lat, lng: s.lng }}
                                        title={s.categoryName}
                                        onClick={() => openViewpoint(vp)}
                                        options={{
                                            icon: {
                                                path: google.maps.SymbolPath.CIRCLE,
                                                scale: 6,
                                                fillColor: '#f59e0b',
                                                fillOpacity: 1,
                                                strokeColor: '#fde68a',
                                                strokeWeight: 2,
                                            },
                                        }}
                                    />
                                );
                            })}
                        </GoogleMap>
                        <span className="absolute bottom-2 left-2 z-10 rounded-md bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-slate-300 shadow">{t('community.miniMapHint')}</span>

                        {/* Search jumps the panorama */}
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[min(92%,360px)] z-10 flex gap-2">
                            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch()} placeholder={t('community.searchPlace')} className="flex-1 p-2.5 rounded-xl bg-slate-900/90 border border-slate-600 focus:border-indigo-500 text-white outline-none shadow-lg" />
                            <button type="button" onClick={runSearch} aria-label={t('community.searchPlace')} className="px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg">
                                <FaSearch />
                            </button>
                        </div>
                    </div>

                    {/* Right: navigable panorama (opens once a position is picked) */}
                    <div className="relative flex h-1/2 w-full items-center justify-center bg-slate-900 md:h-full md:w-1/2" style={panoAspectSquare ? { containerType: 'size' } : undefined}>
                        {/* In square mode the panorama is the largest centred square that fits
                            (min of the panel's width/height), so the live view matches the
                            square still that "Save spot" captures. */}
                        <div className={panoAspectSquare ? 'relative' : 'absolute inset-0'} style={panoAspectSquare ? { width: 'min(100cqw, 100cqh)', height: 'min(100cqw, 100cqh)' } : undefined}>
                            <GoogleMap mapContainerClassName="absolute inset-0" center={start} zoom={3} options={mapOptions()} onLoad={onExploreMapLoad}>
                                <StreetViewPanorama options={panoOptions} />
                            </GoogleMap>
                        </div>

                        {!opened && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-900/85 text-center px-6 pointer-events-none">
                                <FaStreetView className="text-indigo-400" size={36} />
                                <p className="text-slate-200 font-medium max-w-xs">{t('community.openFirstPosition')}</p>
                            </div>
                        )}

                        {opened && (onSave || onCaptureSpot) && (
                            <button type="button" onClick={handleSaveClick} className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-full shadow-xl uppercase">
                                <FaCamera /> {t('community.saveSpot')}
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <GoogleMap mapContainerClassName="absolute inset-0" center={start} zoom={3} options={mapOptions()} onLoad={onExploreMapLoad}>
                    <StreetViewPanorama options={panoOptions} />
                </GoogleMap>
            )}

            {/* Name-this-spot modal */}
            {pendingSpot && (
                <div className="absolute inset-0 z-20 bg-black/60 flex items-center justify-center p-4">
                    <div className={`bg-slate-800 border border-slate-700 rounded-2xl p-5 w-full ${allowStartPoint ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto flex flex-col gap-4`}>
                        <h3 className="font-bold text-white">{t('community.nameSpotTitle')}</h3>
                        <img src={getStreetViewImageUrl(pendingSpot, 400)} alt="" className="w-full rounded-xl aspect-square object-cover" />
                        <input autoFocus type="text" placeholder={t('community.categoryNamePlaceholder')} className="w-full p-3 rounded-xl bg-slate-900 border border-slate-600 focus:border-indigo-500 text-white outline-none" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmSave()} />
                        <input type="text" placeholder={t('community.categoryHintPlaceholder')} className="w-full p-3 rounded-xl bg-slate-900 border border-slate-600 focus:border-indigo-500 text-white outline-none" value={categoryHint} onChange={(e) => setCategoryHint(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmSave()} />

                        {allowStartPoint && (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-bold text-slate-200">{t('community.startPoint')}</p>
                                    {pendingStart && (
                                        <button type="button" onClick={() => setPendingStart(null)} className="text-xs font-medium text-slate-400 hover:text-white">
                                            {t('community.clearStart')}
                                        </button>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500">{t('community.startHelp')}</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-600">
                                        <StartPointPicker value={pendingStart} onChange={setPendingStart} />
                                    </div>
                                    <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-600 bg-slate-900">{pendingStart ? <img src={getStreetViewImageUrl({ lat: pendingStart.lat, lng: pendingStart.lng, heading: 0, pitch: 0, zoom: 1 }, 300)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-slate-500">{t('community.startPreviewEmpty')}</div>}</div>
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2 justify-end">
                            <button
                                type="button"
                                onClick={() => {
                                    setPendingSpot(null);
                                    setPendingStart(null);
                                    setCategoryHint('');
                                }}
                                className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold uppercase text-sm"
                            >
                                {t('common.cancel')}
                            </button>
                            <button type="button" onClick={confirmSave} disabled={!categoryName.trim()} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold uppercase text-sm disabled:opacity-50">
                                {t('community.saveCategory')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

// A compact map for picking a Daily-Challenge start point: drop the Pegman or
// click/drag the marker. Reports the chosen point (or null to clear) upward; the
// parent renders the Street View preview next to it.
function StartPointPicker({ value, onChange }: { value: { lat: number; lng: number } | null; onChange: (p: { lat: number; lng: number } | null) => void }) {
    const onLoad = useCallback(
        (map: google.maps.Map) => {
            const sv = map.getStreetView();
            sv.addListener('visible_changed', () => {
                if (!sv.getVisible()) return;
                // We only want where the Pegman landed — grab it, then close the
                // panorama (this picker never walks around).
                setTimeout(() => {
                    const pos = sv.getPosition();
                    if (pos) onChange({ lat: pos.lat(), lng: pos.lng() });
                    sv.setVisible(false);
                }, 0);
            });
        },
        [onChange],
    );

    return (
        <GoogleMap mapContainerClassName="absolute inset-0" center={value ?? DEFAULT_POSITION} zoom={value ? 14 : 2} options={mapOptions({ streetViewControl: true })} onLoad={onLoad} onClick={(e) => e.latLng && onChange({ lat: e.latLng.lat(), lng: e.latLng.lng() })}>
            {value && <MarkerF position={value} draggable onDragEnd={(e) => e.latLng && onChange({ lat: e.latLng.lat(), lng: e.latLng.lng() })} />}
        </GoogleMap>
    );
}

export default StreetViewExplorer;
