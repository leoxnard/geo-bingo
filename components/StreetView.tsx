'use client';

/*
================================================================================
STREET VIEW COMPONENT
================================================================================
Interactive street view interface for capturing submissions.
Provides camera controls, position management, and submission recording.
Features polygon drawing for category boundaries and real-time GPS tracking.
================================================================================
*/

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import { GoogleMap, useJsApiLoader, StreetViewPanorama, Polygon } from '@react-google-maps/api';
import toast from 'react-hot-toast';
import { FaEye, FaCamera, FaInfoCircle, FaChevronLeft } from 'react-icons/fa';
import { GoMoveToStart } from 'react-icons/go';

import { supabase } from '../lib/supabase';
import { useAiVerify } from './streetview/useAiVerify';
import { useStreetViewPath } from './streetview/useStreetViewPath';
import { useSubmissionsRealtime } from './streetview/useSubmissionsRealtime';
import { FullscreenButton, ExitButton } from './utils/Elements';
import { calculateBingoCounter, getDistance } from './utils/Functions';
import { mapOptions, GOOGLE_MAPS_LIBRARIES, isLocationAllowed } from './utils/mapUtils';
import { Submission, StreetViewProps, BoundaryPolygon } from './utils/types';
import { useViewport } from './utils/useViewport';
import { GeoGuessrMetaDe, GeoGuessrMetaEn } from '../lib/categories';

const safeStartCenter = { lat: 30, lng: 10 };
const initialWorldZoom = 2.4;

const ROOMY_MAX = 90;
const ROOMY_MIN = 67;
const COMPACT_MAX = 48;
const COMPACT_MIN = 33;
const ROOMY_GAP = 12;
const COMPACT_GAP = 8;

const panoOptions = {
    addressControl: false,
    showRoadLabels: false,
    enableCloseButton: false,
    fullscreenControl: false,
    zoomControl: false,
    panControl: false,
    linksControl: false,
};

// Hilfsfunktion, um den Hint für eine Kategorie aus der Datenbank zu fischen
const getHintForCategory = (cat: string) => {
    const foundDe = GeoGuessrMetaDe?.find((item) => item.term === cat);
    if (foundDe) return foundDe.term_hint;
    const foundEn = GeoGuessrMetaEn?.find((item) => item.term === cat);
    if (foundEn) return foundEn.term_hint;
    return null;
};

