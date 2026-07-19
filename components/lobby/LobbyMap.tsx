'use client';

/*
================================================================================
LOBBY MAP COMPONENT
================================================================================
Interactive map for game area and boundary configuration.
Supports polygon drawing, radius setting, and starting point selection.
Integrates with nearby place and street view category generation.
================================================================================
*/

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Fragment } from 'react';

import { GoogleMap, PolygonF, MarkerF, OverlayView, OverlayViewF, CircleF, PolylineF, RectangleF } from '@react-google-maps/api';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { FaPlus, FaTimes, FaUndo, FaSearchLocation, FaSpinner } from 'react-icons/fa';

import { useT } from '@/lib/i18n/I18nProvider';

import { MaskIcon } from '../utils/Elements';
import { insertPoint, insertPointPhase1, mapOptions, WORLD_DEFAULT_ID, parseWorldDefault, geoResultToBoundaries, GeoPlaceResult } from '../utils/mapUtils';
import { BoundaryPolygon } from '../utils/types';

const DEFAULT_CENTER = { lat: 20, lng: 0 };

// Continents are the one gap in the live place search: OSM/Nominatim has no
// administrative relation for them, so a search for "Europe" returns a city or
// nothing usable. These keys resolve from the bundled geo_bingo_presets.json
// geometry instead and are injected into the search results as a fallback. Every
// other area (countries, states, regions, cities) now comes from the live search,
// which is why the old preset dropdown below is commented out.
const CONTINENT_KEYS = ['Africa', 'Antarctica', 'Asia', 'Europe', 'North_America', 'Oceania', 'South_America'];

interface Point {
    lat: number;
    lng: number;
}

interface LobbyMapProps {
    isHost: boolean;
    isLoaded: boolean;
    startingPoint: string;
    gameBoundary: string;
    generationRadius?: number;
    updateGameModeInfo: (updates: { starting_point?: string; gameBoundary?: string; category_source?: 'manual' | 'nearbyPlaces' | 'nearbyStreetView' }) => void;
    extraMarkers?: { lat: number; lng: number; label?: string }[];
    hoveredCategory?: string | null;
    centerOn?: { lat: number; lng: number; zoom?: number };
    hideDescription?: boolean;
}

