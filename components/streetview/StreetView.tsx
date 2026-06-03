'use client';

/*
================================================================================
STREET VIEW COMPONENT
================================================================================
Interactive street view interface for capturing submissions.
Provides camera controls, position management, and submission recording.
Features polygon drawing for category boundaries and real-time GPS tracking.

This is the container: it owns all map instances, refs, effects and handlers,
and composes the presentational pieces (RoundControls, StreetViewMapPanel,
StreetViewSidebar). The visual chunks live in sibling files in this folder.
================================================================================
*/

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import { useJsApiLoader } from '@react-google-maps/api';
import toast from 'react-hot-toast';

import { useT } from '@/lib/i18n/I18nProvider';

import RoundControls from './RoundControls';
import { initialWorldZoom, ROOMY_GAP, ROOMY_MIN, safeStartCenter } from './streetViewHelpers';
import StreetViewMapPanel from './StreetViewMapPanel';
import StreetViewSidebar from './StreetViewSidebar';
import { useAiVerify } from './useAiVerify';
import { useStreetViewPath } from './useStreetViewPath';
import { useSubmissionsRealtime } from './useSubmissionsRealtime';
import { supabase } from '../../lib/supabase';
import { calculateBingoCounter, getBingoLineSubmissions, getDistance } from '../utils/Functions';
import { GOOGLE_MAPS_LIBRARIES, isLocationAllowed } from '../utils/mapUtils';
import { Submission, StreetViewProps, BoundaryPolygon } from '../utils/types';
import { useViewport } from '../utils/useViewport';