export default function StreetView({ myBoard, gameId, playerId, gameMode = 'list', teamMode = 'ffa', gridSize = 3, startingPoint = 'open-world', gameBoundary = '[]', endCondition = 'timer', timeLeft, readyPlayers, players, hideMapSymbols = false, hideMiniMap = false, exclusiveMode = false, allowHints = true, aiEndGame = true, onVoteEnd }: StreetViewProps) {
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries: GOOGLE_MAPS_LIBRARIES,
    });

    const [submittingCategory, setSubmittingCategory] = useState<string | null>(null);
    const [inStreetView, setInStreetView] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [fsPanelOpen, setFsPanelOpen] = useState(true);
    const { isNarrow, isPortrait, isMobileLandscape } = useViewport();

    const [panoInstance, setPanoInstance] = useState<google.maps.StreetViewPanorama | null>(null);
    const [minimapInstance, setMinimapInstance] = useState<google.maps.Map | null>(null);
    const [mainMapInstance, setMainMapInstance] = useState<google.maps.Map | null>(null);
    const mainMapDotRef = useRef<google.maps.Marker | null>(null);

    const streetViewRef = useRef<google.maps.StreetViewPanorama | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
    const [listLayout, setListLayout] = useState<'roomy' | 'compact'>('roomy');
    const [measuredPanelWidth, setMeasuredPanelWidth] = useState<number>(0);
    const lastValidPositionRef = useRef<google.maps.LatLng | null>(null);
    const lastValidPanoRef = useRef<string | null>(null);
    const isRevertingRef = useRef(false);
    const { pathRef, recordPoint, flushNow: flushPathNow } = useStreetViewPath(playerId);

    const hasVotedToEnd = readyPlayers.includes(playerId);
    const votesNeeded = players.length;

    const { allSubmissions, setAllSubmissions, mySubmissions, otherSubmissions } = useSubmissionsRealtime({ gameId, playerId, players, teamMode });

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleVoteEndRound = async () => {
        flushPathNow();

        if (onVoteEnd) {
            onVoteEnd();
        }
    };

    const { isVerifying, aiVerificationSuccess, allCategoriesFilled, handleVerifyAndEnd: handleAiVerifyAndEnd } = useAiVerify({ gameId, myBoard, mySubmissions, setAllSubmissions });

    useEffect(() => {
        if (minimapInstance && panoInstance && !hideMiniMap) {
            const initialPos = panoInstance.getPosition();
            if (initialPos) {
                minimapInstance.setCenter(initialPos);
            }

            const fovCone = new google.maps.Marker({
                map: minimapInstance,
                position: initialPos,
                icon: {
                    path: 'M -4,0 L -10,-30 A 30,30 0 0,1 10,-30 L 4,0 Z',
                    fillColor: '#fac800',
                    fillOpacity: 0.3,
                    strokeWeight: 0,
                    scale: 1.5,
                    anchor: new google.maps.Point(0, 0),
                    rotation: panoInstance.getPov().heading,
                },
                zIndex: 99,
                clickable: false,
            });

            const fovDot = new google.maps.Marker({
                map: minimapInstance,
                position: initialPos,
                icon: {
                    path: 'M 0,0 m -5,0 a 5,5 0 1,0 10,0 a 5,5 0 1,0 -10,0',
                    fillColor: '#fac800',
                    fillOpacity: 1.0,
                    strokeColor: '#ffffff',
                    strokeWeight: 2,
                    scale: 1.5,
                    anchor: new google.maps.Point(0, 0),
                },
                zIndex: 100,
                clickable: false,
            });

            const polylines: google.maps.Polyline[] = [];

            const renderPathSegments = () => {
                if (!pathRef.current || pathRef.current.length === 0) return;

                const segments: { lat: number; lng: number }[][] = [];
                let currentSegment: { lat: number; lng: number }[] = [{ lat: pathRef.current[0].lat, lng: pathRef.current[0].lng }];

                for (let i = 1; i < pathRef.current.length; i++) {
                    const prev = pathRef.current[i - 1];
                    const curr = pathRef.current[i];

                    const dist = getDistance(prev.lat, prev.lng, curr.lat, curr.lng);

                    if (dist > 150) {
                        segments.push(currentSegment);
                        currentSegment = [{ lat: curr.lat, lng: curr.lng }];
                    } else {
                        currentSegment.push({ lat: curr.lat, lng: curr.lng });
                    }
                }
                segments.push(currentSegment);

                segments.forEach((segment, index) => {
                    if (!polylines[index]) {
                        polylines[index] = new google.maps.Polyline({
                            map: minimapInstance,
                            strokeColor: '#fac800',
                            strokeOpacity: 0.6,
                            strokeWeight: 4,
                            zIndex: 50,
                            clickable: false,
                        });
                    }
                    polylines[index].setPath(segment);
                });
            };

            renderPathSegments();

            let animationFrameId: number;

            const positionListener = panoInstance.addListener('position_changed', () => {
                const endPos = panoInstance.getPosition();
                if (!endPos) return;

                minimapInstance.panTo(endPos);

                const startPos = fovDot.getPosition() as google.maps.LatLng;

                if (animationFrameId) cancelAnimationFrame(animationFrameId);

                if (!startPos) {
                    fovCone.setPosition(endPos);
                    fovDot.setPosition(endPos);
                } else {
                    const startLat = startPos.lat();
                    const startLng = startPos.lng();
                    const endLat = endPos.lat();
                    const endLng = endPos.lng();

                    const duration = 250;
                    const startTime = performance.now();

                    const animate = (currentTime: number) => {
                        const elapsed = currentTime - startTime;
                        let progress = elapsed / duration;

                        if (progress > 1) progress = 1;

                        const ease = 1 - Math.pow(1 - progress, 3);

                        const currentLat = startLat + (endLat - startLat) * ease;
                        const currentLng = startLng + (endLng - startLng) * ease;

                        const newPos = new google.maps.LatLng(currentLat, currentLng);

                        fovCone.setPosition(newPos);
                        fovDot.setPosition(newPos);

                        if (progress < 1) {
                            animationFrameId = requestAnimationFrame(animate);
                        } else {
                            fovCone.setPosition(endPos);
                            fovDot.setPosition(endPos);
                        }
                    };

                    animationFrameId = requestAnimationFrame(animate);
                }

                renderPathSegments();
            });

            const povListener = panoInstance.addListener('pov_changed', () => {
                const pov = panoInstance.getPov();
                const currentIcon = fovCone.getIcon() as google.maps.Symbol;
                fovCone.setIcon({ ...currentIcon, rotation: pov.heading });
            });

            return () => {
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
                google.maps.event.removeListener(positionListener);
                google.maps.event.removeListener(povListener);
                fovCone.setMap(null);
                fovDot.setMap(null);
                polylines.forEach((line) => line.setMap(null));
            };
        }
    }, [minimapInstance, panoInstance, hideMiniMap]);

    useEffect(() => {
        if (mainMapInstance && panoInstance && startingPoint === 'open-world') {
            mainMapDotRef.current = new google.maps.Marker({
                map: mainMapInstance,
                icon: {
                    path: 'M 0,0 m -5,0 a 5,5 0 1,0 10,0 a 5,5 0 1,0 -10,0',
                    fillColor: '#fac800',
                    fillOpacity: 1.0,
                    strokeColor: '#ffffff',
                    strokeWeight: 2,
                    scale: 1.5,
                    anchor: new google.maps.Point(0, 0),
                },
                zIndex: 100,
                clickable: false,
                visible: !inStreetView,
            });

            const initialPos = panoInstance.getPosition();
            if (initialPos) mainMapDotRef.current.setPosition(initialPos);

            const positionListener = panoInstance.addListener('position_changed', () => {
                const currentPos = panoInstance.getPosition();
                if (currentPos && mainMapDotRef.current) {
                    mainMapDotRef.current.setPosition(currentPos);
                }
            });

            return () => {
                google.maps.event.removeListener(positionListener);
                if (mainMapDotRef.current) {
                    mainMapDotRef.current.setMap(null);
                    mainMapDotRef.current = null;
                }
            };
        }
    }, [mainMapInstance, panoInstance, startingPoint, inStreetView]);

    useEffect(() => {
        if (mainMapDotRef.current) {
            mainMapDotRef.current.setVisible(!inStreetView);
        }
    }, [inStreetView]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const fs = !!document.fullscreenElement;
            setIsFullscreen(fs);
            if (!fs) setFsPanelOpen(false);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    // sound effects for timer
    useEffect(() => {
        if (timeLeft === 61) {
            const alertSound = new Audio('/sounds/ticking.wav');
            alertSound.volume = 0.4;
            alertSound.play().catch((e) => console.log('Audio playback failed', e));
        }

        if (timeLeft === 11) {
            const tickSound = new Audio('/sounds/countdown.wav');
            tickSound.volume = 0.3;
            tickSound.play().catch((e) => console.log('Audio playback failed', e));
        }
    }, [timeLeft]);

    const additionalMapOptions = useMemo(
        () => ({
            styles: hideMapSymbols
                ? [
                    {
                        featureType: 'all',
                        elementType: 'labels.icon',
                        stylers: [{ visibility: 'off' }],
                    },
                ]
                : [],
        }),
        [hideMapSymbols],
    );

    const additionalMiniMapOptions = useMemo(
        () => ({
            styles: hideMapSymbols
                ? [
                    {
                        featureType: 'all',
                        elementType: 'labels.icon',
                        stylers: [{ visibility: 'off' }],
                    },
                ]
                : [],
            streetViewControl: false,
            gestureHandling: startingPoint === 'open-world' ? 'greedy' : 'none',
            keyboardShortcuts: false,
        }),
        [hideMapSymbols, startingPoint],
    );

    const onLoad = useCallback(
        (pano: google.maps.StreetViewPanorama) => {
            streetViewRef.current = pano;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pano.setOptions({ source: google.maps.StreetViewSource.GOOGLE } as any);

            if (startingPoint !== 'open-world') {
                const parsedStart = JSON.parse(startingPoint) as {
                    lat: number;
                    lng: number;
                };
                const googleStartingPoint = new google.maps.LatLng(parsedStart.lat, parsedStart.lng);
                pano.setPosition(googleStartingPoint);
                pano.setVisible(true);
                setInStreetView(true);
                lastValidPositionRef.current = new google.maps.LatLng(parsedStart.lat, parsedStart.lng);
            }

            pano.addListener('position_changed', () => {
                if (isRevertingRef.current) return;

                const pos = pano.getPosition();
                if (!pos) return;

                let isValidLocation = true;
                const currentLoc = { lat: pos.lat(), lng: pos.lng() };

                if (gameBoundary && gameBoundary !== '[]') {
                    isValidLocation = isLocationAllowed(currentLoc, gameBoundary);
                }

                if (isValidLocation) {
                    lastValidPositionRef.current = pos;
                    lastValidPanoRef.current = pano.getPano();

                    recordPoint(pos.lat(), pos.lng());
                } else {
                    isRevertingRef.current = true;
                    toast("You've reached the edge of the allowed area or entered a forbidden zone!");

                    if (lastValidPanoRef.current) {
                        pano.setPano(lastValidPanoRef.current);
                    } else if (lastValidPositionRef.current) {
                        pano.setPosition(lastValidPositionRef.current);
                    } else {
                        pano.setVisible(false);
                    }

                    setTimeout(() => {
                        isRevertingRef.current = false;
                    }, 200);
                }
            });

            pano.addListener('visible_changed', () => {
                const isVisible = pano.getVisible();
                setInStreetView(isVisible);
                if (!isVisible) {
                    lastValidPositionRef.current = null;
                    lastValidPanoRef.current = null;
                }
            });
        },
        [startingPoint, gameBoundary],
    );

    const onUnmount = useCallback(() => {
        if (streetViewRef.current) {
            google.maps.event.clearInstanceListeners(streetViewRef.current);
            streetViewRef.current.setVisible(false);
            streetViewRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (isNarrow) {
            setListLayout('compact');
            return;
        }

        if (!gridEl) return;

        const check = () => {
            const availableHeight = gridEl.getBoundingClientRect().height;
            if (availableHeight <= 0) return;

            const isAtLeastSm = window.innerWidth >= 640;
            const PADDING = isAtLeastSm ? 0 : 16;

            const n = myBoard.length;
            const usable = availableHeight - PADDING - Math.max(0, n - 1) * ROOMY_GAP;
            const perItemRoomy = n > 0 ? usable / n : 0;

            // Stay in roomy while each item can be at least ROOMY_MIN tall; otherwise switch to compact.
            const nextLayout: 'roomy' | 'compact' = perItemRoomy >= ROOMY_MIN ? 'roomy' : 'compact';

            setListLayout((prev) => (prev !== nextLayout ? nextLayout : prev));
        };

        check();

        const ro = new ResizeObserver(() => {
            requestAnimationFrame(check);
        });

        ro.observe(gridEl);
        window.addEventListener('resize', check);

        return () => {
            ro.disconnect();
            window.removeEventListener('resize', check);
        };
    }, [gridEl, myBoard.length, isNarrow, isPortrait]);

    useEffect(() => {
        if (!panelRef.current) return;
        const measure = () => {
            const w = panelRef.current ? panelRef.current.getBoundingClientRect().width : 0;
            setMeasuredPanelWidth(w);
        };

        // measure now and when layout changes
        measure();
        const ro = new ResizeObserver(() => requestAnimationFrame(measure));
        ro.observe(panelRef.current);
        window.addEventListener('resize', measure);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [myBoard.length, isFullscreen, fsPanelOpen]);

    const handleSubmit = async (targetCategory: string) => {
        if (!streetViewRef.current || !inStreetView) return;
        setSubmittingCategory(targetCategory);
        const position = streetViewRef.current.getPosition();
        const pov = streetViewRef.current.getPov();
        if (!position) {
            setSubmittingCategory(null);
            return;
        }

        const submissionData = {
            game_id: gameId,
            player_id: playerId,
            category: targetCategory,
            lat: position.lat(),
            lng: position.lng(),
            heading: pov.heading,
            pitch: pov.pitch,
            zoom: streetViewRef.current.getZoom() || 1,
        };

        // optimistic update
        const existingSub = mySubmissions.find((s) => s.category === targetCategory);

        const tempId = existingSub ? existingSub.id : crypto.randomUUID();
        const optimisticSub = {
            ...submissionData,
            id: tempId,
            votes: existingSub?.votes || {},
            is_valid: null,
            ai_verdict: null,
            ai_verified_hash: null,
        } as Submission;

        const updatedAllSubmissions = existingSub ? allSubmissions.map((s) => (s.id === existingSub.id ? optimisticSub : s)) : [...allSubmissions, optimisticSub];

        const updatedMySubmissions = existingSub ? mySubmissions.map((s) => (s.id === existingSub.id ? optimisticSub : s)) : [...mySubmissions, optimisticSub];

        setAllSubmissions(updatedAllSubmissions);
        setSubmittingCategory(null);

        if (gameMode === 'bingo' && endCondition === 'first_bingo') {
            const bingos = calculateBingoCounter(gridSize, myBoard, updatedMySubmissions);

            if (bingos.count > 0) {
                const winnerNames = players.filter((p) => bingos.players.includes(p.id)).map((p) => p.name);
                let winnerNamesString;
                if (winnerNames.length > 2) {
                    winnerNamesString = [winnerNames.slice(0, -1).join(', '), winnerNames.slice(-1)[0]].join(' and ');
                } else if (winnerNames.length === 2) {
                    winnerNamesString = winnerNames.join(' and ');
                } else {
                    winnerNamesString = winnerNames[0];
                }
                toast(`${winnerNamesString} got Bingo!`);
                try {
                    await supabase.from('games').update({ status: 'voting' }).eq('id', gameId);
                } catch (error) {
                    console.error('Failed to end game on Bingo:', error);
                }
            }
        }

        if (exclusiveMode && !existingSub) {
            // exclusive mode insert via RPC to ensure atomic claim
            const { data, error } = await supabase.rpc('claim_exclusive_category', {
                p_game_id: gameId,
                p_player_id: playerId,
                p_category: targetCategory,
                p_lat: submissionData.lat,
                p_lng: submissionData.lng,
                p_heading: submissionData.heading,
                p_pitch: submissionData.pitch,
                p_zoom: submissionData.zoom,
            });

            if (data && data.success === false && data.error === 'ALREADY_CLAIMED') {
                toast.error('Sorry, someone else was faster claiming this category!');
                setAllSubmissions((prev) => prev.filter((s) => s.id !== tempId));
            } else if (error) {
                console.error('RPC call failed:', error);
                toast.error('Error saving submission. Please try again.');
                setAllSubmissions((prev) => prev.filter((s) => s.id !== tempId));
            } else if (data && data.success) {
                setAllSubmissions((prev) => prev.map((s) => (s.id === tempId ? data.data : s)));
            }
        } else {
            // ffa update or insert
            if (existingSub) {
                const { error } = await supabase
                    .from('submissions')
                    .update({ ...submissionData, ai_verdict: null, ai_verified_hash: null })
                    .eq('id', existingSub.id);
                if (error) {
                    console.error('Update error:', error);
                    toast.error('Error updating submission. Please try again.');
                    setAllSubmissions((prev) => prev.filter((s) => s.id !== tempId));
                }
            } else {
                const { data, error } = await supabase.from('submissions').insert([submissionData]).select().single();
                if (error) {
                    console.error('Insert error:', error);
                    toast.error('Error saving submission. Please try again.');
                    setAllSubmissions((prev) => prev.filter((s) => s.id !== tempId));
                } else if (data) {
                    setAllSubmissions((prev) => prev.map((s) => (s.id === tempId ? data : s)));
                }
            }
        }
    };

    const jumpToLocation = (sub: Submission) => {
        if (!streetViewRef.current) return;
        streetViewRef.current.setPosition({ lat: sub.lat, lng: sub.lng });
        streetViewRef.current.setPov({ heading: sub.heading, pitch: sub.pitch });
        streetViewRef.current.setZoom(sub.zoom);
        streetViewRef.current.setVisible(true);
        setInStreetView(true);
    };

    const handleBingoTileClick = (cat: string) => {
        const isBlocked = exclusiveMode && !mySubmissions.find((s) => s.category === cat) && otherSubmissions.some((s) => s.category === cat);
        if (window.matchMedia('(max-width: 639px)').matches && !isBlocked) {
            handleSubmit(cat);
        }
    };

    const parsedStartParams = useMemo(() => {
        const polyString = gameBoundary || '[]';
        let parsedBoundaries: BoundaryPolygon[] = [];
        let polyCenter = null;
        let polyZoom = null;

        if (polyString && polyString !== '[]' && polyString !== 'null') {
            try {
                const parsed = JSON.parse(polyString);

                if (Array.isArray(parsed) && parsed.length > 0) {
                    if (parsed[0].lat !== undefined && parsed[0].id === undefined) {
                        parsedBoundaries = [{ id: 'legacy', type: 'allow', points: parsed }];
                    } else {
                        parsedBoundaries = parsed;
                    }

                    const allowBoundaries = parsedBoundaries.filter((b) => b.type !== 'forbid');
                    const boundariesToCalculate = allowBoundaries.length > 0 ? allowBoundaries : parsedBoundaries;

                    const allPoints = boundariesToCalculate.flatMap((b) => b.points || []);

                    if (allPoints.length >= 3) {
                        let minX = allPoints[0].lat,
                            maxX = allPoints[0].lat;
                        let minY = allPoints[0].lng,
                            maxY = allPoints[0].lng;
                        for (let i = 1; i < allPoints.length; i++) {
                            if (allPoints[i].lat < minX) minX = allPoints[i].lat;
                            if (allPoints[i].lat > maxX) maxX = allPoints[i].lat;
                            if (allPoints[i].lng < minY) minY = allPoints[i].lng;
                            if (allPoints[i].lng > maxY) maxY = allPoints[i].lng;
                        }
                        polyCenter = { lat: (minX + maxX) / 2, lng: (minY + maxY) / 2 };

                        const latDiff = maxX - minX;
                        const lngDiff = maxY - minY;
                        const maxDiff = Math.max(latDiff, lngDiff);
                        const calculatedZoom = maxDiff > 0 ? Math.floor(Math.log2(360 / maxDiff)) + 1 : initialWorldZoom;
                        polyZoom = Math.min(Math.max(calculatedZoom, 1), 18);
                    }
                }
            } catch (e) {
                console.error('Error parsing gameBoundary:', e);
            }
        }
        return { parsedBoundaries, polyCenter, polyZoom };
    }, [gameBoundary]);

    const { parsedBoundaries, polyCenter, polyZoom } = parsedStartParams;

    const mapCenter = useMemo(() => {
        if (startingPoint === 'open-world' && polyCenter) return polyCenter;
        return safeStartCenter;
    }, [polyCenter, startingPoint]);

    const mapZoom = useMemo(() => {
        if (startingPoint === 'open-world' && polyZoom !== null) return polyZoom;
        return 2;
    }, [polyZoom, startingPoint]);

    if (!isLoaded) return <div className="h-screen flex items-center justify-center text-indigo-400">Loading Maps...</div>;

    const getSidebarWidthClass = () => {
        if (gameMode !== 'bingo') return 'lg:w-96';
        switch (gridSize) {
        case 2:
            return 'lg:w-[400px]';
        case 3:
            return 'lg:w-[500px]';
        case 4:
            return 'lg:w-[600px]';
        case 5:
            return 'lg:w-[700px]';
        case 6:
            return 'lg:w-[800px]';
        default:
            return 'lg:w-[400px]';
        }
    };

    const getSidebarTextSizeClass = () => {
        if (gameMode !== 'bingo') return '';
        switch (gridSize) {
        case 2:
            return 'text-base sm:text-xl';
        case 3:
            return 'text-xs sm:text-xl';
        case 4:
            return 'text-[10px] sm:text-base';
        case 5:
            return 'text-[8px] sm:text-sm';
        case 6:
            return 'text-[7px] sm:text-sm';
        default:
            return 'text-xs sm:text-xl';
        }
    };

    return (
        <div className="overflow-hidden p-4 bg-slate-900 flex flex-col">
            {/* Header (portrait only) */}
            {isPortrait && (
                <div className={`flex justify-between w-full mx-auto text-white ${isNarrow ? 'flex-col gap-3 mb-3' : 'items-center mb-4'}`}>
                    <div className="flex items-stretch gap-3 sm:gap-6 w-full sm:w-auto">
                        <div className="flex items-center justify-center text-xl sm:text-3xl font-black bg-slate-800 px-3 sm:px-6 rounded-lg sm:rounded-xl border border-slate-700 shadow-lg tracking-wider py-1.5 sm:py-2">{timeLeft <= 60 ? <span className="text-red-500 animate-pulse">{formatTime(timeLeft)}</span> : <span className="text-white">{formatTime(timeLeft)}</span>}</div>

                        <div className="ml-auto flex items-stretch justify-end gap-2 sm:gap-4">
                            {aiEndGame && (
                                <button
                                    type="button"
                                    onClick={handleAiVerifyAndEnd}
                                    disabled={!allCategoriesFilled || isVerifying}
                                    title={!allCategoriesFilled ? 'Fill every category to enable AI verification' : 'Verify all categories with AI and end the round'}
                                    className={`flex items-center justify-center whitespace-nowrap px-3 sm:px-6 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-sm shadow-lg
                                        ${!allCategoriesFilled || isVerifying ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                                >
                                    {isVerifying ? 'Verifying...' : 'AI Verify & End'}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={handleVoteEndRound}
                                disabled={hasVotedToEnd}
                                className={`flex flex-col items-center justify-center whitespace-nowrap px-3 sm:px-6 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-sm shadow-lg leading-tight text-center min-w-[7rem] border-2
                                            ${aiVerificationSuccess ? 'border-green-500' : 'border-transparent'}
                                    ${hasVotedToEnd ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500 text-white'}`}
                            >
                                <span>{hasVotedToEnd ? 'Wait...' : 'End Vote'}</span>
                                <span className="text-[9px] sm:text-xs normal-case opacity-80">
                                    {readyPlayers.length} / {votesNeeded} voted
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="w-full mx-auto shrink-0">
                {playerId && (
                    <div className={`flex gap-4 ${isMobileLandscape ? 'flex-row h-[calc(100dvh-2rem)] min-h-0' : isPortrait ? 'flex-col h-[calc(100dvh-6rem)] min-h-0' : 'flex-col lg:flex-row h-[calc(100dvh-2rem)] min-h-0'}`}>
                        {/* Left: Map */}
                        <div ref={containerRef} className={`${isMobileLandscape ? 'basis-[58%] min-h-0 h-full' : isPortrait ? 'flex-[1.2] min-h-[48svh] h-full' : 'flex-1 h-full'} border-2 border-slate-700 rounded-2xl overflow-hidden shadow-2xl relative bg-slate-800 absolute-safari-fix`}>
                            <GoogleMap key={gameId} mapContainerClassName="google-map-container absolute inset-0" center={mapCenter} zoom={mapZoom} options={mapOptions(additionalMapOptions)} onLoad={(map) => setMainMapInstance(map)} onUnmount={() => setMainMapInstance(null)}>
                                {parsedBoundaries.map(
                                    (boundary, index) =>
                                        boundary.points &&
                                        boundary.points.length >= 3 && (
                                            <Polygon
                                                key={boundary.id || `poly-${index}`}
                                                paths={boundary.points}
                                                options={{
                                                    fillColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                                                    fillOpacity: 0.1,
                                                    strokeColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                                                    strokeOpacity: 0.6,
                                                    strokeWeight: 2,
                                                    clickable: false,
                                                    geodesic: true,
                                                }}
                                            />
                                        ),
                                )}

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
                                <div style={{ transform: isFullscreen && fsPanelOpen ? `translateX(${measuredPanelWidth}px)` : undefined }} className={`absolute ${isNarrow ? 'w-20 h-20 bottom-1 left-1 hover:w-28 hover:h-28' : 'w-28 h-28 bottom-6 left-6 hover:w-44 hover:h-44'} z-[500] rounded-xl overflow-hidden border-2 border-indigo-500 shadow-[0_0_20px_rgba(79,70,229,0.5)] transition-all duration-300 minimap-wrapper`}>
                                    <style>{`.minimap-wrapper .gmnoprint { display: none !important; }`}</style>
                                    <GoogleMap mapContainerClassName="w-full h-full" onLoad={(map) => setMinimapInstance(map)} onUnmount={() => setMinimapInstance(null)} center={lastValidPositionRef.current || mapCenter} zoom={isNarrow ? 14 : 16} options={mapOptions(additionalMiniMapOptions)} />
                                    {startingPoint !== 'open-world' && <div className="absolute inset-0 z-50 bg-transparent"></div>}
                                </div>
                            )}

                            {!isMobileLandscape && <FullscreenButton isFullscreen={isFullscreen} containerRef={containerRef} setIsFullscreen={setIsFullscreen} />}

                            {isFullscreen && (
                                <div ref={panelRef} className={`absolute top-0 left-0 bottom-0 z-4 h-full bg-slate-900/40 backdrop-blur-md border-r border-white/10 transition-transform duration-300 ease-out ${fsPanelOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                                    <ul className={`h-full inline-grid grid-cols-1 auto-rows-min p-1 gap-1.5 overflow-y-auto ${fsPanelOpen ? '' : 'pointer-events-none'}`}>
                                        {myBoard.map((cat) => {
                                            const foundSub = mySubmissions.find((s) => s.category === cat);
                                            const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some((s) => s.category === cat);
                                            const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
                                            const fov = foundSub?.zoom ? 180 / Math.pow(2, foundSub.zoom) : 90;
                                            const hint = allowHints ? getHintForCategory(cat) : null;
                                            const isDisabled = submittingCategory === cat || !inStreetView || isBlocked;

                                            let streetViewImageUrl = '';
                                            if (foundSub) {
                                                let safeHeading = foundSub.heading % 360;
                                                if (safeHeading < 0) safeHeading += 360;
                                                streetViewImageUrl = `https://maps.googleapis.com/maps/api/streetview?size=600x600&location=${foundSub.lat},${foundSub.lng}&heading=${foundSub.heading}&pitch=${foundSub.pitch}&fov=${fov}&key=${apiKey}`;
                                            }

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
                                                    className={`relative p-1 whitespace-nowrap flex items-center justify-center w-full rounded-xl border transition-colors ${foundSub ? 'shadow-md border-slate-600' : isBlocked ? 'bg-slate-900 border-red-500 opacity-60' : 'bg-slate-800 border-slate-600 hover:bg-slate-700/30'} ${foundSub?.ai_verdict === false ? ' !border-red-500' : foundSub?.ai_verdict === true ? ' !border-green-500' : ''} ${!foundSub && !isBlocked && inStreetView ? 'cursor-pointer' : ''} ${isDisabled ? 'opacity-70' : ''}`}
                                                >
                                                    <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                                                        {foundSub && <img src={streetViewImageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
                                                        {foundSub && <div className="absolute inset-0 bg-black/50 z-0"></div>}
                                                    </div>
                                                    <div className={`relative z-10 font-bold text-center ${foundSub ? 'text-white' : isBlocked ? 'text-red-400' : 'text-slate-300'} ${getSidebarTextSizeClass()}`}>
                                                        {cat}
                                                        {hint && (
                                                            <div className="mt-1 text-xs text-slate-400 font-normal">
                                                                Hint: <em>{hint}</em>
                                                            </div>
                                                        )}
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <button type="button" onClick={() => setFsPanelOpen((open) => !open)} className="absolute top-1/2 left-full -translate-y-1/2 -ml-px w-5 h-14 rounded-r-lg bg-slate-900/40 backdrop-blur-md border border-l-0 border-white/10 text-white shadow-md flex items-center justify-center" title={fsPanelOpen ? 'Hide categories' : 'Show categories'}>
                                        <FaChevronLeft className={`transition-transform duration-300 ${fsPanelOpen ? '' : 'rotate-180'}`} size={11} />
                                    </button>
                                </div>
                            )}

                            {inStreetView && startingPoint === 'open-world' && (
                                <div style={isFullscreen && fsPanelOpen ? { transform: `translateX(${measuredPanelWidth}px)` } : undefined} className="absolute top-2 left-2 z-50">
                                    <ExitButton onExit={() => streetViewRef.current?.setVisible(false)} />
                                </div>
                            )}
                            {startingPoint !== 'open-world' && (
                                <button
                                    type="button"
                                    onClick={() => streetViewRef.current?.setPosition(new google.maps.LatLng(startingPoint ? JSON.parse(startingPoint) : safeStartCenter))}
                                    className="absolute top-2 left-2 z-5 hidden sm:flex w-12 h-12 bg-slate-800/30 hover:bg-slate-700/80 text-white text-[30px] items-center justify-center rounded-md shadow-[0_0_15px_rgba(0,0,0,0.4)] border border-slate-500 font-bold transition-transform hover:scale-105 active:scale-95 backdrop-blur-sm"
                                    title="Return to Starting Point"
                                >
                                    <GoMoveToStart />
                                </button>
                            )}
                        </div>

                        {/* Right: Checklist */}
                        <div className={`${isMobileLandscape ? 'basis-[42%] max-w-[42%]' : `w-full ${getSidebarWidthClass()}`} flex flex-col gap-4 bg-slate-800 sm:p-6 rounded-2xl shadow-xl h-full min-h-0 border border-2 border-slate-700 overflow-hidden transition-all`}>
                            {!isPortrait && (
                                <div className="flex items-stretch gap-2 sm:gap-4 pb-3 border-b border-slate-700">
                                    <div className="flex items-center justify-center text-base sm:text-2xl font-black bg-slate-700 px-3 sm:px-4 rounded-lg border border-slate-600 shadow-lg tracking-wider py-1.5 sm:py-2">{timeLeft <= 60 ? <span className="text-red-500 animate-pulse">{formatTime(timeLeft)}</span> : <span className="text-white">{formatTime(timeLeft)}</span>}</div>

                                    <div className="ml-auto flex items-stretch justify-end gap-2">
                                        {aiEndGame && (
                                            <button
                                                type="button"
                                                onClick={handleAiVerifyAndEnd}
                                                disabled={!allCategoriesFilled || isVerifying}
                                                title={!allCategoriesFilled ? 'Fill every category to enable AI verification' : 'Verify all categories with AI and end the round'}
                                                className={`flex flex-col items-center justify-center whitespace-nowrap px-3 sm:px-4 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-xs shadow-lg leading-tight text-center min-w-[6.5rem]
                                                        ${!allCategoriesFilled || isVerifying ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                                            >
                                                <span>{isVerifying ? 'Verifying...' : 'Verify & End'}</span>
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={handleVoteEndRound}
                                            disabled={hasVotedToEnd}
                                            className={`flex flex-col items-center justify-center whitespace-nowrap px-3 sm:px-4 rounded-lg font-bold transition-all uppercase text-[10px] sm:text-xs shadow-lg leading-tight text-center min-w-[6.5rem] border-2
                                                ${aiVerificationSuccess ? 'border-green-500' : 'border-transparent'}
                                                ${hasVotedToEnd ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500 text-white'}`}
                                        >
                                            <span>{hasVotedToEnd ? 'Wait...' : 'End Vote'}</span>
                                            <span className="text-[9px] sm:text-[10px] normal-case opacity-80">
                                                {readyPlayers.length} / {votesNeeded} voted
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between items-center hidden sm:flex mb-2">
                                <h2 className="text-indigo-400 font-bold text-xl tracking-wide uppercase">{gameMode === 'bingo' ? 'Bingo Board' : 'Checklist'}</h2>
                                <span className="bg-slate-700 text-slate-300 font-bold px-3 py-1 rounded-full text-sm">
                                    {mySubmissions.length} / {myBoard.length}
                                </span>
                            </div>

                            {gameMode === 'list' ? (
                                <div ref={setGridEl} className="flex flex-1 min-h-0 flex-col overflow-hidden">
                                    {listLayout === 'compact' ? (
                                        // Compact List View
                                        <ul className="flex flex-col flex-1 min-h-0 overflow-y-auto p-2 sm:p-0" style={{ gap: COMPACT_GAP }}>
                                            {myBoard.map((cat) => {
                                                const foundSub = mySubmissions.find((s) => s.category === cat);
                                                const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some((s) => s.category === cat);
                                                const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
                                                const fov = foundSub?.zoom ? 180 / Math.pow(2, foundSub.zoom) : 90;
                                                const hint = allowHints ? getHintForCategory(cat) : null;

                                                let streetViewImageUrl = '';
                                                if (foundSub) {
                                                    let safeHeading = foundSub.heading % 360;
                                                    if (safeHeading < 0) safeHeading += 360;
                                                    streetViewImageUrl = `https://maps.googleapis.com/maps/api/streetview?size=600x600&location=${foundSub.lat},${foundSub.lng}&heading=${safeHeading}&pitch=${foundSub.pitch}&fov=${fov}&key=${apiKey}`;
                                                }

                                                return (
                                                    <li
                                                        key={cat}
                                                        style={{ minHeight: COMPACT_MIN, maxHeight: COMPACT_MAX }}
                                                        className={`relative p-1.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 flex-1 w-full ${foundSub ? 'shadow-md border-slate-600' : isBlocked ? 'bg-slate-900 border-red-500 opacity-60' : 'bg-slate-800 border-slate-600 hover:bg-slate-700/30'} ${foundSub?.ai_verdict === false ? '!border-red-500' : foundSub?.ai_verdict === true ? '!border-green-500' : ''}`}
                                                    >
                                                        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                                                            {foundSub && <img src={streetViewImageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
                                                            {foundSub && <div className="absolute inset-0 bg-black/50 z-0"></div>}
                                                        </div>

                                                        <div className="relative z-10 flex items-center justify-between w-full h-full gap-1.5 min-w-0">
                                                            <div className="flex items-center flex-1 min-w-0 gap-1 h-full">
                                                                <span className={`text-xs leading-tight truncate font-medium px-1 ${foundSub ? 'text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : isBlocked ? 'text-red-400 line-through' : 'text-white'}`}>{cat}</span>
                                                                {hint && (
                                                                    <div className="relative group flex-shrink-0 cursor-help" onClick={(e) => e.stopPropagation()}>
                                                                        <FaInfoCircle className={`transition-colors ${foundSub ? 'text-white/70 hover:text-white' : 'text-slate-400 hover:text-white'}`} size={12} />
                                                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-max max-w-[200px] bg-slate-800 text-white text-xs p-2 rounded-lg shadow-xl border border-slate-600 z-[100] whitespace-normal text-center cursor-default">
                                                                            <span className="font-bold text-indigo-300">Tipp:</span> {hint}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-1 h-full">
                                                                {!foundSub ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleSubmit(cat);
                                                                        }}
                                                                        disabled={submittingCategory === cat || !inStreetView || isBlocked}
                                                                        className={`h-full px-4 py-1 text-[8px] font-bold rounded-lg shadow uppercase transition-all whitespace-nowrap ${isBlocked ? 'bg-red-900/50 text-red-300 cursor-not-allowed' : !inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600/30 hover:bg-green-500/30 text-white'}`}
                                                                    >
                                                                        {submittingCategory === cat ? 'Saving...' : isBlocked ? 'Claimed' : !inStreetView ? 'Enter Streetview' : 'Save'}
                                                                    </button>
                                                                ) : (
                                                                    <>
                                                                        {!exclusiveMode && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleSubmit(cat);
                                                                                }}
                                                                                disabled={submittingCategory === cat || !inStreetView}
                                                                                className={`px-2 py-1 text-[7px] font-bold rounded-lg shadow uppercase transition-all whitespace-nowrap ${!inStreetView ? 'bg-slate-600/30 text-slate-300 cursor-not-allowed' : 'bg-amber-700/40 hover:bg-amber-600/40 text-white'}`}
                                                                            >
                                                                                {submittingCategory === cat ? '...' : !inStreetView ? 'Enter Streetview' : 'Overwrite'}
                                                                            </button>
                                                                        )}
                                                                        {startingPoint === 'open-world' && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    jumpToLocation(foundSub);
                                                                                }}
                                                                                className={`${exclusiveMode ? 'flex-1' : 'flex-[0.5]'} bg-slate-700/40 hover:bg-slate-500/30 px-2 py-1 text-[7px] text-white font-bold rounded-lg shadow uppercase transition-all whitespace-nowrap`}
                                                                            >
                                                                                View
                                                                            </button>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    ) : (
                                        // Regular View
                                        <ul className="flex flex-col flex-1 min-h-0 overflow-y-auto p-2 sm:p-0" style={{ gap: ROOMY_GAP }}>
                                            {myBoard.map((cat) => {
                                                const foundSub = mySubmissions.find((s) => s.category === cat);
                                                const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some((s) => s.category === cat);
                                                const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
                                                const fov = foundSub?.zoom ? 180 / Math.pow(2, foundSub.zoom) : 90;
                                                const hint = allowHints ? getHintForCategory(cat) : null;

                                                let streetViewImageUrl = '';
                                                if (foundSub) {
                                                    let safeHeading = foundSub.heading % 360;
                                                    if (safeHeading < 0) safeHeading += 360;
                                                    streetViewImageUrl = `https://maps.googleapis.com/maps/api/streetview?size=600x600&location=${foundSub.lat},${foundSub.lng}&heading=${safeHeading}&pitch=${foundSub.pitch}&fov=${fov}&key=${apiKey}`;
                                                }

                                                return (
                                                    <li
                                                        key={cat}
                                                        style={{ minHeight: ROOMY_MIN, maxHeight: ROOMY_MAX }}
                                                        className={`relative p-2 rounded-xl border transition-all cursor-pointer flex flex-col justify-between flex-1 w-full ${foundSub ? 'shadow-md border-slate-600' : isBlocked ? 'bg-slate-900 border-red-500 opacity-60' : 'bg-slate-800 border-slate-600 hover:bg-slate-700/30'} ${foundSub?.ai_verdict === false ? '!border-red-500' : foundSub?.ai_verdict === true ? '!border-green-500' : ''}`}
                                                    >
                                                        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                                                            {foundSub && <img src={streetViewImageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
                                                            {foundSub && <div className="absolute inset-0 bg-black/50 z-0"></div>}
                                                        </div>

                                                        {/* TOP PART */}
                                                        <div className="relative z-10 flex flex-col w-full">
                                                            <div className="flex justify-between items-start w-full gap-1">
                                                                <div className="flex items-center flex-1 min-w-0">
                                                                    <span className={`text-sm truncate font-medium pb-1 ${foundSub ? 'text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : isBlocked ? 'text-red-400 line-through' : 'text-white'}`}>{cat}</span>
                                                                    {hint && (
                                                                        <div className="ml-1.5 relative group flex-shrink-0 cursor-help" onClick={(e) => e.stopPropagation()}>
                                                                            <FaInfoCircle className={`transition-colors ${foundSub ? 'text-white/70 hover:text-white' : 'text-slate-400 hover:text-white'}`} size={12} />
                                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-max max-w-[200px] bg-slate-800 text-white text-xs p-2 rounded-lg shadow-xl border border-slate-600 z-[100] whitespace-normal text-center cursor-default">
                                                                                <span className="font-bold text-indigo-300">Tipp:</span> {hint}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <span className={`text-[10px] font-bold uppercase whitespace-nowrap flex-shrink-0 ${foundSub?.ai_verdict === false ? 'text-red-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : foundSub ? 'text-green-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : isBlocked ? 'text-red-500' : 'text-slate-500'}`}>
                                                                    {foundSub?.ai_verdict === false ? 'AI verification failed' : foundSub?.ai_verdict === true ? 'AI verified' : foundSub ? 'Found' : isBlocked ? 'Locked' : 'Pending'}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="relative z-10 flex justify-between items-center gap-1 mt-auto w-full">
                                                            {!foundSub ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleSubmit(cat);
                                                                    }}
                                                                    disabled={submittingCategory === cat || !inStreetView || isBlocked}
                                                                    className={`flex-1 text-[10px] px-2 py-1.5 font-bold rounded-lg shadow uppercase transition-all ${isBlocked ? 'bg-red-900/50 text-red-300 cursor-not-allowed' : !inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600/30 hover:bg-green-500/30 text-white'}`}
                                                                >
                                                                    {submittingCategory === cat ? 'Saving...' : isBlocked ? 'Claimed' : !inStreetView ? 'Enter Streetview' : 'Save'}
                                                                </button>
                                                            ) : (
                                                                <>
                                                                    {!exclusiveMode && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleSubmit(cat);
                                                                            }}
                                                                            disabled={submittingCategory === cat || !inStreetView}
                                                                            className={`flex-1 text-[9px] px-2 py-1.5 font-bold rounded-lg shadow uppercase transition-all ${!inStreetView ? 'bg-slate-600/30 text-slate-300 cursor-not-allowed' : 'bg-amber-700/40 hover:bg-amber-600/40 text-white'}`}
                                                                        >
                                                                            {submittingCategory === cat ? '...' : !inStreetView ? 'Enter Streetview' : 'Overwrite'}
                                                                        </button>
                                                                    )}
                                                                    {startingPoint === 'open-world' && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                jumpToLocation(foundSub);
                                                                            }}
                                                                            className={`${exclusiveMode ? 'flex-1' : 'flex-[0.5]'} bg-slate-700/40 hover:bg-slate-500/30 text-[9px] px-2 py-1.5 text-white font-bold rounded-lg shadow uppercase transition-all`}
                                                                        >
                                                                            View
                                                                        </button>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>
                            ) : (
                                <div className={`grid gap-2 flex-1 min-h-0 overflow-y-auto pr-1 auto-rows-fr bingo-grid-${gridSize}`}>
                                    {/* Bingo Mode Grid View */}
                                    {myBoard.map((cat) => {
                                        const foundSub = mySubmissions.find((s) => s.category === cat);
                                        const isBlocked = exclusiveMode && !foundSub && otherSubmissions.some((s) => s.category === cat);
                                        const hint = allowHints ? getHintForCategory(cat) : null;

                                        const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
                                        const fov = foundSub?.zoom ? 180 / Math.pow(2, foundSub.zoom) : 90;
                                        const streetViewImageUrl = foundSub ? `https://maps.googleapis.com/maps/api/streetview?size=400x400&location=${foundSub.lat},${foundSub.lng}&heading=${foundSub.heading}&pitch=${foundSub.pitch}&fov=${fov}&key=${apiKey}` : '';

                                        return (
                                            <div
                                                key={cat}
                                                title={isBlocked ? 'Claimed by another team' : foundSub?.ai_verdict === false ? 'AI could not verify this category' : foundSub?.ai_verdict === true ? 'AI verified ✓' : undefined}
                                                onClick={() => handleBingoTileClick(cat)}
                                                className={`relative p-2 rounded-xl border transition-all cursor-pointer flex flex-col justify-center items-center text-center pb-2 sm:pb-12 ${foundSub ? 'text-white border-green-500 shadow-md' : isBlocked ? 'bg-slate-900/80 border-red-500 opacity-60' : 'bg-slate-800 border-slate-600 hover:bg-slate-700'} ${foundSub?.ai_verdict === false ? '!border-red-500' : foundSub?.ai_verdict === true ? '!border-green-500' : ''}`}
                                            >
                                                {/* Background Layer */}
                                                <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                                                    {foundSub && <img src={streetViewImageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
                                                    {foundSub && <div className="absolute inset-0 bg-black/50 z-0"></div>}
                                                </div>

                                                {hint && (
                                                    <div className="absolute top-1 right-1 sm:top-2 sm:right-2 z-[60] group cursor-help" onClick={(e) => e.stopPropagation()}>
                                                        <FaInfoCircle className={`transition-colors text-[11px] sm:text-sm drop-shadow-md ${foundSub ? 'text-white/70 hover:text-white' : 'text-slate-400/70 hover:text-white'}`} />
                                                        <div className="absolute bottom-full right-0 sm:left-1/2 sm:-translate-x-1/2 mb-1 sm:mb-2 hidden group-hover:block w-max max-w-[150px] sm:max-w-[200px] bg-slate-800 text-white text-[10px] sm:text-xs p-2 rounded-lg shadow-xl border border-slate-600 z-[100] whitespace-normal text-left sm:text-center cursor-default">
                                                            <span className="font-bold text-indigo-300">Tipp:</span> {hint}
                                                        </div>
                                                    </div>
                                                )}

                                                <span className={`relative z-10 ${getSidebarTextSizeClass()} font-bold leading-tight line-clamp-3 [hyphens:auto] [word-break:break-word] mt-0 sm:mt-1 ${foundSub ? 'drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)]' : isBlocked ? 'text-red-400 line-through' : 'text-white'}`}>{cat}</span>

                                                <div className="absolute bottom-2 w-[90%] left-[5%] h-[25%] max-h-12 hidden sm:flex flex-row justify-center gap-2 z-10">
                                                    {!foundSub ? (
                                                        <button
                                                            type="button"
                                                            title={isBlocked ? 'Claimed by another team' : 'Add submission'}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleSubmit(cat);
                                                            }}
                                                            disabled={submittingCategory === cat || !inStreetView || isBlocked}
                                                            className={`w-full h-full font-bold rounded-lg uppercase transition-all flex justify-center items-center ${isBlocked ? 'bg-red-900/50 text-red-500 cursor-not-allowed' : !inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-green-600/30 hover:bg-green-500/30 text-white'}`}
                                                        >
                                                            {submittingCategory === cat ? '...' : <FaCamera className="h-[60%] w-auto" />}
                                                        </button>
                                                    ) : (
                                                        <>
                                                            <button
                                                                type="button"
                                                                title="Overwrite submission"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleSubmit(cat);
                                                                }}
                                                                disabled={submittingCategory === cat || !inStreetView}
                                                                className={`flex-1 h-full font-bold rounded-lg uppercase transition-all flex justify-center items-center ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-amber-700/40 hover:bg-amber-600/40 text-white'}`}
                                                            >
                                                                {submittingCategory === cat ? '...' : <FaCamera className="h-[60%] w-auto" />}
                                                            </button>
                                                            {startingPoint === 'open-world' && (
                                                                <button
                                                                    type="button"
                                                                    title="View submission"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        jumpToLocation(foundSub);
                                                                    }}
                                                                    className="hidden sm:flex flex-1 h-full bg-slate-600/30 hover:bg-slate-500/30 text-white font-bold rounded-lg uppercase justify-center items-center"
                                                                >
                                                                    <FaEye className="h-[60%] w-auto" />
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