export default function LobbyMap({ isHost, isLoaded, startingPoint, gameBoundary, generationRadius, updateGameModeInfo, extraMarkers, hoveredCategory, centerOn, hideDescription = false }: LobbyMapProps) {
    const { t, locale } = useT();
    const containerRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [showCoverage, setShowCoverage] = useState(false);
    const coverageLayerRef = useRef<google.maps.StreetViewCoverageLayer | null>(null);
    const [hoveredLocation, setHoveredLocation] = useState<Point | null>(null);
    const [selectedBoundaryId, setSelectedBoundaryId] = useState<string | null>(null);
    const prevZoomRef = useRef<number>(1);
    const prevCenterRef = useRef<google.maps.LatLngLiteral | null>(null);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    // ---- live place search (real OSM administrative boundaries) ----
    const [placeSearch, setPlaceSearch] = useState('');
    const [placeResults, setPlaceResults] = useState<GeoPlaceResult[]>([]);
    const [placeLoading, setPlaceLoading] = useState(false);
    const [placeErrored, setPlaceErrored] = useState(false);
    const [placeMenuOpen, setPlaceMenuOpen] = useState(false);
    const placeDropdownRef = useRef<HTMLDivElement>(null);
    const placeMenuRef = useRef<HTMLDivElement>(null);
    const [placeMenuRect, setPlaceMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
    const placeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const placeAbortRef = useRef<AbortController | null>(null);
    const [optimisticGameBoundary, setOptimisticGameBoundary] = useState(gameBoundary);
    const optimisticGameBoundaryRef = useRef(gameBoundary);
    const pendingWritesRef = useRef<Set<string>>(new Set());
    const updateGameModeInfoRef = useRef(updateGameModeInfo);
    updateGameModeInfoRef.current = updateGameModeInfo;
    const boundaryWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingBoundaryWriteRef = useRef<string | null>(null);
    const lastLocalEditAtRef = useRef(0);
    const [worldDefault, setWorldDefault] = useState<'allow' | 'forbid'>(() => parseWorldDefault(gameBoundary));
    type BoundaryHistoryEntry = { boundaries: string; selectedId: string | null };
    const [boundaryHistory, setBoundaryHistory] = useState<BoundaryHistoryEntry[]>([]);
    const HISTORY_LIMIT = 20;

    // Preset geometry is still loaded — the continent fallback resolves from it —
    // but the preset *dropdown* is gone; the live place search covers everything else.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [boundaryPresetsData, setBoundaryPresetsData] = useState<Record<string, any[]>>({});
    const [presetsLoading, setPresetsLoading] = useState(true);

    const actualStart = startingPoint || 'open-world';

    const additionalMapOptions = useMemo(
        () => ({
            streetViewControl: isHost,
            gestureHandling: 'greedy',
            draggableCursor: isHost ? 'crosshair' : 'default',
            disableDoubleClickZoom: isHost,
        }),
        [isHost],
    );

    useEffect(() => {
        // no-store: browsers cache this static JSON aggressively; stale copies
        // resurface fixed geometry bugs (e.g. the old duplicated Antarctica areas).
        fetch('/geo_bingo_presets.json', { cache: 'no-store' })
            .then((res) => res.json())
            .then((data: Record<string, { id?: string; points: unknown[] }[]>) => {
                // Defensive dedupe: identical areas sharing an id would render
                // duplicate React keys and double-stacked polygons.
                Object.keys(data).forEach((key) => {
                    const seen = new Set<string>();
                    data[key] = data[key].filter((area, i) => {
                        const id = area.id || String(i);
                        if (seen.has(id)) return false;
                        seen.add(id);
                        return true;
                    });
                });
                setBoundaryPresetsData(data);
                setPresetsLoading(false);
            })
            .catch((err) => {
                console.error('Failed to load boundary presets:', err);
                setPresetsLoading(false);
            });
    }, []);

    useEffect(() => {
        // Ignore our own value and echoes of our own writes (parent re-emits each twice).
        if (gameBoundary === optimisticGameBoundaryRef.current) return;
        if (pendingWritesRef.current.has(gameBoundary)) return;
        if (Date.now() - lastLocalEditAtRef.current < 1500) return;
        optimisticGameBoundaryRef.current = gameBoundary;
        setOptimisticGameBoundary(gameBoundary);
        setWorldDefault(parseWorldDefault(gameBoundary));
    }, [gameBoundary]);

    // Zoom to hovered category (slightly zoomed in to see the point)
    const wasHoveringRef = useRef(false);
    useEffect(() => {
        if (!mapInstance) return;
        if (hoveredCategory && extraMarkers) {
            const marker = extraMarkers.find((m) => m.label === hoveredCategory);
            if (marker) {
                wasHoveringRef.current = true;
                prevZoomRef.current = mapInstance.getZoom() ?? 1;
                const center = mapInstance.getCenter();
                prevCenterRef.current = center ? { lat: center.lat(), lng: center.lng() } : null;
                mapInstance.panTo({ lat: marker.lat, lng: marker.lng });
                mapInstance.setZoom(12);
            }
        } else if (!hoveredCategory && wasHoveringRef.current) {
            wasHoveringRef.current = false;
            mapInstance.setZoom(prevZoomRef.current);
            if (prevCenterRef.current) {
                mapInstance.panTo(prevCenterRef.current);
            }
        }
    }, [hoveredCategory, extraMarkers, mapInstance]);

    // Pan + zoom to a fixed point on first load (e.g. the captured Street View spot).
    useEffect(() => {
        if (!mapInstance || !centerOn) return;
        mapInstance.panTo({ lat: centerOn.lat, lng: centerOn.lng });
        mapInstance.setZoom(centerOn.zoom ?? 14);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapInstance]);

    useEffect(() => {
        if (!mapInstance) return;
        if (!coverageLayerRef.current) coverageLayerRef.current = new google.maps.StreetViewCoverageLayer();
        coverageLayerRef.current.setMap(showCoverage ? mapInstance : null);
    }, [mapInstance, showCoverage]);

    useEffect(() => () => coverageLayerRef.current?.setMap(null), []);

    const parseBoundaryString = (boundaryString: string): BoundaryPolygon[] => {
        if (!boundaryString || boundaryString === '[]') return [];

        try {
            const parsed = JSON.parse(boundaryString);
            if (!Array.isArray(parsed)) return [];

            if (parsed.length > 0 && parsed[0].lat !== undefined && parsed[0].id === undefined) {
                return [{ id: 'legacy-1', type: 'allow', points: parsed, isComplete: true }];
            }

            return parsed
                .filter((p) => p.id !== WORLD_DEFAULT_ID) // drop the world-default sentinel; tracked separately
                .map((p) => ({
                    ...p,
                    isComplete: p.isComplete !== false, // Default to true if not explicitly set to false
                }));
        } catch (e) {
            console.error('Invalid polygon data', e);
            return [];
        }
    };

    // ── Preset dropdown (commented out) ──────────────────────────────────────────
    // The live place search now covers countries, states, regions and cities with
    // real OSM boundaries, so the bundled preset picker is redundant. Only the
    // continent geometry is still used, surfaced through the search as a fallback
    // (see continentResults / presetToBoundaries below). The old grouping logic —
    // Continents / Large Cities / Regions & Nature / US States / German States /
    // Countries, with the /admin/presets "group" override — is intentionally
    // removed here along with its dropdown UI further down.

    // Localized preset display name: generated presets carry a "names" map
    // ({en,de,es,fr,zh}, DeepL-translated at generation time by
    // getProcessedCountryBorders.py); fall back to formatting the key for data
    // that predates it.
    const getDisplayName = useCallback(
        (key: string) => {
            if (!key) return '';
            const names = boundaryPresetsData[key]?.[0]?.names as Record<string, string> | undefined;
            const localized = names?.[locale] || names?.en;
            return localized || key.replace(/_/g, ' ').replace('US ', '').replace('DE ', '');
        },
        [boundaryPresetsData, locale],
    );

    // Search matches both the English key and the localized display name.
    const matchesTerm = useCallback(
        (key: string, term: string) =>
            [key.replace(/_/g, ' '), getDisplayName(key)].some((candidate) => {
                const normalized = candidate.toLowerCase();
                return normalized.startsWith(term) || normalized.includes(` ${term}`);
            }),
        [getDisplayName],
    );

    // Continent fallback: match the typed term against the bundled continent presets
    // and expose them as search results, since OSM has no boundary relation for them.
    const continentResults = useCallback(
        (term: string): GeoPlaceResult[] => {
            const q = term.trim().toLowerCase();
            if (!q) return [];
            return CONTINENT_KEYS.filter((key) => Array.isArray(boundaryPresetsData[key]) && boundaryPresetsData[key].length > 0 && matchesTerm(key, q)).map((key) => ({
                osmId: `preset:${key}`,
                presetKey: key,
                name: getDisplayName(key),
                label: t('map.searchPlaceContinent'),
                type: 'continent',
                geojson: null,
            }));
        },
        [boundaryPresetsData, matchesTerm, getDisplayName, t],
    );

    // Build boundary zones from bundled preset geometry (the continent fallback path).
    const presetToBoundaries = useCallback(
        (presetKey: string, groupId: string): BoundaryPolygon[] => {
            const presetData = boundaryPresetsData[presetKey];
            if (!Array.isArray(presetData) || presetData.length === 0) return [];
            const formattedName = getDisplayName(presetKey);
            return presetData.map((area, index) => ({
                // Preset ids are static in geo_bingo_presets.json; namespace them per
                // application so selecting the same preset twice never collides.
                id: `${groupId}_${area.id || index}`,
                groupId,
                type: (area.type || 'allow') as 'allow' | 'forbid',
                points: area.points,
                name: formattedName,
                isComplete: true, // Preset polygons are already complete
            }));
        },
        [boundaryPresetsData, getDisplayName],
    );

    const draftBoundaries: BoundaryPolygon[] = useMemo(() => {
        const boundarySource = optimisticGameBoundary || gameBoundary;
        return parseBoundaryString(boundarySource);
    }, [optimisticGameBoundary, gameBoundary]);

    const serializeBoundaries = (boundaries: BoundaryPolygon[], wd: 'allow' | 'forbid') => JSON.stringify(wd === 'forbid' ? [{ id: WORLD_DEFAULT_ID, type: 'forbid' as const, points: [] }, ...boundaries] : boundaries);

    const writeBoundaryToParent = (value: string) => {
        while (pendingWritesRef.current.size > 60) {
            const oldest = pendingWritesRef.current.values().next().value as string;
            pendingWritesRef.current.delete(oldest);
        }
        pendingWritesRef.current.add(value);
        updateGameModeInfoRef.current({ gameBoundary: value });
    };

    // Flush any pending debounced write immediately (e.g. on unmount).
    const flushBoundaryWrite = () => {
        if (boundaryWriteTimerRef.current) {
            clearTimeout(boundaryWriteTimerRef.current);
            boundaryWriteTimerRef.current = null;
        }
        const value = pendingBoundaryWriteRef.current;
        pendingBoundaryWriteRef.current = null;
        if (value !== null) writeBoundaryToParent(value);
    };

    const commitBoundaryChange = (nextBoundaries: BoundaryPolygon[], options: { skipHistory?: boolean; worldDefault?: 'allow' | 'forbid'; debounce?: boolean } = {}) => {
        const nextBoundaryString = serializeBoundaries(nextBoundaries, options.worldDefault ?? worldDefault);
        const previous = optimisticGameBoundaryRef.current ?? '[]';
        if (!options.skipHistory && previous !== nextBoundaryString) {
            const snapshot: BoundaryHistoryEntry = { boundaries: previous, selectedId: selectedBoundaryId };
            setBoundaryHistory((prev) => [...prev, snapshot].slice(-HISTORY_LIMIT));
        }
        // Local optimistic state updates instantly so drawing stays smooth.
        optimisticGameBoundaryRef.current = nextBoundaryString;
        lastLocalEditAtRef.current = Date.now();
        setOptimisticGameBoundary(nextBoundaryString);

        if (options.debounce) {
            pendingBoundaryWriteRef.current = nextBoundaryString;
            if (boundaryWriteTimerRef.current) clearTimeout(boundaryWriteTimerRef.current);
            boundaryWriteTimerRef.current = setTimeout(flushBoundaryWrite, 250);
        } else {
            if (boundaryWriteTimerRef.current) {
                clearTimeout(boundaryWriteTimerRef.current);
                boundaryWriteTimerRef.current = null;
            }
            pendingBoundaryWriteRef.current = null;
            writeBoundaryToParent(nextBoundaryString);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => () => flushBoundaryWrite(), []);

    const handleUndoBoundary = () => {
        if (boundaryHistory.length === 0) return;

        const restored = boundaryHistory[boundaryHistory.length - 1];
        const restoredBoundaries = parseBoundaryString(restored.boundaries);
        const restoredId = restored.selectedId && restoredBoundaries.some((b) => b.id === restored.selectedId) ? restored.selectedId : null;

        setBoundaryHistory((prev) => prev.slice(0, -1));

        if (boundaryWriteTimerRef.current) {
            clearTimeout(boundaryWriteTimerRef.current);
            boundaryWriteTimerRef.current = null;
        }
        pendingBoundaryWriteRef.current = null;
        optimisticGameBoundaryRef.current = restored.boundaries;
        lastLocalEditAtRef.current = Date.now();
        setOptimisticGameBoundary(restored.boundaries);
        writeBoundaryToParent(restored.boundaries);
        setWorldDefault(parseWorldDefault(restored.boundaries));
        setSelectedBoundaryId(restoredId);
    };

    const handleSetWorldDefault = (next: 'allow' | 'forbid') => {
        if (next === worldDefault) return;
        setWorldDefault(next);
        commitBoundaryChange(draftBoundaries, { worldDefault: next });
    };

    const uniformZoneType = useMemo<'allow' | 'forbid' | null>(() => {
        if (draftBoundaries.length === 0) return null;
        const first = draftBoundaries[0].type;
        return draftBoundaries.every((b) => b.type === first) ? first : null;
    }, [draftBoundaries]);
    const hasMixedZones = draftBoundaries.length > 0 && uniformZoneType === null;

    useEffect(() => {
        if (!uniformZoneType) return;
        const forced: 'allow' | 'forbid' = uniformZoneType === 'allow' ? 'forbid' : 'allow';
        if (forced !== worldDefault) {
            setWorldDefault(forced);
            commitBoundaryChange(draftBoundaries, { worldDefault: forced, skipHistory: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uniformZoneType]);

    const activeBoundaryId = useMemo(() => {
        if (draftBoundaries.length === 0) return null;
        if (selectedBoundaryId && draftBoundaries.some((b) => (b.groupId || b.id) === selectedBoundaryId)) {
            return selectedBoundaryId;
        }
        return null;
    }, [draftBoundaries, selectedBoundaryId]);

    useEffect(() => {
        if (!mapInstance || !isHost) return;
        const sv = mapInstance.getStreetView();

        // Initialisiere den StreetViewService
        const svService = new google.maps.StreetViewService();

        const listener = google.maps.event.addListener(sv, 'position_changed', () => {
            const pos = sv.getPosition();

            if (pos) {
                svService.getPanorama(
                    {
                        location: pos,
                        radius: 500,
                    },
                    (data, status) => {
                        if (status === google.maps.StreetViewStatus.OK && data && data.links && data.links.length > 0) {
                            updateGameModeInfo({
                                starting_point: JSON.stringify({
                                    lat: data.location?.latLng?.lat(),
                                    lng: data.location?.latLng?.lng(),
                                }),
                            });
                        } else {
                            console.warn('No navigable street point found nearby.');
                        }
                    },
                );

                sv.setVisible(false);
            }
        });

        const visibleListener = google.maps.event.addListener(sv, 'visible_changed', () => {
            if (sv.getVisible()) {
                setTimeout(() => sv.setVisible(false), 50);
            }
        });

        return () => {
            google.maps.event.removeListener(listener);
            google.maps.event.removeListener(visibleListener);
        };
    }, [mapInstance, isHost, updateGameModeInfo]);

    const handleMapClick = (e: google.maps.MapMouseEvent) => {
        if (!isHost || !e.latLng) return;
        const newPoint = { lat: e.latLng.lat(), lng: e.latLng.lng() };

        const currentBoundaries = parseBoundaryString(optimisticGameBoundaryRef.current || gameBoundary);
        let newBoundaries = [...currentBoundaries];

        const hasActiveSelection = selectedBoundaryId && newBoundaries.some((boundary) => boundary.id === selectedBoundaryId);

        if (newBoundaries.length === 0 || !hasActiveSelection) {
            const newId = Date.now().toString();
            newBoundaries = [...newBoundaries, { id: newId, type: 'allow', points: [newPoint], isComplete: false }];
            setSelectedBoundaryId(newId);
        } else {
            const targetId = selectedBoundaryId as string;
            newBoundaries = newBoundaries.map((b) => {
                if (b.id === targetId) {
                    const targetBoundary = b;
                    const points = targetBoundary.points;
                    const isComplete = targetBoundary.isComplete ?? false;

                    // Phase 1: If polygon is not complete and has at least 1 point
                    if (!isComplete && points.length > 0) {
                        // Phase 1: always append; closing handled via start-handle marker
                        return { ...b, points: insertPointPhase1(newPoint, points) };
                    }

                    // Phase 2: If polygon is complete, use the smart insertion algorithm
                    if (isComplete && points.length >= 3) {
                        return { ...b, points: insertPoint(newPoint, points) };
                    }

                    // Fallback: append the point
                    return { ...b, points: insertPointPhase1(newPoint, points) };
                }
                return b;
            });
        }
        commitBoundaryChange(newBoundaries, { debounce: true });
    };

    const handleAddBoundary = (baseBoundaries: BoundaryPolygon[] = draftBoundaries) => {
        const newId = Date.now().toString();
        const newBoundaries: BoundaryPolygon[] = [...baseBoundaries, { id: newId, type: 'allow' as const, points: [], isComplete: false }];
        commitBoundaryChange(newBoundaries);
        setSelectedBoundaryId(newId);
    };

    const handleCloseBoundary = (boundaryId: string) => {
        const currentBoundaries = parseBoundaryString(optimisticGameBoundaryRef.current || gameBoundary);
        const newBoundaries = currentBoundaries.map((b) => (b.id === boundaryId ? { ...b, isComplete: true } : b));
        commitBoundaryChange(newBoundaries);
        // Deselect; the next map click will spawn a fresh boundary at that point.
        setSelectedBoundaryId(null);
    };

    const handleRemoveBoundaryPoint = (boundaryId: string, pointIdx: number) => {
        if (!isHost) return;
        const currentBoundaries = parseBoundaryString(optimisticGameBoundaryRef.current || gameBoundary);
        const newBoundaries = currentBoundaries
            .map((b) => {
                if (b.id !== boundaryId) return b;
                const points = b.points.filter((_, i) => i !== pointIdx);
                const isComplete = b.isComplete && points.length >= 3;
                return { ...b, points, isComplete };
            })
            .filter((b) => b.points.length > 0); // drop the area entirely once empty
        // See handleRemoveGroup: don't leave a lingering "forbid everything, allow
        // nowhere" default behind once the last drawn area is gone.
        if (newBoundaries.length === 0 && worldDefault === 'forbid') {
            setWorldDefault('allow');
            commitBoundaryChange(newBoundaries, { worldDefault: 'allow' });
        } else {
            commitBoundaryChange(newBoundaries);
        }
    };

    const handleDrop = (dropIndex: number) => {
        if (draggedIndex === null || draggedIndex === dropIndex) return;

        const newGroups = [...displayBoundaries];
        const [draggedGroup] = newGroups.splice(draggedIndex, 1);
        newGroups.splice(dropIndex, 0, draggedGroup);

        const newBoundaries: BoundaryPolygon[] = [];
        newGroups.forEach((group) => {
            const itemsInGroup = draftBoundaries.filter((b) => (b.groupId || b.id) === group.key);
            newBoundaries.push(...itemsInGroup);
        });

        commitBoundaryChange(newBoundaries);
        setDraggedIndex(null);
    };

    // Debounced live geocode: fetch real OSM boundaries for the typed place. The
    // proxy (/api/geocode) sets Nominatim's required User-Agent server-side.
    useEffect(() => {
        const q = placeSearch.trim();
        if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current);
        if (q.length < 2) {
            setPlaceResults([]);
            setPlaceLoading(false);
            setPlaceErrored(false);
            return;
        }
        setPlaceLoading(true);
        setPlaceErrored(false);
        placeDebounceRef.current = setTimeout(() => {
            placeAbortRef.current?.abort();
            const controller = new AbortController();
            placeAbortRef.current = controller;
            // Local continent matches are prepended to (and survive the failure of)
            // the geocode call — they never depend on the network.
            const locals = continentResults(q);
            fetch(`/api/geocode?q=${encodeURIComponent(q)}&lang=${locale}`, { signal: controller.signal })
                .then((res) => res.json())
                .then((data: { results?: GeoPlaceResult[]; error?: string }) => {
                    if (controller.signal.aborted) return;
                    // Nominatim DOES return a row for a continent, but with no polygon —
                    // only a bounding box, which would import as a crude rectangle. Drop
                    // those so the preset-backed entry above is the only continent offered.
                    const localNames = new Set(locals.map((l) => l.name.toLowerCase()));
                    const remote = (Array.isArray(data.results) ? data.results : []).filter((r) => r.type !== 'continent' && !localNames.has((r.name || '').toLowerCase()));
                    setPlaceResults([...locals, ...remote]);
                    setPlaceErrored(Boolean(data.error) && locals.length === 0);
                    setPlaceLoading(false);
                })
                .catch((err: unknown) => {
                    if (controller.signal.aborted || (err as { name?: string })?.name === 'AbortError') return;
                    setPlaceResults(locals);
                    setPlaceErrored(locals.length === 0);
                    setPlaceLoading(false);
                });
        }, 450);
        return () => {
            if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current);
        };
    }, [placeSearch, locale, continentResults]);

    useEffect(() => () => placeAbortRef.current?.abort(), []);

    // Close the place-search menu on outside click.
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (placeDropdownRef.current?.contains(target) || placeMenuRef.current?.contains(target)) return;
            setPlaceMenuOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Anchor the portaled place-search menu to its input (see the preset menu comment).
    useLayoutEffect(() => {
        if (!placeMenuOpen) return;
        const rect = placeDropdownRef.current?.getBoundingClientRect();
        if (rect) setPlaceMenuRect({ left: rect.left, top: rect.bottom, width: rect.width });
    }, [placeMenuOpen, placeResults, placeLoading, placeErrored]);

    useEffect(() => {
        if (!placeMenuOpen) return;
        const onScroll = (e: Event) => {
            if (placeMenuRef.current?.contains(e.target as Node)) return;
            setPlaceMenuOpen(false);
        };
        const onResize = () => setPlaceMenuOpen(false);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [placeMenuOpen]);

    // Add the real boundary of a searched place as a new named area, then frame it.
    // Everything outside the searched area is forbidden by default (the intent of
    // "play inside Munich"); interior holes are carried as forbid zones by the
    // converter, which the last-wins evaluation already respects.
    const handleSelectPlace = (result: GeoPlaceResult) => {
        const groupId = Date.now().toString();
        // Continents carry a presetKey and resolve from bundled geometry; everything
        // else converts the live OSM polygon returned by the geocode proxy.
        const newBoundaries = result.presetKey ? presetToBoundaries(result.presetKey, groupId) : geoResultToBoundaries(result, groupId);

        const closeSearch = () => {
            setPlaceMenuOpen(false);
            setPlaceSearch('');
            setPlaceResults([]);
        };

        if (newBoundaries.length === 0) {
            toast.error(t('map.searchPlaceNoBoundary', { name: result.name }));
            closeSearch();
            return;
        }

        // Refuse a second area with a name already in the list: duplicates render as
        // indistinguishable rows in the priority list and stack identical polygons.
        const newName = (newBoundaries[0].name || result.name).trim();
        if (draftBoundaries.some((b) => (b.name || '').trim().toLowerCase() === newName.toLowerCase())) {
            toast.error(t('map.boundaryAlreadyAdded', { name: newName }));
            closeSearch();
            return;
        }

        const combined: BoundaryPolygon[] = [...draftBoundaries, ...newBoundaries];
        setWorldDefault('forbid');
        commitBoundaryChange(combined, { worldDefault: 'forbid' });
        setSelectedBoundaryId(groupId);
        closeSearch();

        if (mapInstance) {
            const bounds = new google.maps.LatLngBounds();
            newBoundaries.forEach((b) => b.points.forEach((p) => bounds.extend(p)));
            if (!bounds.isEmpty()) mapInstance.fitBounds(bounds);
        }
    };

    const displayBoundaries = useMemo(() => {
        const groups: { key: string; name: string; type: 'allow' | 'forbid' }[] = [];
        const seen = new Set<string>();

        draftBoundaries.forEach((b) => {
            const key = b.groupId || b.id;
            if (!seen.has(key)) {
                seen.add(key);
                groups.push({
                    key,
                    name: b.name || `Area ${groups.length + 1}`,
                    type: b.type,
                });
            }
        });
        return groups;
    }, [draftBoundaries]);

    const handleRemoveGroup = (key: string) => {
        const newBoundaries = draftBoundaries.filter((b) => b.id !== key && b.groupId !== key);
        // Removing the last allowed area while the world default is 'forbid' would
        // leave "forbid everything, allow nowhere" — an unplayable config that also
        // persists into the next game (same row on play-again). Reset to 'allow',
        // matching the "Reset areas" button.
        if (newBoundaries.length === 0 && worldDefault === 'forbid') {
            setWorldDefault('allow');
            commitBoundaryChange(newBoundaries, { worldDefault: 'allow' });
        } else {
            commitBoundaryChange(newBoundaries);
        }
        if (activeBoundaryId === key) setSelectedBoundaryId(null);
    };

    const handleToggleGroupType = (key: string) => {
        const groupItem = draftBoundaries.find((b) => b.id === key || b.groupId === key);
        const newType: 'allow' | 'forbid' = groupItem?.type === 'allow' ? 'forbid' : 'allow';

        const newBoundaries: BoundaryPolygon[] = draftBoundaries.map((b) => {
            if (b.id === key || b.groupId === key) return { ...b, type: newType };
            return b;
        });
        commitBoundaryChange(newBoundaries);
    };

    return (
        <div className="glass p-4 sm:p-6 rounded-2xl flex-1 h-fit">
            {/* use icon public/map.boundary.howto.svg as description */}
            {!hideDescription && (
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="flex flex-col items-center">
                        <p className="text-xl font-bold text-slate-200 mb-2">{t('map.boundaryTitle')}</p>
                        <MaskIcon name="map.boundary.howto" className="h-24 w-48 text-slate-400" />
                        <p className="text-xs text-slate-400 mt-2">{t('map.boundaryDescription')}</p>
                    </div>
                    <div className="flex flex-col items-center">
                        <p className="text-xl font-bold text-slate-200 mb-2">{t('map.startingPointTitle')}</p>
                        <MaskIcon name="map.startingpoint.howto" className="h-24 w-48 text-slate-400" />
                        <p className="text-xs text-slate-400 mt-2">{t('map.pegmanDescription')}</p>
                    </div>
                </div>
            )}

            <div className="mt-4 flex flex-col gap-2">
                <div className="h-[320px] min-h-[320px] sm:h-[400px] sm:min-h-[400px] w-full rounded-lg overflow-hidden border border-slate-700 relative bg-slate-800/50 flex flex-col items-center justify-center">
                    {!isLoaded || presetsLoading ? (
                        <div className="text-slate-400">{t('map.loadingPresets')}</div>
                    ) : (
                        <div ref={containerRef} className="absolute inset-0 w-full h-full">
                            <GoogleMap
                                onLoad={(m) => {
                                    m.setCenter(DEFAULT_CENTER);
                                    m.setZoom(1);
                                    setMapInstance(m);
                                }}
                                mapContainerStyle={{ width: '100%', height: '100%' }}
                                onClick={handleMapClick}
                                options={mapOptions(additionalMapOptions)}
                            >
                                {/* World-default tint: green when the rest of the world is allowed, red when forbidden. */}
                                <RectangleF
                                    bounds={{ north: 85, south: -85, east: 180, west: -180 }}
                                    options={{
                                        fillColor: worldDefault === 'allow' ? '#008000' : '#ff0000',
                                        fillOpacity: worldDefault === 'allow' ? 0 : 0.05,
                                        strokeOpacity: 0,
                                        clickable: false,
                                        zIndex: 0,
                                    }}
                                />

                                {extraMarkers?.map((m, i) => {
                                    const isHovered = m.label === hoveredCategory;
                                    return (
                                        <MarkerF
                                            key={`extra-${i}`}
                                            position={{ lat: m.lat, lng: m.lng }}
                                            title={m.label}
                                            onMouseOver={() => setHoveredLocation({ lat: m.lat, lng: m.lng })}
                                            onMouseOut={() => setHoveredLocation(null)}
                                            options={{
                                                icon: {
                                                    path: google.maps.SymbolPath.CIRCLE,
                                                    scale: isHovered ? 9 : 6,
                                                    fillColor: isHovered ? '#fde68a' : '#f59e0b',
                                                    fillOpacity: 1,
                                                    strokeColor: isHovered ? '#fde68a' : '#fde68a',
                                                    strokeWeight: isHovered ? 3 : 2,
                                                },
                                            }}
                                        />
                                    );
                                })}

                                {actualStart.startsWith('{') && (
                                    // Starting point marker with hover preview
                                    <MarkerF
                                        position={JSON.parse(actualStart)}
                                        onMouseOver={() => setHoveredLocation(JSON.parse(actualStart))}
                                        onMouseOut={() => setHoveredLocation(null)}
                                        options={{
                                            icon: {
                                                path: google.maps.SymbolPath.CIRCLE,
                                                scale: 8,
                                                fillColor: '#4f46e5',
                                                fillOpacity: 1,
                                                strokeColor: '#a4b3ff',
                                                strokeWeight: 2,
                                            },
                                        }}
                                    />
                                )}

                                {generationRadius && actualStart.startsWith('{') && (
                                    // Radius circle around the starting point for nearby category generation preview
                                    <CircleF
                                        center={JSON.parse(actualStart)}
                                        radius={generationRadius * 100}
                                        options={{
                                            fillOpacity: 0,
                                            strokeColor: '#625fff',
                                            strokeOpacity: 0.8,
                                            strokeWeight: 3,
                                            clickable: false,
                                        }}
                                    />
                                )}

                                {hoveredLocation && (
                                    // Street View preview on marker hover
                                    <OverlayViewF
                                        position={hoveredLocation}
                                        mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                                        getPixelPositionOffset={(width, height) => ({
                                            x: -(width / 2),
                                            y: -(height + 10),
                                        })}
                                    >
                                        <div className="p-1 pointer-events-none">
                                            <img src={`https://maps.googleapis.com/maps/api/streetview?size=240x120&location=${hoveredLocation.lat},${hoveredLocation.lng}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`} alt="Street View Preview" className="w-[240px] h-[120px] rounded-lg object-cover" />
                                        </div>
                                    </OverlayViewF>
                                )}

                                {draftBoundaries.map((boundary) => (
                                    <Fragment key={boundary.id}>
                                        {boundary.isComplete && boundary.points.length > 0 && (
                                            // Phase 2: show filled polygon for completed boundaries
                                            <PolygonF
                                                paths={boundary.points}
                                                onUnmount={(p) => p.setMap(null)}
                                                options={{
                                                    fillOpacity: boundary.isComplete ? 0.1 : 0,
                                                    fillColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                                                    strokeColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                                                    strokeOpacity: boundary.isComplete ? 0.6 : 0,
                                                    strokeWeight: activeBoundaryId === (boundary.groupId || boundary.id) ? 4 : 2,
                                                    clickable: false,
                                                }}
                                            />
                                        )}

                                        {boundary.points.map((point, idx) => (
                                            // Phase 1 & 2: show points with different styling based on completion and type
                                            <Fragment key={`poly-${boundary.id}-${idx}`}>
                                                <MarkerF
                                                    position={point}
                                                    options={{
                                                        clickable: false,
                                                        icon: {
                                                            path: google.maps.SymbolPath.CIRCLE,
                                                            scale: 4,
                                                            fillColor: '#ffffff',
                                                            fillOpacity: 1,
                                                            strokeColor: boundary.isComplete ? (boundary.type === 'allow' ? '#008000' : '#ff0000') : '#7a7a7a',
                                                            strokeWeight: 2,
                                                        },
                                                    }}
                                                />
                                                {isHost && (
                                                    // Clickable invisible marker on top of each point for removal (only for hosts)
                                                    <MarkerF
                                                        position={point}
                                                        onClick={() => handleRemoveBoundaryPoint(boundary.id, idx)}
                                                        options={{
                                                            clickable: true,
                                                            cursor: 'pointer',
                                                            title: t('map.clickToRemovePoint'),
                                                            zIndex: 990,
                                                            icon: {
                                                                path: google.maps.SymbolPath.CIRCLE,
                                                                scale: 9,
                                                                fillColor: '#ffffff',
                                                                fillOpacity: 0,
                                                                strokeColor: '#ffffff',
                                                                strokeOpacity: 0,
                                                                strokeWeight: 0,
                                                            },
                                                        }}
                                                    />
                                                )}
                                            </Fragment>
                                        ))}

                                        {!boundary.isComplete && boundary.points.length > 0 && (
                                            // Phase 1: show polyline and start-handle for incomplete boundaries
                                            <>
                                                <PolylineF
                                                    path={boundary.points}
                                                    onUnmount={(p) => p.setMap(null)}
                                                    options={{
                                                        strokeColor: '#7a7a7a',
                                                        strokeOpacity: 0.8,
                                                        strokeWeight: 2,
                                                        clickable: false,
                                                        zIndex: 998,
                                                    }}
                                                />
                                                <MarkerF
                                                    key={`start-handle-${boundary.id}`}
                                                    position={boundary.points[0]}
                                                    onClick={() => handleCloseBoundary(boundary.id)}
                                                    options={{
                                                        clickable: true,
                                                        title: t('map.clickToClosePolygon'),
                                                        cursor: 'pointer',
                                                        zIndex: 999,
                                                        icon: {
                                                            path: google.maps.SymbolPath.CIRCLE,
                                                            scale: 10,
                                                            fillColor: '#ffd166',
                                                            fillOpacity: 0,
                                                            strokeColor: '#fca311',
                                                            strokeOpacity: 0,
                                                            strokeWeight: 2,
                                                        },
                                                    }}
                                                />
                                            </>
                                        )}
                                    </Fragment>
                                ))}
                            </GoogleMap>
                        </div>
                    )}

                    {/* Street View coverage toggle: overlaid on the map's top-right corner, available to host and players alike since it's a local display preference, not game state. */}
                    <div className="absolute top-3 right-3 z-[5] flex items-center gap-2 glass-dark rounded-lg px-3 py-2 text-sm shadow-lg">
                        <span className="text-slate-400 text-xs">{t('map.streetViewCoverage')}</span>
                        <label className={`relative inline-flex h-7 w-14 cursor-pointer items-center rounded-full transition-colors ${showCoverage ? 'bg-indigo-600/60' : 'bg-slate-700'}`} title={t('map.toggleCoverageHint')}>
                            <input type="checkbox" role="switch" className="sr-only" checked={showCoverage} onChange={() => setShowCoverage((v) => !v)} aria-label={t('map.streetViewCoverage')} />
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${showCoverage ? 'translate-x-8' : 'translate-x-1'}`} />
                        </label>
                    </div>

                    {/* World-default toggle: only shown when the drawn areas mix zone types. When all areas share a type, the default is forced to the opposite and the toggle is hidden. Overlaid on the map's top-left corner. */}
                    {isHost && hasMixedZones && (
                        <div className="absolute top-3 left-3 z-[5] flex items-center gap-2 glass-dark rounded-lg px-3 py-2 text-sm shadow-lg">
                            <div className="flex flex-col">
                                <span className="text-slate-400 text-xs">{t('map.worldDefaultLabel')}</span>
                                <span className={`text-xs font-semibold ${worldDefault === 'allow' ? 'text-green-400' : 'text-red-400'}`}>{worldDefault === 'allow' ? t('map.allow') : t('map.forbid')}</span>
                            </div>
                            <label className={`relative inline-flex h-7 w-14 cursor-pointer items-center rounded-full transition-colors ${worldDefault === 'allow' ? 'bg-green-600/60' : 'bg-red-600/60'}`} title={t('map.worldDefaultHint')}>
                                <input type="checkbox" role="switch" className="sr-only" checked={worldDefault === 'allow'} onChange={() => handleSetWorldDefault(worldDefault === 'allow' ? 'forbid' : 'allow')} aria-label={t('map.worldDefaultLabel')} />
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${worldDefault === 'allow' ? 'translate-x-8' : 'translate-x-1'}`} />
                            </label>
                        </div>
                    )}
                </div>

                {isHost && (
                    <div className="flex flex-col gap-4 my-2">
                        <div className="flex flex-col sm:flex-row justify-between items-center w-full text-sm text-slate-400 gap-2">
                            <div className="flex gap-2 flex-wrap justify-center">
                                <button type="button" onClick={() => handleAddBoundary()} className="px-3 py-2 bg-emerald-900/60 border border-emerald-700 hover:bg-emerald-800 text-emerald-100 rounded-lg flex gap-2 items-center transition-colors">
                                    <FaPlus /> {t('map.addArea')}
                                </button>
                                <button type="button" onClick={handleUndoBoundary} disabled={boundaryHistory.length === 0} className="px-3 py-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 rounded-lg flex gap-2 items-center transition-colors disabled:opacity-50" title={boundaryHistory.length === 0 ? t('map.nothingToUndo') : t('map.undoLastChange', { count: boundaryHistory.length, limit: HISTORY_LIMIT })}>
                                    <FaUndo /> {t('map.undo')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setWorldDefault('allow');
                                        commitBoundaryChange([], { worldDefault: 'allow' });
                                        setSelectedBoundaryId(null);
                                    }}
                                    disabled={draftBoundaries.length === 0}
                                    className="px-3 py-2 bg-rose-900 border border-rose-700 hover:bg-rose-800 text-slate-200 rounded-lg flex gap-2 items-center transition-colors disabled:opacity-50"
                                >
                                    {t('map.resetAreas')}
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() =>
                                    updateGameModeInfo({
                                        starting_point: 'open-world',
                                        category_source: 'manual',
                                    })
                                }
                                disabled={actualStart === 'open-world'}
                                className="px-3 py-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 rounded-lg flex gap-2 items-center transition-colors disabled:opacity-50 disabled:bg-slate-800 disabled:border-slate-700 disabled:text-slate-500"
                            >
                                {t('map.resetStartingPoint')}
                            </button>
                        </div>

                        {/* Live place search: real OSM administrative boundaries (e.g. "Munich"). */}
                        <div className="flex flex-wrap items-center justify-start gap-3 text-sm">
                            <div ref={placeDropdownRef} className="relative w-full sm:min-w-[280px] sm:flex-1">
                                <span className="block text-xs text-slate-400 mb-1">{t('map.searchPlaceLabel')}</span>
                                <div className="w-full bg-slate-900 border border-slate-700 hover:border-slate-500 focus-within:border-indigo-500 rounded-lg flex items-center transition-colors">
                                    <span className="pl-3 text-slate-400">
                                        <FaSearchLocation size={14} />
                                    </span>
                                    <input
                                        type="text"
                                        placeholder={t('map.searchPlacePlaceholder')}
                                        value={placeSearch}
                                        onChange={(e) => {
                                            setPlaceSearch(e.target.value);
                                            setPlaceMenuOpen(true);
                                        }}
                                        onFocus={() => setPlaceMenuOpen(true)}
                                        className="w-full bg-transparent px-3 py-2 text-slate-200 outline-none placeholder:text-slate-400 text-sm"
                                    />
                                    {placeLoading && (
                                        <span className="pr-3 text-slate-400">
                                            <FaSpinner className="animate-spin" size={14} />
                                        </span>
                                    )}
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1">{t('map.searchPlaceHint')}</p>

                                {/* Results — portaled above every panel, see menuRef comment */}
                                {placeMenuOpen &&
                                    placeMenuRect &&
                                    createPortal(
                                        <div ref={placeMenuRef} style={{ left: placeMenuRect.left, top: placeMenuRect.top, width: placeMenuRect.width }} className="fixed z-[9999] pt-1">
                                            <div className="bg-slate-900 border border-white/15 rounded-lg shadow-[0_20px_40px_-14px_rgba(2,6,23,0.75)] py-1 max-h-64 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                                {placeLoading ? (
                                                    <div className="px-4 py-2 text-slate-400 text-sm flex items-center gap-2">
                                                        <FaSpinner className="animate-spin" size={12} /> {t('map.searchPlaceSearching')}
                                                    </div>
                                                ) : placeErrored ? (
                                                    <div className="px-4 py-2 text-red-400 text-sm italic">{t('map.searchPlaceError')}</div>
                                                ) : placeResults.length > 0 ? (
                                                    placeResults.map((r) => (
                                                        <div key={r.osmId} onMouseDown={(e) => e.preventDefault()} onClick={() => handleSelectPlace(r)} className="px-4 py-2 cursor-pointer text-sm transition-colors text-slate-300 hover:bg-indigo-600/50 hover:text-white">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-medium text-slate-100 truncate">{r.name}</span>
                                                                {r.type && <span className="text-[10px] uppercase tracking-wide text-slate-500 shrink-0">{r.type.replace(/_/g, ' ')}</span>}
                                                            </div>
                                                            <div className="text-[11px] text-slate-500 truncate">{r.label}</div>
                                                        </div>
                                                    ))
                                                ) : placeSearch.trim().length >= 2 ? (
                                                    <div className="px-4 py-2 text-slate-500 text-sm italic">{t('map.searchPlaceNoResults')}</div>
                                                ) : null}
                                            </div>
                                        </div>,
                                        document.body,
                                    )}
                            </div>
                        </div>

                        {/* Preset boundary dropdown — REMOVED.
                            The live place search above now returns real OSM boundaries for
                            countries, states, regions and cities, which covers every bundled
                            preset. Continents are the sole exception (OSM has no relation for
                            them); they are injected into the search results from
                            geo_bingo_presets.json via continentResults()/presetToBoundaries().
                            The preset JSON is therefore still fetched, just no longer browsable
                            as its own grouped dropdown. */}

                        {displayBoundaries.length > 0 && (
                            <div className="flex flex-col gap-2 pr-2 mt-4">
                                {displayBoundaries.map((g, index) => (
                                    <div
                                        key={g.key}
                                        draggable
                                        onDragStart={() => setDraggedIndex(index)}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                        }}
                                        onDrop={() => handleDrop(index)}
                                        className={`flex items-center justify-between p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-all ${draggedIndex === index ? 'opacity-50 scale-95 border-dashed' : ''} ${activeBoundaryId === g.key ? 'border-indigo-500 bg-indigo-900/40' : 'border-slate-700 bg-slate-800 hover:border-slate-500'}`}
                                        onClick={() => setSelectedBoundaryId(g.key)}
                                    >
                                        <div className="flex items-center gap-4">
                                            <span className="text-slate-500 cursor-grab px-1 text-lg">⋮⋮</span>
                                            <span className="text-slate-200 font-medium text-sm flex flex-col">
                                                <span>{getDisplayName(g.name)}</span>
                                                <span className="text-[10px] text-slate-500 font-normal">{index === displayBoundaries.length - 1 ? t('map.highestPriority') : index === 0 ? t('map.lowestPriority') : t('map.priority', { n: index + 1 })}</span>
                                            </span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleToggleGroupType(g.key);
                                                }}
                                                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${g.type === 'allow' ? 'bg-green-600/20 text-green-400 border border-green-700 hover:bg-green-600/40' : 'bg-red-600/20 text-red-400 border border-red-700 hover:bg-red-600/40'}`}
                                            >
                                                {g.type === 'allow' ? t('map.allow') : t('map.forbid')}
                                            </button>
                                        </div>
                                        <button
                                            title={t('map.removeBoundary')}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRemoveGroup(g.key);
                                            }}
                                            className="text-slate-500 hover:text-red-400 p-1"
                                        >
                                            <FaTimes />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
