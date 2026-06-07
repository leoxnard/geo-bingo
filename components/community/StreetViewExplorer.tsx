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

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';

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

// Imperative API exposed to the builder: jump the panorama to a saved viewpoint
// (clicking a category thumbnail). Done via a ref so the move happens in the
// parent's click handler rather than a prop-driven effect.
export interface StreetViewExplorerHandle {
    openViewpoint: (vp: Viewpoint) => void;
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
}

const DEFAULT_POSITION = { lat: 20, lng: 0 };

const SPOT_ICON = { path: 0 as google.maps.SymbolPath, scale: 6, fillColor: '#f59e0b', fillOpacity: 1, strokeColor: '#fde68a', strokeWeight: 2 };

const StreetViewExplorer = forwardRef<StreetViewExplorerHandle, StreetViewExplorerProps>(function StreetViewExplorer({ isLoaded, mode = 'capture', onSave, onViewpointChange, spots = [], existingNames = [], gameBoundary = '[]', initialPosition }, ref) {
    const { t } = useT();
    const exploreMapRef = useRef<google.maps.Map | null>(null); // map that owns the navigable panorama
    const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
    const miniMapRef = useRef<google.maps.Map | null>(null); // left minimap (capture only)
    const youAreHereRef = useRef<google.maps.Marker | null>(null);
    const youAreHereConeRef = useRef<google.maps.Marker | null>(null); // facing-direction cone
    const lastValidRef = useRef<google.maps.LatLng | null>(null);

    const [pendingSpot, setPendingSpot] = useState<Viewpoint | null>(null);
    const [categoryName, setCategoryName] = useState('');
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

    // Position is applied imperatively (re-renders never snap it back). The pano
    // is hidden until a position is picked in capture mode. No exit button, no
    // zoom +/- (wheel only); walk arrows + compass stay.
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
            zoom: pano.getZoom() ?? 1,
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
    useImperativeHandle(ref, () => ({ openViewpoint }), [openViewpoint]);

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
    // when DROPPED (Street View becomes visible), not while hovering; the minimap
    // itself never stays in panorama view.
    const onMiniMapLoad = useCallback(
        (map: google.maps.Map) => {
            miniMapRef.current = map;
            // Remove any markers from a previous load (React strict-mode / remount)
            // so we never leave an orphaned "you are here" pin stuck at the start.
            youAreHereConeRef.current?.setMap(null);
            youAreHereRef.current?.setMap(null);
            // Facing-direction cone (rotates with the panorama heading), like the
            // in-game minimap.
            // Markers start hidden until the author opens a first position.
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
        setPendingSpot(vp);
        setCategoryName('');
    };

    const confirmSave = () => {
        const name = categoryName.trim();
        if (!pendingSpot || !name || !onSave) return;
        if (existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
            toast.error(t('community.duplicateCategory'));
            return;
        }
        onSave({ categoryName: name, ...pendingSpot });
        setPendingSpot(null);
        setCategoryName('');
    };

    if (!isLoaded) return <div className="h-full w-full flex items-center justify-center bg-slate-800 text-slate-400">{t('common.loading')}</div>;

    return (
        <div className="relative h-full w-full">
            {mode === 'capture' ? (
                <div className="flex h-full w-full flex-col md:flex-row">
                    {/* Left: (mini)map with saved spots, you-are-here dot, droppable Pegman + search */}
                    <div className="relative h-1/2 w-full md:h-full md:w-1/2 border-b md:border-b-0 md:border-r border-slate-800">
                        <GoogleMap mapContainerClassName="absolute inset-0" center={start} zoom={2} options={mapOptions()} onLoad={onMiniMapLoad} onClick={onMiniMapClick}>
                            {boundaryPolys
                                .filter((b) => (b.points?.length ?? 0) >= 3)
                                .map((b) => (
                                    <PolygonF key={b.id} paths={b.points} onUnmount={(p) => p.setMap(null)} options={{ fillColor: b.type === 'allow' ? '#008000' : '#ff0000', fillOpacity: 0.1, strokeColor: b.type === 'allow' ? '#008000' : '#ff0000', strokeOpacity: 0.6, strokeWeight: 2, clickable: false }} />
                                ))}
                            {spots.map((s, i) => (
                                <MarkerF key={i} position={{ lat: s.lat, lng: s.lng }} title={s.categoryName} icon={SPOT_ICON} />
                            ))}
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
                    <div className="relative h-1/2 w-full md:h-full md:w-1/2">
                        <GoogleMap mapContainerClassName="absolute inset-0" center={start} zoom={2} options={mapOptions()} onLoad={onExploreMapLoad}>
                            <StreetViewPanorama options={panoOptions} />
                        </GoogleMap>

                        {!opened && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-900/85 text-center px-6 pointer-events-none">
                                <FaStreetView className="text-indigo-400" size={36} />
                                <p className="text-slate-200 font-medium max-w-xs">{t('community.openFirstPosition')}</p>
                            </div>
                        )}

                        {opened && (
                            <button type="button" onClick={handleSaveClick} className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-full shadow-xl uppercase">
                                <FaCamera /> {t('community.saveSpot')}
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <GoogleMap mapContainerClassName="absolute inset-0" center={start} zoom={2} options={mapOptions()} onLoad={onExploreMapLoad}>
                    <StreetViewPanorama options={panoOptions} />
                </GoogleMap>
            )}

            {/* Name-this-spot modal */}
            {pendingSpot && (
                <div className="absolute inset-0 z-20 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 w-full max-w-md flex flex-col gap-4">
                        <h3 className="font-bold text-white">{t('community.nameSpotTitle')}</h3>
                        <img src={getStreetViewImageUrl(pendingSpot, 400)} alt="" className="w-full rounded-xl aspect-square object-cover" />
                        <input autoFocus type="text" placeholder={t('community.categoryNamePlaceholder')} className="w-full p-3 rounded-xl bg-slate-900 border border-slate-600 focus:border-indigo-500 text-white outline-none" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmSave()} />
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setPendingSpot(null)} className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold uppercase text-sm">
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

export default StreetViewExplorer;