export default function StreetView({ myBoard, gameId, playerId, gameMode = 'list', teamMode = 'ffa', gridSize = 3, startingPoint = 'open-world', gameBoundary = '[]', endCondition = 'timer', timeLeft, readyPlayers, players, hideMapSymbols = false, hideMiniMap = false, exclusiveMode = false, allowHints = true, aiEndGame = true, onVoteEnd, notifyGameEvent }: StreetViewProps) {
    const { t } = useT();
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

    const handleVoteEndRound = async () => {
        flushPathNow();

        if (onVoteEnd) {
            onVoteEnd();
        }
    };

    const { isVerifying, aiVerificationSuccess, allCategoriesFilled, handleVerifyAndEnd: handleAiVerifyAndEnd, handleVerifyBingoAndEnd, handleVerifyOne, verifyingIds } = useAiVerify({ gameId, playerId, myBoard, mySubmissions, setAllSubmissions, notifyGameEvent });

    const isBingoFirstWithAi = gameMode === 'bingo' && endCondition === 'first_bingo' && aiEndGame;

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
                    toast(t('sv.toastEdgeOfArea'));

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

        let savedSub: Submission | null = null;

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
                toast.error(t('sv.toastClaimedFaster'));
                setAllSubmissions((prev) => prev.filter((s) => s.id !== tempId));
                return;
            } else if (error) {
                console.error('RPC call failed:', error);
                toast.error(t('sv.toastErrorSaving'));
                setAllSubmissions((prev) => prev.filter((s) => s.id !== tempId));
                return;
            } else if (data && data.success) {
                savedSub = data.data as Submission;
                setAllSubmissions((prev) => prev.map((s) => (s.id === tempId ? data.data : s)));
            }
        } else {
            // ffa insert-or-update via claim_category upsert: a re-take at a new
            // camera angle patches the existing row and clears the cached AI verdict.
            const { data, error } = await supabase.rpc('claim_category', {
                p_game_id: gameId,
                p_player_id: playerId,
                p_category: targetCategory,
                p_lat: submissionData.lat,
                p_lng: submissionData.lng,
                p_heading: submissionData.heading,
                p_pitch: submissionData.pitch,
                p_zoom: submissionData.zoom,
            });

            if (error || (data && data.success === false)) {
                console.error('claim_category failed:', error || data.error);
                toast.error(t('sv.toastErrorSaving'));
                setAllSubmissions((prev) => (existingSub ? prev : prev.filter((s) => s.id !== tempId)));
                return;
            } else if (data && data.success) {
                savedSub = data.data as Submission;
                setAllSubmissions((prev) => prev.map((s) => (s.id === tempId ? data.data : s)));
            }
        }

        if (!savedSub) return;

        if (gameMode === 'bingo' && endCondition === 'first_bingo') {
            // Use the persisted submission (real id + DB-side ai_verdict reset on
            // retake) so subsequent AI-verify calls reference the actual row.
            const finalMySubs = updatedMySubmissions.map((s) => (s.id === tempId ? savedSub! : s));
            const bingos = calculateBingoCounter(gridSize, myBoard, finalMySubs);
            if (bingos.count === 0) return;

            if (aiEndGame) {
                // Auto-verify the cells of any clean bingo line(s). The helper
                // already skips lines containing an AI-rejected cell, so a stale
                // rejection in one line never blocks verification of a separate
                // clean bingo. Cached `passed=true` cells hit the verify cache —
                // only new/cleared cells actually hit Gemini.
                const bingoLineSubs = getBingoLineSubmissions(gridSize, myBoard, finalMySubs);
                if (bingoLineSubs.length === 0) return;
                await handleVerifyBingoAndEnd(bingoLineSubs);
            } else {
                const winnerNames = players.filter((p) => bingos.players.includes(p.id)).map((p) => p.name);
                let winnerNamesString;
                if (winnerNames.length > 2) {
                    winnerNamesString = [winnerNames.slice(0, -1).join(', '), winnerNames.slice(-1)[0]].join(' and ');
                } else if (winnerNames.length === 2) {
                    winnerNamesString = winnerNames.join(` ${t('sv.and')} `);
                } else {
                    winnerNamesString = winnerNames[0];
                }
                toast(t('sv.gotBingo', { names: winnerNamesString }));
                try {
                    await supabase.rpc('player_end_round', { p_game_id: gameId, p_player_id: playerId });
                } catch (error) {
                    console.error('Failed to end game on Bingo:', error);
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

    const sidebarWidthClass = getSidebarWidthClass();
    const sidebarTextSizeClass = getSidebarTextSizeClass();
    const minimapCenter = lastValidPositionRef.current || mapCenter;

    return (
        <div className="overflow-hidden p-4 bg-slate-900 flex flex-col">
            {/* Header (portrait only) */}
            {isPortrait && <RoundControls variant="portrait" isNarrow={isNarrow} timeLeft={timeLeft} aiEndGame={aiEndGame} isBingoFirstWithAi={isBingoFirstWithAi} handleAiVerifyAndEnd={handleAiVerifyAndEnd} allCategoriesFilled={allCategoriesFilled} isVerifying={isVerifying} handleVoteEndRound={handleVoteEndRound} hasVotedToEnd={hasVotedToEnd} aiVerificationSuccess={aiVerificationSuccess} readyPlayers={readyPlayers} votesNeeded={votesNeeded} />}

            <div className="w-full mx-auto shrink-0">
                {playerId && (
                    <div className={`flex gap-4 ${isMobileLandscape ? 'flex-row h-[calc(100dvh-2rem)] min-h-0' : isPortrait ? 'flex-col h-[calc(100dvh-6rem)] min-h-0' : 'flex-col lg:flex-row h-[calc(100dvh-2rem)] min-h-0'}`}>
                        {/* Left: Map */}
                        <StreetViewMapPanel
                            containerRef={containerRef}
                            panelRef={panelRef}
                            streetViewRef={streetViewRef}
                            minimapCenter={minimapCenter}
                            isMobileLandscape={isMobileLandscape}
                            isPortrait={isPortrait}
                            isNarrow={isNarrow}
                            gameId={gameId}
                            mapCenter={mapCenter}
                            mapZoom={mapZoom}
                            additionalMapOptions={additionalMapOptions}
                            additionalMiniMapOptions={additionalMiniMapOptions}
                            parsedBoundaries={parsedBoundaries}
                            setMainMapInstance={setMainMapInstance}
                            setMinimapInstance={setMinimapInstance}
                            setPanoInstance={setPanoInstance}
                            onLoad={onLoad}
                            onUnmount={onUnmount}
                            inStreetView={inStreetView}
                            hideMiniMap={hideMiniMap}
                            isFullscreen={isFullscreen}
                            fsPanelOpen={fsPanelOpen}
                            setFsPanelOpen={setFsPanelOpen}
                            setIsFullscreen={setIsFullscreen}
                            measuredPanelWidth={measuredPanelWidth}
                            startingPoint={startingPoint}
                            myBoard={myBoard}
                            mySubmissions={mySubmissions}
                            otherSubmissions={otherSubmissions}
                            exclusiveMode={exclusiveMode}
                            allowHints={allowHints}
                            submittingCategory={submittingCategory}
                            textSizeClass={sidebarTextSizeClass}
                            handleSubmit={handleSubmit}
                        />

                        {/* Right: Checklist */}
                        <StreetViewSidebar
                            isMobileLandscape={isMobileLandscape}
                            isPortrait={isPortrait}
                            sidebarWidthClass={sidebarWidthClass}
                            gameMode={gameMode}
                            gridSize={gridSize}
                            textSizeClass={sidebarTextSizeClass}
                            timeLeft={timeLeft}
                            aiEndGame={aiEndGame}
                            isBingoFirstWithAi={isBingoFirstWithAi}
                            handleAiVerifyAndEnd={handleAiVerifyAndEnd}
                            allCategoriesFilled={allCategoriesFilled}
                            isVerifying={isVerifying}
                            handleVoteEndRound={handleVoteEndRound}
                            hasVotedToEnd={hasVotedToEnd}
                            aiVerificationSuccess={aiVerificationSuccess}
                            readyPlayers={readyPlayers}
                            votesNeeded={votesNeeded}
                            listLayout={listLayout}
                            setGridEl={setGridEl}
                            myBoard={myBoard}
                            mySubmissions={mySubmissions}
                            otherSubmissions={otherSubmissions}
                            exclusiveMode={exclusiveMode}
                            allowHints={allowHints}
                            startingPoint={startingPoint}
                            submittingCategory={submittingCategory}
                            inStreetView={inStreetView}
                            verifyingIds={verifyingIds}
                            handleSubmit={handleSubmit}
                            jumpToLocation={jumpToLocation}
                            handleVerifyOne={handleVerifyOne}
                            handleBingoTileClick={handleBingoTileClick}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
