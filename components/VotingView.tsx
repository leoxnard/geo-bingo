'use client';

/*
================================================================================
VOTING VIEW COMPONENT
================================================================================
Displays player journey replay with real-time voting on submissions.
Shows GPS path animation, submission markers, and street view integration.
Features yellow submission markers and blue category markers on completed tracks.
================================================================================
*/

import { useState, useEffect, useRef, useMemo, Fragment } from 'react';

import { GoogleMap, useJsApiLoader, Polyline, MarkerF, StreetViewPanorama, Circle, OverlayViewF, OverlayView } from '@react-google-maps/api';
import toast from 'react-hot-toast';
import { FaInfoCircle } from 'react-icons/fa';

import { useT } from '@/lib/i18n/I18nProvider';

import { supabase } from '../lib/supabase';
import { resolveHint } from './streetview/streetViewHelpers';
import { GeoBingoLogo } from './utils/Elements';
import GlassAmbience from './utils/GlassAmbience';
import { mapOptions, GOOGLE_MAPS_LIBRARIES } from './utils/mapUtils';
import { VotingViewProps, Submission, PathPoint } from './utils/types';
import { useViewport } from './utils/useViewport';
import { hasHyped, tallyVotes, tallyScale, HYPE_PREFIX } from './utils/votes';
import { VotingPanel } from './voting/VotingPanel';

const MAX_ANIMATION_DURATION = 8000;

// Distinct colours for the simultaneous teammate paths in a team round.
const PATH_COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#c084fc', '#fac800'];

interface PlayerWithPaths {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
    path: PathPoint[];
}

interface PlayerRoundData {
    player: PlayerWithPaths;
    color: string;
    rawPath: PathPoint[];
    totalDist: number;
    dists: number[];
    subProgressions: { sub: Submission; progress: number }[];
}

// Marker position + drawn polyline portion for a shared, distance-normalized
// progress (0..1), so every player in a round starts, pauses and finishes together.
const computePartial = (pd: PlayerRoundData, progress: number): { currentPoint: PathPoint | null; partialPath: PathPoint[] } => {
    const { rawPath, totalDist, dists } = pd;
    if (rawPath.length === 0) return { currentPoint: null, partialPath: [] };
    if (progress <= 0 || totalDist === 0 || rawPath.length < 2) {
        return { currentPoint: rawPath[0], partialPath: [rawPath[0]] };
    }
    if (progress >= 1) {
        return { currentPoint: rawPath[rawPath.length - 1], partialPath: rawPath };
    }

    const targetDist = progress * totalDist;
    let idx = 0;
    while (idx < dists.length - 2 && dists[idx + 1] < targetDist) {
        idx++;
    }
    const p1 = rawPath[idx];
    const p2 = rawPath[idx + 1];
    const segmentDist = dists[idx + 1] - dists[idx];
    const t = segmentDist === 0 ? 0 : (targetDist - dists[idx]) / segmentDist;

    let dLng = p2.lng - p1.lng;
    if (dLng > 180) dLng -= 360;
    else if (dLng < -180) dLng += 360;

    let currentLng = p1.lng + dLng * t;
    if (currentLng > 180) currentLng -= 360;
    else if (currentLng < -180) currentLng += 360;

    const currentPoint = {
        lat: p1.lat + (p2.lat - p1.lat) * t,
        lng: currentLng,
        timestamp: p1.timestamp + (p2.timestamp - p1.timestamp) * t,
    };
    const partialPath = rawPath.slice(0, idx + 1);
    partialPath.push(currentPoint);
    return { currentPoint, partialPath };
};

interface BingoCategory {
    categoryName: string;
    score?: number;
    matchedPlaces: {
        name: string;
        lat: number;
        lng: number;
    }[];
}

const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    let dLng = Math.abs(lng1 - lng2);
    if (dLng > 180) dLng = 360 - dLng;
    return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(dLng, 2));
};

export function VotingView({ gameId, isHost, playerId, players, teamMode, onFinishGame, isDeveloper = false, hintByCategory = {}, scaleVoting = false }: VotingViewProps) {
    const { t } = useT();
    const { isNarrow } = useViewport();
    const isNarrowRef = useRef(isNarrow);
    useEffect(() => {
        isNarrowRef.current = isNarrow;
    }, [isNarrow]);
    const [gameCategories, setGameCategories] = useState<string[]>([]);
    const [gridSize, setGridSize] = useState<number>(3);
    const [gameMode, setGameMode] = useState<string>('list');
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [playersWithPaths, setPlayersWithPaths] = useState<PlayerWithPaths[]>([]);
    const [shownSubIds, setShownSubIds] = useState<Set<string>>(new Set());
    const [categoryDetails, setCategoryDetails] = useState<BingoCategory[]>([]);
    const [generationRadius, setGenerationRadius] = useState<number>(1000);
    // Preset category target positions, persisted on the game at import time, shown
    // as purple markers once a journey completes.
    const [presetPositions, setPresetPositions] = useState<{ categoryName: string; lat: number; lng: number }[]>([]);
    const [startingPoint, setStartingPoint] = useState<{
        lat: number;
        lng: number;
    } | null>(null);

    const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [isLineComplete, setIsLineComplete] = useState(false);

    const [activeSubmission, setActiveSubmission] = useState<Submission | null>(null);
    const [lastActiveSub, setLastActiveSub] = useState<Submission | null>(null);

    const [isStreetViewVisible, setIsStreetViewVisible] = useState(false);
    const [isDataLoaded, setIsDataLoaded] = useState(false);

    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

    const polylineRefs = useRef<Map<string, google.maps.Polyline>>(new Map());
    const movingMarkerRefs = useRef<Map<string, google.maps.Marker>>(new Map());
    const progressBarRef = useRef<HTMLDivElement | null>(null);

    const animationProgressRef = useRef(0);
    const lastTimeRef = useRef(0);
    const shownSubIdsRef = useRef<Set<string>>(new Set());
    const rAFRef = useRef(0);
    const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
    const streetViewPanoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
    // The map framing captured the moment the animation pauses on a category, so any
    // manual zoom done while inspecting can be undone when the journey continues.
    const prePauseViewRef = useRef<{ zoom: number; center: google.maps.LatLngLiteral } | null>(null);

    const dummyPath = useMemo(() => [], []);
    const dummyPos = useMemo(() => ({ lat: 20, lng: 0 }), []);

    const [maxItemsPerColumn, setMaxItemsPerColumn] = useState(8);
    const categoryRef = useRef<HTMLDivElement>(null);

    const [categorySource, setCategorySource] = useState<string>('manual');
    const [hoveredFinalMarker, setHoveredFinalMarker] = useState<{
        lat: number;
        lng: number;
        categoryNames: string[];
    } | null>(null);
    const [selectedFinalMarker, setSelectedFinalMarker] = useState<{
        lat: number;
        lng: number;
        categoryNames: string[];
    } | null>(null);
    const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
    const [optimalHeading, setOptimalHeading] = useState<number | null>(null);

    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries: GOOGLE_MAPS_LIBRARIES,
    });

    // A "round" is the unit being replayed: a single player in FFA, or a whole
    // team in team mode. Team rounds animate every teammate's path at once.
    const rounds = useMemo<{ team: number | undefined; players: PlayerWithPaths[] }[]>(() => {
        if (teamMode === 'teams') {
            const byTeam = new Map<number, PlayerWithPaths[]>();
            const solo: { team: number | undefined; players: PlayerWithPaths[] }[] = [];
            playersWithPaths.forEach((p) => {
                if (p.team === undefined || p.team < 0) {
                    solo.push({ team: p.team, players: [p] });
                    return;
                }
                if (!byTeam.has(p.team)) byTeam.set(p.team, []);
                byTeam.get(p.team)!.push(p);
            });
            const teamRounds = Array.from(byTeam.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([team, players]) => ({ team, players }));
            return [...teamRounds, ...solo];
        }
        return playersWithPaths.map((p) => ({ team: p.team, players: [p] }));
    }, [playersWithPaths, teamMode]);

    const currentRound = rounds[currentRoundIndex];
    const roundPlayers = useMemo(() => currentRound?.players ?? [], [currentRound]);
    const roundPlayerIds = useMemo(() => new Set(roundPlayers.map((p) => p.id)), [roundPlayers]);
    const roundTeam = currentRound?.team;
    const roundLabel = useMemo(() => roundPlayers.map((p) => p.name).join(' & '), [roundPlayers]);

    const activeSubLatest = useMemo(() => {
        if (activeSubmission && roundPlayerIds.has(activeSubmission.player_id)) {
            return submissions.find((s) => s.id === activeSubmission.id) || null;
        }
        return null;
    }, [activeSubmission, submissions, roundPlayerIds]);

    useEffect(() => {
        // Only auto-show street view for active submissions, not for manual selections
        if (selectedFinalMarker || selectedSubmission) {
            return; // Don't override manual selections
        }

        const delay = activeSubLatest ? 500 : 0;

        const timer = setTimeout(() => {
            setIsStreetViewVisible(!!activeSubLatest);
        }, delay);

        return () => clearTimeout(timer);
    }, [activeSubLatest, selectedFinalMarker, selectedSubmission]);

    // Fetch optimal heading from Street View metadata to match overlay preview
    useEffect(() => {
        if (!selectedFinalMarker || !isLoaded) return;

        const fetchOptimalHeading = async () => {
            try {
                const response = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${selectedFinalMarker.lat},${selectedFinalMarker.lng}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`);
                const data = await response.json();
                if (data.status === 'OK' && data.heading !== undefined) {
                    setOptimalHeading(data.heading);
                } else {
                    setOptimalHeading(null);
                }
            } catch (error) {
                console.error('Error fetching Street View metadata:', error);
                setOptimalHeading(null);
            }
        };

        fetchOptimalHeading();
    }, [selectedFinalMarker, isLoaded]);

    // Manually set POV on Street View Panorama after it loads
    useEffect(() => {
        if (streetViewPanoramaRef.current && selectedFinalMarker && optimalHeading !== null) {
            setTimeout(() => {
                streetViewPanoramaRef.current?.setPov({
                    heading: optimalHeading,
                    pitch: 0,
                });
            }, 500); // Small delay to ensure panorama is fully loaded
        }
    }, [selectedFinalMarker, optimalHeading]);

    useEffect(() => {
        const calculateCapacity = () => {
            if (categoryRef.current) {
                const containerHeight = categoryRef.current.clientHeight;

                const TILE_HEIGHT = 30;
                const GAP = 12;
                const itemsThatFit = Math.floor(containerHeight / (TILE_HEIGHT + GAP));
                setMaxItemsPerColumn(Math.max(3, itemsThatFit));
            }
        };
        calculateCapacity();
        window.addEventListener('resize', calculateCapacity);
        return () => window.removeEventListener('resize', calculateCapacity);
    }, []);

    const displaySub = activeSubLatest || lastActiveSub;

    // Re-apply the active submission's exact viewpoint each time a new one surfaces,
    // instead of keeping the previous submission's manual pan/zoom.
    useEffect(() => {
        if (selectedSubmission || selectedFinalMarker) return;
        const pano = streetViewPanoramaRef.current;
        if (pano && displaySub) {
            pano.setPosition({ lat: displaySub.lat, lng: displaySub.lng });
            pano.setPov({ heading: displaySub.heading, pitch: displaySub.pitch });
            pano.setZoom(displaySub.zoom || 3);
        }
    }, [displaySub, selectedSubmission, selectedFinalMarker]);

    const currentBoard = useMemo(() => {
        const board = roundPlayers[0]?.bingo_board;
        if (board && board.length > 0) {
            return board;
        }
        return gameCategories.slice(0, gameMode === 'list' ? gameCategories.length : gridSize * gridSize);
    }, [roundPlayers, gameCategories, gridSize, gameMode]);

    const votingStats = useMemo(() => {
        let isComplete = false;
        let cast = 0;
        let eligibleCount = 0;
        if (activeSubLatest) {
            const votesMap = activeSubLatest.votes || {};
            // Hype is an extra, optional cheer — it doesn't count as casting a yes/no
            // vote, so it must not advance the round-completion tally.
            const actualVotes = Object.keys(votesMap).filter((k) => k !== 'host_continued' && !k.startsWith(HYPE_PREFIX));
            cast = actualVotes.length;

            const eligibleVoters = playersWithPaths.filter((p) => (teamMode === 'teams' ? p.team !== roundTeam : !roundPlayerIds.has(p.id)));
            eligibleCount = eligibleVoters.length;
            isComplete = cast >= eligibleCount || eligibleCount === 0;
        }
        return { isComplete, cast, eligibleCount };
    }, [activeSubLatest, playersWithPaths, roundTeam, roundPlayerIds, teamMode]);

    // Data Fetching
    useEffect(() => {
        const fetchData = async () => {
            const { data: gData } = await supabase.from('games').select('categories, grid_size, game_mode, category_details, generation_radius, starting_point, category_source, preset_categories').eq('id', gameId).single();

            if (gData) {
                setGameCategories(gData.categories || []);
                setGridSize(gData.grid_size || 3);
                setGameMode(gData.game_mode || 'list');
                setCategoryDetails(gData.category_details || []);
                setGenerationRadius(gData.generation_radius || 1000);
                setCategorySource(gData.category_source || 'manual');
                setStartingPoint(gData.starting_point !== 'open-world' && gData.category_source !== 'manual' ? JSON.parse(gData.starting_point) : null);
                if (Array.isArray(gData.preset_categories)) setPresetPositions(gData.preset_categories);
            }

            const { data: subData } = await supabase.from('submissions').select('*').eq('game_id', gameId);
            if (subData) setSubmissions(subData);

            const { data: pData } = await supabase.from('players').select('id, name, team, path, bingo_board').eq('game_id', gameId);
            if (pData) {
                const validPlayers = pData.filter((p) => p.path && p.path.length > 0);
                setPlayersWithPaths(validPlayers);
            }
            setIsDataLoaded(true);
        };
        fetchData();

        const channel = supabase
            .channel(`voting-journey-${gameId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'submissions',
                    filter: `game_id=eq.${gameId}`,
                },
                (payload) => {
                    setSubmissions((prev) => prev.map((s) => (s.id === payload.new.id ? { ...s, votes: payload.new.votes } : s)));
                },
            )
            .on('broadcast', { event: 'next_player' }, (payload) => {
                setActiveSubmission(null);
                // Close any manually-opened Street View so the next player starts on the map.
                setIsStreetViewVisible(false);
                setSelectedSubmission(null);
                setSelectedFinalMarker(null);
                setIsPaused(false);
                setIsLineComplete(false);
                shownSubIdsRef.current.clear();
                setShownSubIds(new Set());
                animationProgressRef.current = 0;
                if (progressBarRef.current) progressBarRef.current.style.transform = `scale${isNarrowRef.current ? 'X' : 'Y'}(0)`;

                setCurrentRoundIndex(payload.payload.index);
            })
            .subscribe();
        // NOTE: no 'finish_game' broadcast handler here — it duplicated the host's
        // DB write on every receiver (now blocked by the host-only set_game_status
        // RPC). The page-level games subscription already re-renders to PodiumView.

        return () => {
            supabase.removeChannel(channel);
        };
    }, [gameId]);

    // Path Calculations — one entry per player in the current round, each measured by
    // its own cumulative distance so a shared 0..1 progress maps everyone proportionally.
    const roundData = useMemo<PlayerRoundData[]>(() => {
        return roundPlayers.map((player, idx) => {
            const rawPath = player.path || [];
            let totalDist = 0;
            const dists = [0];

            for (let i = 0; i < rawPath.length - 1; i++) {
                totalDist += getDistance(rawPath[i].lat, rawPath[i].lng, rawPath[i + 1].lat, rawPath[i + 1].lng);
                dists.push(totalDist);
            }

            const subsForPlayer = submissions.filter((s) => s.player_id === player.id);
            const subProgressions = subsForPlayer.map((sub) => {
                let bestProgress = 0;
                // Prefer matching by capture time (same clock as the path) so an overwrite
                // surfaces where it was re-taken; fall back to nearest-in-space without it.
                if (typeof sub.captured_at === 'number' && rawPath.length > 0 && totalDist > 0) {
                    // Snap to the last point recorded at or before capture — that's where the
                    // player stood when they submitted. The path is chronological, so this is
                    // a floor. Matching the *nearest* timestamp instead drifts one step ahead
                    // when the player moved to the next pano right after submitting.
                    let floorIdx = -1;
                    for (let i = 0; i < rawPath.length; i++) {
                        if (rawPath[i].timestamp <= sub.captured_at) floorIdx = i;
                        else break;
                    }
                    if (floorIdx >= 0) {
                        bestProgress = dists[floorIdx] / totalDist;
                    } else {
                        // Capture predates the whole path — fall back to nearest in time.
                        let bestDelta = Infinity;
                        for (let i = 0; i < rawPath.length; i++) {
                            const delta = Math.abs(rawPath[i].timestamp - sub.captured_at);
                            if (delta < bestDelta) {
                                bestDelta = delta;
                                bestProgress = dists[i] / totalDist;
                            }
                        }
                    }
                } else {
                    let minDistance = Infinity;
                    for (let i = 0; i < rawPath.length; i++) {
                        const d = getDistance(rawPath[i].lat, rawPath[i].lng, sub.lat, sub.lng);
                        if (d < minDistance) {
                            minDistance = d;
                            bestProgress = totalDist === 0 ? 0 : dists[i] / totalDist;
                        }
                    }
                }
                return { sub, progress: bestProgress };
            });

            return { player, color: PATH_COLORS[idx % PATH_COLORS.length], rawPath, totalDist, dists, subProgressions };
        });
    }, [roundPlayers, submissions]);

    // All teammate submissions sorted by progress, so the animation can pause at
    // whichever submission comes next across the whole team.
    const allSubProgressions = useMemo(() => roundData.flatMap((pd) => pd.subProgressions).sort((a, b) => a.progress - b.progress), [roundData]);

    const allRoundPoints = useMemo(() => roundData.flatMap((pd) => pd.rawPath), [roundData]);

    // Map Init — frame the entire round so every teammate's path stays visible.
    useEffect(() => {
        if (!mapInstance || allRoundPoints.length === 0) return;

        const initMap = () => {
            if (allRoundPoints.length > 1) {
                const bounds = new window.google.maps.LatLngBounds();
                allRoundPoints.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
                mapInstance.fitBounds(bounds, 80);
            } else {
                mapInstance.setZoom(15);
                mapInstance.setCenter(allRoundPoints[0]);
            }
        };

        if (animationProgressRef.current === 0) {
            initMap();
        }
    }, [mapInstance, allRoundPoints]);

    const calculatedDuration = useMemo(() => {
        const numPoints = roundData.reduce((max, pd) => Math.max(max, pd.rawPath.length), 0);
        if (numPoints <= 10) return MAX_ANIMATION_DURATION * 0.25;
        if (numPoints <= 50) return MAX_ANIMATION_DURATION * 0.5;
        return MAX_ANIMATION_DURATION;
    }, [roundData]);

    // Animation Loop — drives every teammate's path off one shared, normalized
    // progress. The map is framed to the whole round up front (no per-frame recenter).
    useEffect(() => {
        if (!mapInstance || isPaused || isLineComplete || roundData.length === 0) return;
        if (!roundData.some((pd) => pd.rawPath.length > 0)) return;

        lastTimeRef.current = performance.now();

        const animate = (time: DOMHighResTimeStamp) => {
            let delta = time - lastTimeRef.current;
            if (delta > 100) delta = 16.66;

            lastTimeRef.current = time;

            let progress = animationProgressRef.current + delta / calculatedDuration;
            let hitSub = false;

            if (progress >= 1) progress = 1;

            // Next submission to surface across all teammates, in progress order.
            let crossedSub = allSubProgressions.find((sp) => sp.progress <= progress && !shownSubIdsRef.current.has(sp.sub.id));

            if (progress === 1 && !crossedSub) {
                const unshownSub = allSubProgressions.find((sp) => !shownSubIdsRef.current.has(sp.sub.id));
                if (unshownSub) crossedSub = unshownSub;
            }

            if (crossedSub) {
                shownSubIdsRef.current.add(crossedSub.sub.id);
                setActiveSubmission(crossedSub.sub);
                setLastActiveSub(crossedSub.sub);
                setIsPaused(true);
                setShownSubIds(new Set(shownSubIdsRef.current));
                progress = crossedSub.progress;
                hitSub = true;
            }

            animationProgressRef.current = progress;

            if (progressBarRef.current) {
                progressBarRef.current.style.transform = `scale${isNarrow ? 'X' : 'Y'}(${progress})`;
            }

            // Advance every teammate to the same shared progress: when one pauses on a
            // found category, the others freeze partway between two of theirs.
            for (const pd of roundData) {
                const { currentPoint, partialPath } = computePartial(pd, progress);
                const pl = polylineRefs.current.get(pd.player.id);
                const mk = movingMarkerRefs.current.get(pd.player.id);
                if (pl) pl.setPath(partialPath);
                if (mk && currentPoint) mk.setPosition(currentPoint);
            }

            if (progress >= 1 && !hitSub) {
                setIsLineComplete(true);
            } else if (!hitSub) {
                rAFRef.current = requestAnimationFrame(animate);
            }
        };

        rAFRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rAFRef.current);
    }, [isPaused, isLineComplete, mapInstance, roundData, allSubProgressions, calculatedDuration, isNarrow]);

    // On completion, re-fit so all teammate paths are framed together.
    useEffect(() => {
        if (isLineComplete && mapInstance && allRoundPoints.length > 1) {
            const bounds = new window.google.maps.LatLngBounds();
            allRoundPoints.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
            mapInstance.fitBounds(bounds, 80);
        }
    }, [isLineComplete, mapInstance, allRoundPoints]);

    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout>;

        if (votingStats.isComplete && activeSubLatest && isPaused) {
            timeoutId = setTimeout(() => {
                setActiveSubmission(null);
                setIsPaused(false);
            }, 100);
        }
        return () => clearTimeout(timeoutId);
    }, [votingStats.isComplete, activeSubLatest, isPaused]);

    const handleVote = async (sub: Submission, voteIsYes: boolean) => {
        const newVotes = { ...sub.votes, [playerId]: voteIsYes };
        setSubmissions((prev) => prev.map((s) => (s.id === sub.id ? { ...s, votes: newVotes } : s)));

        const { error } = await supabase.rpc('register_vote', {
            p_submission_id: sub.id,
            p_player_id: playerId,
            p_vote: voteIsYes,
        });

        if (error) {
            console.error(error);
            toast.error(t('voting.errorVote'));
        }
    };

    const handleHype = async (sub: Submission) => {
        const hypeKey = `${HYPE_PREFIX}${playerId}`;
        const nextHype = !(sub.votes?.[hypeKey] === true);
        // Hyping implies a Yes vote — you can't cheer something you're voting down.
        const newVotes = { ...sub.votes, [hypeKey]: nextHype, ...(nextHype ? { [playerId]: true } : {}) };
        setSubmissions((prev) => prev.map((s) => (s.id === sub.id ? { ...s, votes: newVotes } : s)));

        const calls = [supabase.rpc('register_hype', { p_submission_id: sub.id, p_player_id: playerId, p_hype: nextHype })];
        if (nextHype) {
            calls.push(supabase.rpc('register_vote', { p_submission_id: sub.id, p_player_id: playerId, p_vote: true }));
        }
        const results = await Promise.all(calls);
        if (results.some((r) => r.error)) {
            results.forEach((r) => r.error && console.error(r.error));
            toast.error(t('voting.errorVote'));
        }
    };

    const handleScaleVote = async (sub: Submission, value: number) => {
        const clamped = Math.max(0, Math.min(10, Math.round(value)));
        const newVotes = { ...sub.votes, [playerId]: clamped };
        setSubmissions((prev) => prev.map((s) => (s.id === sub.id ? { ...s, votes: newVotes } : s)));

        const { error } = await supabase.rpc('register_scale_vote', {
            p_submission_id: sub.id,
            p_player_id: playerId,
            p_value: clamped,
        });

        if (error) {
            console.error(error);
            toast.error(t('voting.errorVote'));
        }
    };

    const handleNextPlayer = () => {
        if (currentRoundIndex < rounds.length - 1) {
            const nextIndex = currentRoundIndex + 1;

            setActiveSubmission(null);
            // Close any manually-opened Street View so the next player starts on the map.
            setIsStreetViewVisible(false);
            setSelectedSubmission(null);
            setSelectedFinalMarker(null);
            setIsPaused(false);
            setIsLineComplete(false);
            shownSubIdsRef.current.clear();
            setShownSubIds(new Set());
            animationProgressRef.current = 0;
            if (progressBarRef.current) progressBarRef.current.style.transform = `scale${isNarrow ? 'X' : 'Y'}(0)`;

            setCurrentRoundIndex(nextIndex);

            supabase
                .channel(`voting-journey-${gameId}`)
                .httpSend('next_player', { index: nextIndex })
                .catch(() => {});
        } else {
            supabase
                .channel(`voting-journey-${gameId}`)
                .httpSend('finish_game', {})
                .catch(() => {});
            onFinishGame();
        }
    };

    const handleSkipToPodium = () => {
        supabase
            .channel(`voting-journey-${gameId}`)
            .httpSend('finish_game', {})
            .catch(() => {});
        onFinishGame();
    };

    // while animation
    const activeCategoryMarkers = useMemo(() => {
        if (!displaySub || isLineComplete) return null;

        const activeCat = categoryDetails.find((cat) => cat.categoryName === displaySub.category);
        if (!activeCat) return null;

        return activeCat.matchedPlaces.map((place, pIdx) => {
            const mId = `active-${displaySub.id}-${pIdx}`;
            return (
                <MarkerF
                    key={mId}
                    position={{ lat: place.lat, lng: place.lng }}
                    options={{
                        icon: {
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: 8,
                            fillColor: '#4f46e5',
                            fillOpacity: 1,
                            strokeWeight: 1.5,
                            strokeColor: '#a4b3ff',
                        },
                        label: {
                            text: place.name,
                            className: 'bg-slate-900/90 text-white p-3 rounded-lg border border-indigo-500 text-[10px] font-bold mt-10 whitespace-nowrap shadow-lg',
                            color: '#a4b3ff',
                        },
                    }}
                    animation={typeof window !== 'undefined' && window.google ? window.google.maps.Animation.DROP : undefined}
                />
            );
        });
    }, [displaySub, isLineComplete, categoryDetails]);

    const categoryScoreMap = useMemo(() => {
        const m = new Map<string, number>();
        categoryDetails.forEach((cat) => {
            if (typeof cat.score === 'number') m.set((cat.categoryName || '').toLowerCase(), cat.score);
        });
        return m;
    }, [categoryDetails]);

    const labelForCategory = (name: string) => {
        const score = categoryScoreMap.get((name || '').toLowerCase());
        return isDeveloper && typeof score === 'number' ? `${name} (${score})` : name;
    };

    const groupedFinalPlaces = useMemo(() => {
        if (!categoryDetails) return [];

        const activeNames = new Set(gameCategories.map((c) => (c || '').toLowerCase()));
        const map = new Map<string, { lat: number; lng: number; categoryNames: string[] }>();

        categoryDetails.forEach((cat) => {
            if (!activeNames.has((cat.categoryName || '').toLowerCase())) return;
            cat.matchedPlaces.forEach((place) => {
                const key = `${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;

                if (!map.has(key)) {
                    map.set(key, { lat: place.lat, lng: place.lng, categoryNames: [] });
                }

                const entry = map.get(key)!;
                if (!entry.categoryNames.includes(cat.categoryName)) {
                    entry.categoryNames.push(cat.categoryName);
                }
            });
        });

        return Array.from(map.values());
    }, [categoryDetails, gameCategories]);

    let finalCategoryMarkers = null;
    let finalSubmissionMarkers = null;
    let presetCategoryMarkers = null;

    if (isLineComplete) {
        // Purple markers for the preset's target spots (imported games only): hover
        // shows the name + preview, click opens that location in the right Street View.
        if (presetPositions.length > 0) {
            presetCategoryMarkers = presetPositions.map((cat, idx) => {
                const mId = `preset-${idx}`;
                const labelConfig = {
                    text: labelForCategory(cat.categoryName),
                    className: 'bg-slate-900/90 text-white p-3 rounded-lg border border-purple-500 text-[10px] font-bold mt-10 whitespace-nowrap shadow-lg',
                    color: '#e9d5ff',
                };
                return (
                    <MarkerF
                        key={mId}
                        position={{ lat: cat.lat, lng: cat.lng }}
                        onLoad={(marker) => markersRef.current.set(mId, marker)}
                        onUnmount={() => markersRef.current.delete(mId)}
                        onMouseOver={() => {
                            const marker = markersRef.current.get(mId);
                            if (marker) {
                                marker.setLabel(labelConfig);
                                marker.setZIndex(100);
                            }
                            setHoveredFinalMarker({ lat: cat.lat, lng: cat.lng, categoryNames: [cat.categoryName] });
                        }}
                        onMouseOut={() => {
                            const marker = markersRef.current.get(mId);
                            if (marker) {
                                marker.setLabel(null);
                                marker.setZIndex(4);
                            }
                            setHoveredFinalMarker(null);
                        }}
                        onClick={() => {
                            setSelectedFinalMarker({ lat: cat.lat, lng: cat.lng, categoryNames: [cat.categoryName] });
                            setSelectedSubmission(null);
                            setIsStreetViewVisible(true);
                        }}
                        options={{
                            icon: {
                                path: window.google.maps.SymbolPath.CIRCLE,
                                scale: 7,
                                fillColor: '#a855f7',
                                fillOpacity: 1,
                                strokeWeight: 2,
                                strokeColor: '#e9d5ff',
                            },
                            zIndex: 4,
                        }}
                    />
                );
            });
        }

        // Add submission markers (yellow) for every teammate in the round
        const currentPlayerSubmissions = submissions.filter((s) => roundPlayerIds.has(s.player_id));
        finalSubmissionMarkers = currentPlayerSubmissions.map((sub) => {
            const mId = `final-sub-${sub.id}`;
            return (
                <MarkerF
                    key={mId}
                    position={{ lat: sub.lat, lng: sub.lng }}
                    onLoad={(marker) => markersRef.current.set(mId, marker)}
                    onUnmount={() => markersRef.current.delete(mId)}
                    onMouseOver={() => {
                        const marker = markersRef.current.get(mId);
                        if (marker) {
                            marker.setZIndex(100);
                        }
                    }}
                    onMouseOut={() => {
                        const marker = markersRef.current.get(mId);
                        if (marker) {
                            marker.setZIndex(6);
                        }
                    }}
                    onClick={() => {
                        setSelectedSubmission(sub);
                        setSelectedFinalMarker(null);
                        setIsStreetViewVisible(true);
                    }}
                    options={{
                        icon: {
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: 8,
                            fillColor: '#fac800',
                            fillOpacity: 1,
                            strokeWeight: 2,
                            strokeColor: '#ffffff',
                        },
                        zIndex: 6,
                    }}
                    animation={typeof window !== 'undefined' && window.google ? window.google.maps.Animation.DROP : undefined}
                />
            );
        });

        // Add category markers (existing logic)
        finalCategoryMarkers = groupedFinalPlaces.map((group, idx) => {
            const mId = `final-group-${idx}`;
            const combinedCategories = group.categoryNames.map(labelForCategory).join(' • ');

            const labelConfig = {
                text: combinedCategories,
                className: 'bg-slate-900/90 text-white p-3 rounded-lg border border-indigo-500 text-[10px] font-bold mt-10 whitespace-nowrap shadow-lg',
                color: '#a4b3ff',
            };

            return (
                <MarkerF
                    key={mId}
                    position={{ lat: group.lat, lng: group.lng }}
                    onLoad={(marker) => markersRef.current.set(mId, marker)}
                    onUnmount={() => markersRef.current.delete(mId)}
                    onMouseOver={() => {
                        const marker = markersRef.current.get(mId);
                        if (marker) {
                            if (categorySource !== 'nearbyStreetView') {
                                marker.setLabel(labelConfig);
                            }
                            marker.setZIndex(100);
                            setHoveredFinalMarker({
                                lat: group.lat,
                                lng: group.lng,
                                categoryNames: group.categoryNames,
                            });
                        }
                    }}
                    onMouseOut={() => {
                        const marker = markersRef.current.get(mId);
                        if (marker) {
                            marker.setLabel(null);
                            marker.setZIndex(5);
                        }
                        setHoveredFinalMarker(null);
                    }}
                    onClick={() => {
                        setSelectedFinalMarker({
                            lat: group.lat,
                            lng: group.lng,
                            categoryNames: group.categoryNames,
                        });
                        setSelectedSubmission(null);
                        setIsStreetViewVisible(true);
                    }}
                    options={{
                        icon: {
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: group.categoryNames.length > 1 ? 10 : 8,
                            fillColor: '#4f46e5',
                            fillOpacity: 1,
                            strokeWeight: group.categoryNames.length > 1 ? 2 : 1.5,
                            strokeColor: '#a4b3ff',
                        },
                        zIndex: 5,
                    }}
                    animation={typeof window !== 'undefined' && window.google ? window.google.maps.Animation.DROP : undefined}
                />
            );
        });
    }

    const currentMapOptions = useMemo(() => {
        const interactive = isLineComplete || (isPaused && !isLineComplete);
        return mapOptions({
            streetViewControl: false,
            disableDefaultUI: true,
            clickableIcons: false,
            gestureHandling: interactive ? 'greedy' : 'none',
            scrollwheel: interactive,
            disableDoubleClickZoom: !interactive,
            draggable: interactive,
            keyboardShortcuts: interactive,
            zoomControl: interactive,
            styles: [],
        });
    }, [isLineComplete, isPaused]);

    useEffect(() => {
        if (!mapInstance) return;
        if (isPaused && !isLineComplete) {
            const zoom = mapInstance.getZoom();
            const center = mapInstance.getCenter();
            if (typeof zoom === 'number' && center) {
                prePauseViewRef.current = { zoom, center: { lat: center.lat(), lng: center.lng() } };
            }
        } else if (prePauseViewRef.current && !isLineComplete) {
            mapInstance.setZoom(prePauseViewRef.current.zoom);
            mapInstance.setCenter(prePauseViewRef.current.center);
            prePauseViewRef.current = null;
        }
    }, [isPaused, isLineComplete, mapInstance]);

    const panoramaOptions = useMemo(() => {
        if (selectedSubmission) {
            return {
                position: { lat: selectedSubmission.lat, lng: selectedSubmission.lng },
                pov: {
                    heading: selectedSubmission.heading,
                    pitch: selectedSubmission.pitch,
                },
                zoom: selectedSubmission.zoom || 3,
                visible: true,
                addressControl: false,
                showRoadLabels: false,
                enableCloseButton: false,
                linksControl: false,
                panControl: false,
                fullscreenControl: false,
                motionTracking: false,
                zoomControl: false,
            };
        }
        if (selectedFinalMarker) {
            const options: google.maps.StreetViewPanoramaOptions = {
                position: {
                    lat: selectedFinalMarker.lat,
                    lng: selectedFinalMarker.lng,
                },
                zoom: 3,
                visible: true,
                addressControl: false,
                showRoadLabels: false,
                enableCloseButton: false,
                linksControl: false,
                panControl: false,
                fullscreenControl: false,
                motionTracking: false,
                zoomControl: false,
            };
            // Use fetched optimal heading if available
            if (optimalHeading !== null) {
                options.pov = { heading: optimalHeading, pitch: 0 };
            }
            return options;
        }
        if (displaySub) {
            return {
                position: { lat: displaySub.lat, lng: displaySub.lng },
                pov: { heading: displaySub.heading, pitch: displaySub.pitch },
                zoom: displaySub.zoom || 3,
                visible: true,
                addressControl: false,
                showRoadLabels: false,
                enableCloseButton: false,
                linksControl: false,
                panControl: false,
                fullscreenControl: false,
                motionTracking: false,
                zoomControl: false,
            };
        }
        return undefined;
    }, [displaySub, optimalHeading, selectedFinalMarker, selectedSubmission]);

    const panoramaKey = selectedSubmission?.id ? `submission-${selectedSubmission.id}` : selectedFinalMarker ? `final-${selectedFinalMarker.lat}-${selectedFinalMarker.lng}-${selectedFinalMarker.categoryNames.join('|')}` : displaySub?.id ? `display-${displaySub.id}` : 'default';

    if (!isLoaded || !isDataLoaded) {
        return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-indigo-300 font-bold text-2xl tracking-widest uppercase">{t('common.loading')}</div>;
    }

    if (isDataLoaded && playersWithPaths.length === 0) {
        return (
            <div className="relative min-h-screen overflow-hidden bg-slate-950 flex flex-col items-center justify-center text-white">
                <GlassAmbience drifters={false} />
                <h2 className="relative text-2xl font-bold mb-4 text-indigo-300 tracking-widest uppercase">{t('voting.noPathsFound')}</h2>
                <p className="relative text-slate-400 mb-8">{t('voting.noPathsDesc')}</p>
                {isHost && (
                    <button type="button" onClick={onFinishGame} className="btn-sheen press relative px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-500 rounded-xl font-bold shadow-[0_16px_32px_-10px_rgba(16,185,129,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]">
                        {t('voting.endGame')}
                    </button>
                )}
            </div>
        );
    }

    const activeTally = tallyVotes(activeSubLatest?.votes);
    const yesVotes = activeSubLatest ? activeTally.yes : 0;
    const noVotes = activeSubLatest ? activeTally.no : 0;
    const hypeVotes = activeSubLatest ? activeTally.hype : 0;
    const hasHypedActive = activeSubLatest ? hasHyped(activeSubLatest.votes, playerId) : false;

    const totalCategories = currentBoard?.length || 0;
    let columns = 1;
    let rows = 1;

    if (gameMode === 'bingo') {
        columns = gridSize;
        rows = gridSize;
    } else {
        columns = Math.ceil(totalCategories / maxItemsPerColumn) || 1;
        rows = Math.ceil(totalCategories / columns) || 1;
    }

    return (
        <div className={`flex ${isNarrow ? 'flex-col' : 'flex-row'} h-[100dvh] w-screen overflow-hidden bg-slate-950`}>
            {/* Left Panel (Map) */}
            <div className={`relative ${isNarrow ? 'w-full h-1/2' : 'w-1/2 h-full'} z-10 flex-shrink-0`}>
                <GoogleMap onLoad={(map) => setMapInstance(map)} mapContainerClassName="w-full h-full" options={currentMapOptions}>
                    {roundData.map((pd) => (
                        <Polyline
                            key={`pl-${pd.player.id}`}
                            path={isLineComplete ? pd.rawPath : dummyPath}
                            onLoad={(p) => polylineRefs.current.set(pd.player.id, p)}
                            onUnmount={() => polylineRefs.current.delete(pd.player.id)}
                            options={{
                                strokeColor: pd.color,
                                strokeOpacity: 0.8,
                                strokeWeight: 6,
                                zIndex: 10000,
                            }}
                        />
                    ))}

                    {!isLineComplete &&
                        roundData.map((pd) => (
                            <MarkerF
                                key={`mk-${pd.player.id}`}
                                position={pd.rawPath[0] || dummyPos}
                                onLoad={(m) => movingMarkerRefs.current.set(pd.player.id, m)}
                                onUnmount={() => movingMarkerRefs.current.delete(pd.player.id)}
                                icon={{
                                    path: window.google.maps.SymbolPath.CIRCLE,
                                    scale: 8,
                                    fillColor: '#ffffff',
                                    fillOpacity: 1,
                                    strokeColor: pd.color,
                                    strokeWeight: 4,
                                }}
                            />
                        ))}

                    {/* Category Markers */}
                    {activeCategoryMarkers}

                    {/* Final Category Markers */}
                    {finalCategoryMarkers}

                    {/* Final Submission Markers */}
                    {finalSubmissionMarkers}

                    {/* Preset Category Position Markers */}
                    {presetCategoryMarkers}

                    {hoveredFinalMarker && (categorySource === 'nearbyStreetView' || presetPositions.length > 0) && (
                        <OverlayViewF
                            position={{
                                lat: hoveredFinalMarker.lat,
                                lng: hoveredFinalMarker.lng,
                            }}
                            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                            getPixelPositionOffset={(width, height) => ({
                                x: -(width / 2),
                                y: -(height + 15),
                            })}
                        >
                            <div className="glass-dark flex flex-col !border-indigo-400/60 rounded-lg overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.5)] pointer-events-none w-[240px] animate-in fade-in slide-in-from-bottom-2 duration-200">
                                <div className="bg-gradient-to-r from-indigo-500 to-violet-500 text-white px-3 py-2 text-center font-bold text-[11px] uppercase tracking-wider flex flex-col gap-0.5">
                                    {hoveredFinalMarker.categoryNames.map((name, i) => (
                                        <span key={i}>{labelForCategory(name)}</span>
                                    ))}
                                </div>
                                <img src={`https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${hoveredFinalMarker.lat},${hoveredFinalMarker.lng}&fov=120&source=outdoor&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`} alt={hoveredFinalMarker.categoryNames[0]} className="w-full h-[240px] object-cover block" />
                            </div>
                        </OverlayViewF>
                    )}

                    {/* Radius Circle */}
                    {isLineComplete && (
                        <Circle
                            center={startingPoint || { lat: 20, lng: 0 }}
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
                </GoogleMap>

                <div className="absolute top-6 left-6 right-6 z-10 flex justify-between items-start pointer-events-none">
                    <div className="flex items-center gap-4">
                        <GeoBingoLogo size={50} className="drop-shadow-xl" />
                        <div>
                            <h1 className="text-3xl font-black uppercase text-indigo-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">{t('voting.journeyReplay')}</h1>
                            <p className="text-white font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] mt-1">
                                {/* color player name with their path color */}
                                <span className="glass-dark px-4 py-1.5 rounded-full text-slate-300">
                                    <span className="text-slate-400 font-bold">{t('voting.following')} </span>
                                    {roundData.map((pd, index) => (
                                        <Fragment key={pd.player.id}>
                                            {/* Player name in their specific color */}
                                            <span style={{ color: pd.color }}>{pd.player.name}</span>

                                            {/* Separators in the default text color */}
                                            {index < roundData.length - 2 ? ', ' : index === roundData.length - 2 ? ' and ' : ''}
                                        </Fragment>
                                    ))}
                                </span>
                            </p>
                        </div>
                    </div>

                    {isHost && currentRoundIndex < rounds.length - 1 && (
                        <button type="button" onClick={handleSkipToPodium} className="btn-sheen press pointer-events-auto font-bold px-6 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-[0_14px_28px_-10px_rgba(244,63,94,0.6),inset_0_1px_0_rgba(255,255,255,0.3)]">
                            {t('voting.skip')}
                        </button>
                    )}
                </div>

                {isLineComplete && !activeSubLatest && (
                    <div className="glass-dark absolute bottom-6 left-1/2 -translate-x-1/2 z-40 p-6 rounded-2xl ring-1 ring-indigo-400/40 shadow-[0_0_50px_rgba(79,70,229,0.4)] w-[350px] text-center animate-in zoom-in-90 duration-300">
                        <h2 className="text-2xl font-black uppercase text-indigo-300 mb-2">{t('voting.journeyOf', { player: roundLabel })}</h2>
                        <p className="text-slate-300 font-medium mb-6">{t('voting.complete')}</p>

                        {isHost ? (
                            <button type="button" onClick={handleNextPlayer} className="btn-sheen press w-full py-3 rounded-xl font-black uppercase text-sm bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-[0_14px_28px_-10px_rgba(99,102,241,0.65),inset_0_1px_0_rgba(255,255,255,0.3)]">
                                {currentRoundIndex < rounds.length - 1 ? t('voting.nextPlayer') : t('voting.showPodium')}
                            </button>
                        ) : (
                            <p className="text-sm text-slate-400 uppercase tracking-widest font-bold">{t('common.waitingForHost')}</p>
                        )}
                    </div>
                )}
            </div>

            {/* Right Panel */}
            <div className={`relative ${isNarrow ? 'w-full h-1/2' : 'w-1/2 h-full'} bg-slate-950 z-20 shadow-[-20px_0_50px_rgba(0,0,0,0.5)] overflow-hidden`}>
                <GlassAmbience drifters={false} alpha={0.3} />
                {/* Progress Bar */}
                {isNarrow ? (
                    <div className="absolute left-0 top-0 right-0 h-1.5 z-40 bg-slate-950/60 border-b border-white/10">
                        <div
                            ref={progressBarRef}
                            className={`absolute top-0 left-0 w-full h-full bg-indigo-500 shadow-[0_0_20px_2px_rgba(79,70,229,1)] origin-left`}
                            style={{
                                transform: 'scaleX(0)',
                                transition: 'transform 0.1s linear',
                            }}
                        ></div>
                    </div>
                ) : (
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 z-40 bg-slate-950/60 border-r border-white/10">
                        <div
                            ref={progressBarRef}
                            className={`absolute top-0 left-0 w-full h-full bg-indigo-500 shadow-[0_0_20px_2px_rgba(79,70,229,1)] origin-top`}
                            style={{
                                transform: 'scaleY(0)',
                                transition: 'transform 0.1s linear',
                            }}
                        ></div>
                    </div>
                )}

                {/* STREETVIEW CONTAINER */}
                <div className={`absolute inset-0 ${isNarrow ? 'pt-1.5' : 'pl-1.5'} flex flex-col z-30 bg-slate-950 transition-all duration-500 ease-in-out ${isStreetViewVisible ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 translate-x-12 pointer-events-none'}`}>
                    <div className="flex-grow relative w-full">
                        <GoogleMap
                            mapContainerClassName="w-full h-full"
                            center={
                                selectedSubmission
                                    ? { lat: selectedSubmission.lat, lng: selectedSubmission.lng }
                                    : selectedFinalMarker
                                        ? {
                                            lat: selectedFinalMarker.lat,
                                            lng: selectedFinalMarker.lng,
                                        }
                                        : displaySub
                                            ? { lat: displaySub.lat, lng: displaySub.lng }
                                            : dummyPos
                            }
                            options={{ disableDefaultUI: true, gestureHandling: 'greedy' }}
                        >
                            {(displaySub || selectedSubmission || selectedFinalMarker) && (
                                <StreetViewPanorama
                                    key={panoramaKey}
                                    options={panoramaOptions}
                                    onLoad={(panorama) => {
                                        streetViewPanoramaRef.current = panorama;
                                        // Set POV immediately if we have optimal heading for category markers
                                        if (selectedFinalMarker && optimalHeading !== null) {
                                            setTimeout(() => {
                                                panorama.setPov({
                                                    heading: optimalHeading,
                                                    pitch: 0,
                                                });
                                            }, 100);
                                        }
                                    }}
                                />
                            )}
                        </GoogleMap>
                    </div>

                    <div className="glass-dark w-full !border-x-0 !border-b-0 border-t !border-t-indigo-400/40 rounded-none p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
                        {displaySub && !selectedSubmission && !selectedFinalMarker ? (
                            <VotingPanel displaySub={displaySub} activeSubLatest={activeSubLatest} votingStats={votingStats} yesVotes={yesVotes} noVotes={noVotes} hypeVotes={hypeVotes} hasHyped={hasHypedActive} players={players} playerId={playerId} teamMode={teamMode} scaleVoting={scaleVoting} onVote={handleVote} onHype={handleHype} onScaleVote={handleScaleVote} />
                        ) : selectedSubmission ? (
                            <div className="max-w-xl mx-auto">
                                <h3 className="text-xl sm:text-2xl font-black text-white mb-1 text-center truncate">{selectedSubmission.category}</h3>
                                <p className="text-sm text-indigo-300 mb-4 text-center uppercase tracking-widest font-semibold">{t('voting.submissionBy', { player: players.find((p) => p.id === selectedSubmission.player_id)?.name ?? '' })}</p>
                                <div className="mb-4 text-center">
                                    <div className="text-sm text-slate-400 mb-2">{t('voting.votingResults')}</div>
                                    <div className="flex gap-4 justify-center">
                                        {scaleVoting ? (
                                            <>
                                                <div className="text-indigo-300 font-bold">{t('voting.avgLabel', { value: tallyScale(selectedSubmission.votes).avg.toFixed(1) })}</div>
                                                <div className="text-indigo-400 font-bold">{t('voting.scaleSumLabel', { sum: tallyScale(selectedSubmission.votes).sum })}</div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="text-green-400 font-bold">{t('voting.yesLabel', { count: tallyVotes(selectedSubmission.votes).yes })}</div>
                                                <div className="text-red-400 font-bold">{t('voting.noLabel', { count: tallyVotes(selectedSubmission.votes).no })}</div>
                                                {tallyVotes(selectedSubmission.votes).hype > 0 && <div className="text-amber-400 font-bold">{t('voting.hypeLabel', { count: tallyVotes(selectedSubmission.votes).hype })}</div>}
                                            </>
                                        )}
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        setSelectedSubmission(null);
                                        setIsStreetViewVisible(false);
                                    }}
                                    className="glass press w-full py-4 rounded-xl font-black uppercase text-lg text-slate-300 hover:text-white transition-all"
                                >
                                    {t('voting.backToBoard')}
                                </button>
                            </div>
                        ) : selectedFinalMarker ? (
                            <div className="max-w-xl mx-auto">
                                <h3 className="text-xl sm:text-2xl font-black text-white mb-1 text-center truncate">{selectedFinalMarker.categoryNames.join(' • ')}</h3>
                                <p className="text-sm text-indigo-300 mb-4 text-center uppercase tracking-widest font-semibold">{t('voting.targetLocation')}</p>
                                <button
                                    onClick={() => {
                                        setSelectedFinalMarker(null);
                                        setIsStreetViewVisible(false);
                                    }}
                                    className="glass press w-full py-4 rounded-xl font-black uppercase text-lg text-slate-300 hover:text-white transition-all"
                                >
                                    {t('voting.backToBoard')}
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* BINGO BOARD CONTAINER */}
                <div className={`absolute inset-0 flex flex-col items-center justify-center p-8 z-20 transition-all duration-500 ease-in-out ${isStreetViewVisible ? 'opacity-0 -translate-x-12 pointer-events-none' : 'opacity-100 translate-x-0 pointer-events-auto'}`}>
                    <div className="text-center mb-8">
                        <h2 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-3xl font-black text-transparent tracking-widest">{t('voting.boardOf', { player: roundLabel })}</h2>
                    </div>

                    {submissions.filter((s) => roundPlayerIds.has(s.player_id)).length === 0 && <div className="glass-dark absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 p-6 rounded-2xl text-red-400 font-bold !border-red-500/50 text-center shadow-[0_0_30px_rgba(239,68,68,0.3)]">{t('voting.noSubmissionsForPlayer')}</div>}

                    <div
                        ref={categoryRef}
                        className="grid gap-3 flex-1 w-full"
                        style={{
                            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                            gridAutoFlow: gameMode === 'bingo' ? 'row' : 'column',
                        }}
                    >
                        {currentBoard?.map((category: string, idx: number) => {
                            const sub = submissions.find((s) => roundPlayerIds.has(s.player_id) && s.category === category);
                            const isReached = sub && shownSubIds.has(sub.id);
                            const hint = resolveHint(category, hintByCategory);

                            let yesPercent = 0;
                            let noPercent = 0;
                            let scalePercent = 0;
                            let scaleLabel: string | null = null;
                            let tileClass = 'glass-inset text-slate-500 opacity-70 [hyphens:auto] break-all';

                            if (sub) {
                                if (isReached) {
                                    if (scaleVoting) {
                                        const { avg, count } = tallyScale(sub.votes);
                                        if (count > 0) {
                                            scalePercent = (avg / 10) * 100;
                                            scaleLabel = avg.toFixed(1);
                                        }
                                    } else {
                                        const { yes, no } = tallyVotes(sub.votes);
                                        const total = yes + no;

                                        if (total > 0) {
                                            yesPercent = (yes / total) * 100;
                                            noPercent = (no / total) * 100;
                                        }
                                    }
                                    tileClass = 'glass text-white';
                                } else {
                                    tileClass = 'bg-indigo-600/30 border-indigo-400 text-indigo-100 shadow-[0_0_20px_rgba(99,102,241,0.35),inset_0_1px_0_rgba(255,255,255,0.2)]';
                                }
                            }

                            return (
                                <div key={`${currentRoundIndex}-${idx}`} className={`relative rounded-xl overflow-hidden flex items-center justify-center border-2 transition-colors duration-500 ${tileClass}`}>
                                    {scaleVoting ? (
                                        <div className="absolute left-0 top-0 bottom-0 bg-indigo-500/30 transition-all duration-700 ease-out" style={{ width: `${scalePercent}%` }}></div>
                                    ) : (
                                        <>
                                            <div className="absolute left-0 top-0 bottom-0 bg-green-500/30 transition-all duration-700 ease-out" style={{ width: `${yesPercent}%` }}></div>
                                            <div className="absolute right-0 top-0 bottom-0 bg-red-500/30 transition-all duration-700 ease-out" style={{ width: `${noPercent}%` }}></div>
                                        </>
                                    )}

                                    <span className="relative z-10 text-center font-bold text-sm sm:text-base px-2 drop-shadow-md">
                                        {category}
                                        {scaleLabel && <span className="ml-1.5 text-indigo-300 font-black">{scaleLabel}</span>}
                                    </span>
                                    {hint && (
                                        <div className="absolute top-1 right-1 z-20 group cursor-help">
                                            <FaInfoCircle className="text-white/60 hover:text-white text-[10px]" />
                                            <div className="glass-dark absolute bottom-full right-0 mb-2 hidden group-hover:block w-max max-w-[200px] text-white text-[10px] p-2 rounded-lg z-[100] whitespace-normal text-center cursor-default">
                                                <span className="font-bold text-indigo-300">{t('sv.tip')}</span> {hint}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
