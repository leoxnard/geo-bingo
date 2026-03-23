'use client';

import { useState, useEffect, useRef, useMemo, Fragment } from 'react';

import { GoogleMap, PolygonF, MarkerF, OverlayView, OverlayViewF } from '@react-google-maps/api';
import toast from 'react-hot-toast';
import { FaUndo, FaPlus, FaTimes } from "react-icons/fa";

import { FullscreenButton } from '../utils/Elements';
import { insertPoint, mapOptions } from '../utils/mapUtils';

const DEFAULT_CENTER = { lat: 20, lng: 0 };
const RECOMMENDED_STARTS = [
    { name: 'New York', lat: 40.7570095, lng: -73.9859724 },
    { name: 'Paris', lat: 48.853586, lng: 2.349171 },
    { name: 'Tokyo', lat: 35.658537, lng: 139.700240 }
];

interface Point {
    lat: number;
    lng: number;
}

interface BoundaryPolygon {
    id: string;
    type: 'allow' | 'forbid';
    points: Point[];
}

interface LobbyMapProps {
    isHost: boolean;
    isLoaded: boolean;
    startingPoint: string;
    gameBoundary: string | null;
    updateGameModeInfo: (updates: { starting_point?: string; gameBoundary?: string | null }) => void;
}

export default function LobbyMap({
    isHost,
    isLoaded,
    startingPoint,
    gameBoundary,
    updateGameModeInfo
}: LobbyMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [hoveredLocation, setHoveredLocation] = useState<Point | null>(null);
    const [activeBoundaryId, setActiveBoundaryId] = useState<string | null>(null);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    const actualStart = startingPoint || 'open-world';
    const hasFittedBounds = useRef(false);

    const additionalMapOptions = {
        streetViewControl: isHost,
        gestureHandling: isHost ? 'greedy' : 'none',
        draggableCursor: isHost ? 'crosshair' : 'default',
    };

    const draftBoundaries: BoundaryPolygon[] = useMemo(() => {
        if (!gameBoundary || gameBoundary === '[]') return [];
        try {
            const parsed = JSON.parse(gameBoundary);
            if (!Array.isArray(parsed)) return [];
            
            if (parsed.length > 0 && parsed[0].lat !== undefined && parsed[0].id === undefined) {
                return [{ id: 'legacy-1', type: 'allow', points: parsed }];
            }
            
            return parsed;
        } catch (e) {
            console.error("Invalid polygon data", e);
            return [];
        }
    }, [gameBoundary]);

    useEffect(() => {
        if (draftBoundaries.length > 0 && !activeBoundaryId) {
            setActiveBoundaryId(draftBoundaries[draftBoundaries.length - 1].id);
        } else if (draftBoundaries.length === 0) {
            setActiveBoundaryId(null);
        }
    }, [draftBoundaries, activeBoundaryId]);

    useEffect(() => {
        if (!mapInstance || typeof window === 'undefined' || !window.google) return;
        
        const allPoints = draftBoundaries.flatMap(b => b.points);

        if (allPoints.length >= 3) {
            if (allPoints.length === 3 || !hasFittedBounds.current) {
                const bounds = new window.google.maps.LatLngBounds();
                allPoints.forEach(point => bounds.extend(point));
                
                mapInstance.fitBounds(bounds);
                
                const currentZoom = mapInstance.getZoom();
                if (currentZoom && currentZoom > 18) {
                    mapInstance.setZoom(18);
                }
                
                hasFittedBounds.current = true;
            }
        } else {
            hasFittedBounds.current = false;
        }
    }, [draftBoundaries, mapInstance]);

    useEffect(() => {
        if (!mapInstance || !isHost) return;
        const sv = mapInstance.getStreetView();
        
        const listener = google.maps.event.addListener(sv, 'position_changed', () => {
            const pos = sv.getPosition();
            
            if (pos) {
                updateGameModeInfo({
                    starting_point: JSON.stringify({ lat: pos.lat(), lng: pos.lng() }),
                });
                
                sv.setVisible(false);
            }
        });

        const visibleListener = google.maps.event.addListener(sv, 'visible_changed', () => {
            if (sv.getVisible()) {
                setTimeout(() => {
                    sv.setVisible(false);
                }, 50);
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

        let newBoundaries = [...draftBoundaries];
        
        if (newBoundaries.length === 0) {
            const newId = Date.now().toString();
            newBoundaries = [{ id: newId, type: 'allow', points: [newPoint] }];
            setActiveBoundaryId(newId);
        } else {
            const targetId = activeBoundaryId || newBoundaries[newBoundaries.length - 1].id;
            newBoundaries = newBoundaries.map(b => {
                if (b.id === targetId) {
                    return { ...b, points: insertPoint(newPoint, b.points) };
                }
                return b;
            });
        }
        
        updateGameModeInfo({ gameBoundary: JSON.stringify(newBoundaries) });
    };

    const handleAddBoundary = () => {
        const newId = Date.now().toString();
        const newBoundaries = [...draftBoundaries, { id: newId, type: 'allow', points: [] }];
        updateGameModeInfo({ gameBoundary: JSON.stringify(newBoundaries) });
        setActiveBoundaryId(newId);
    };

    const handleRemoveBoundary = (id: string) => {
        const newBoundaries = draftBoundaries.filter(b => b.id !== id);
        updateGameModeInfo({ gameBoundary: JSON.stringify(newBoundaries) });
        if (activeBoundaryId === id) {
            setActiveBoundaryId(newBoundaries.length > 0 ? newBoundaries[newBoundaries.length - 1].id : null);
        }
    };

    const handleToggleType = (id: string) => {
        const newBoundaries = draftBoundaries.map(b => {
            if (b.id === id) {
                return { ...b, type: b.type === 'allow' ? 'forbid' : 'allow' };
            }
            return b;
        });
        updateGameModeInfo({ gameBoundary: JSON.stringify(newBoundaries) });
    };

    const handleDrop = (dropIndex: number) => {
        if (draggedIndex === null || draggedIndex === dropIndex) return;
        
        const newBoundaries = [...draftBoundaries];
        const [draggedItem] = newBoundaries.splice(draggedIndex, 1);
        newBoundaries.splice(dropIndex, 0, draggedItem);
        
        updateGameModeInfo({ gameBoundary: JSON.stringify(newBoundaries) });
        setDraggedIndex(null);
    };

    return (
        <div className="bg-slate-800 p-6 rounded-xl flex-1 border border-slate-700 h-fit">
            <label className="block font-bold cursor-pointer text-slate-200 mb-2">
                Starting Location & Game Boundary
            </label>
            <p className="text-xs text-slate-400 mb-4">
                Left-click the map to draw movement boundaries. Drop the Pegman to set a custom starting point, or select a recommended city marker.
            </p>

            <div className="mt-4 flex flex-col gap-2">
                <div className="h-[400px] min-h-[400px] w-full rounded-lg overflow-hidden border border-slate-700 relative bg-slate-800/50 flex flex-col items-center justify-center">
                    {!isLoaded ? (
                        <div className="text-slate-400">Loading map configuration...</div>
                    ) : (
                        <div ref={containerRef} className="absolute inset-0 w-full h-full">
                            <GoogleMap
                                onLoad={setMapInstance}
                                mapContainerStyle={{ width: '100%', height: '100%' }}
                                center={DEFAULT_CENTER}
                                zoom={2}
                                onClick={handleMapClick}
                                options={mapOptions(additionalMapOptions)}
                            >
                                {RECOMMENDED_STARTS.map(loc => (
                                    <MarkerF
                                        key={loc.name}
                                        position={{ lat: loc.lat, lng: loc.lng }}
                                        onClick={() => isHost && updateGameModeInfo({
                                            starting_point: JSON.stringify({ lat: loc.lat, lng: loc.lng }),
                                            gameBoundary: JSON.stringify(draftBoundaries)
                                        })}
                                        onMouseOver={() => setHoveredLocation({ lat: loc.lat, lng: loc.lng })}
                                        onMouseOut={() => setHoveredLocation(null)}
                                        options={{
                                            opacity: actualStart.includes(loc.name) ? 1 : 0.4,
                                            icon: {
                                                path: google.maps.SymbolPath.CIRCLE,
                                                scale: 7,
                                                fillColor: actualStart.includes(loc.name) ? '#4f46e5' : '#ffffff',
                                                fillOpacity: 1,
                                                strokeColor: '#4f46e5',
                                                strokeWeight: 2,
                                            }
                                        }}
                                    />
                                ))}

                                {actualStart.startsWith('{') && (
                                    <MarkerF
                                        position={JSON.parse(actualStart)}
                                        onMouseOver={() => setHoveredLocation(JSON.parse(actualStart))}
                                        onMouseOut={() => setHoveredLocation(null)}
                                        options={{
                                            icon: {
                                                path: google.maps.SymbolPath.CIRCLE,
                                                scale: 8,
                                                fillColor: '#10b981',
                                                fillOpacity: 1,
                                                strokeColor: '#059669',
                                                strokeWeight: 2,
                                            }
                                        }}
                                    />
                                )}

                                {hoveredLocation && (
                                    <OverlayViewF
                                        position={hoveredLocation}
                                        mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                                        getPixelPositionOffset={(width, height) => ({
                                            x: -(width / 2),
                                            y: -(height + 10)
                                        })}
                                    >
                                        <div className="p-1 pointer-events-none">
                                            <img
                                                src={`https://maps.googleapis.com/maps/api/streetview?size=240x120&location=${hoveredLocation.lat},${hoveredLocation.lng}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`}
                                                alt="Street View Preview"
                                                className="w-[240px] h-[120px] rounded object-cover"
                                            />
                                        </div>
                                    </OverlayViewF>
                                )}

                                {draftBoundaries.map((boundary) => (
                                    <Fragment key={boundary.id}>
                                        {boundary.points.length > 0 && (
                                            <PolygonF
                                                paths={boundary.points}
                                                options={{
                                                    fillOpacity: 0.1,
                                                    fillColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                                                    strokeColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                                                    strokeOpacity: 0.6,
                                                    strokeWeight: activeBoundaryId === boundary.id ? 4 : 2,
                                                    clickable: false,
                                                }}
                                            />
                                        )}

                                        {boundary.points.map((point, idx) => (
                                            <MarkerF
                                                key={`poly-${boundary.id}-${idx}`}
                                                position={point}
                                                options={{
                                                    clickable: false,
                                                    icon: {
                                                        path: google.maps.SymbolPath.CIRCLE,
                                                        scale: 4,
                                                        fillColor: '#ffffff',
                                                        fillOpacity: 1,
                                                        strokeColor: boundary.type === 'allow' ? '#008000' : '#ff0000',
                                                        strokeWeight: 2,
                                                    }
                                                }}
                                            />
                                        ))}
                                    </Fragment>
                                ))}
                            </GoogleMap>
                            <FullscreenButton isFullscreen={isFullscreen} containerRef={containerRef} setIsFullscreen={setIsFullscreen} />
                        </div>
                    )}
                </div>
                
                {isHost && (
                    <div className="flex flex-col gap-4 mt-2">
                        <div className="flex flex-col sm:flex-row justify-between items-center w-full text-sm text-slate-400 gap-2">
                            <button type="button"
                                onClick={() => updateGameModeInfo({ starting_point: 'open-world' })}
                                disabled={actualStart === 'open-world'}
                                className="px-3 py-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 rounded flex gap-2 items-center transition-colors disabled:opacity-50 disabled:bg-slate-800 disabled:border-slate-700 disabled:text-slate-500"
                            >
                                Reset Starting Point
                            </button>

                            <div className="flex gap-2 flex-wrap justify-end">
                                <button 
                                    type="button" 
                                    onClick={handleAddBoundary}
                                    className="px-3 py-2 bg-emerald-900/60 border border-emerald-700 hover:bg-emerald-800 text-emerald-100 rounded flex gap-2 items-center transition-colors"
                                >
                                    <FaPlus /> Add Area
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => updateGameModeInfo({ gameBoundary: '[]' })}
                                    disabled={draftBoundaries.length === 0}
                                    className="px-3 py-2 bg-rose-900 border border-rose-700 hover:bg-rose-800 text-slate-200 rounded flex gap-2 items-center transition-colors disabled:opacity-50"
                                >
                                    Reset Areas
                                </button>
                            </div>
                        </div>
                        {draftBoundaries.length > 0 && (
                            <div className="flex flex-col gap-2 pr-2">
                                {draftBoundaries.length > 0 && (
                                    <div className="flex flex-col gap-2 pr-2">
                                        {draftBoundaries.map((b, index) => (
                                            <div 
                                                key={b.id} 
                                                draggable
                                                onDragStart={() => setDraggedIndex(index)}
                                                onDragOver={(e) => {
                                                    e.preventDefault(); // Nötig, um Drop zuzulassen
                                                }}
                                                onDrop={() => handleDrop(index)}
                                                className={`flex items-center justify-between p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-all ${
                                                    draggedIndex === index ? 'opacity-50 scale-95 border-dashed' : ''
                                                } ${activeBoundaryId === b.id ? 'border-indigo-500 bg-indigo-900/40' : 'border-slate-700 bg-slate-800 hover:border-slate-500'}`} 
                                                onClick={() => setActiveBoundaryId(b.id)}
                                            >
                                                <div className="flex items-center gap-4">
                                                    <span className="text-slate-500 cursor-grab px-1 text-lg">⋮⋮</span>
                                                    <span className="text-slate-200 font-medium text-sm flex flex-col">
                                                        <span>Area {index + 1}</span>
                                                        <span className="text-[10px] text-slate-500 font-normal">
                                                            {index === draftBoundaries.length - 1 ? 'Highest Priority' : 
                                                                index === 0 ? 'Lowest Priority' : `Priority ${index + 1}`}
                                                        </span>
                                                    </span>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleToggleType(b.id); }} 
                                                        className={`px-3 py-1 rounded text-xs font-bold transition-colors ${b.type === 'allow' ? 'bg-green-600/20 text-green-400 border border-green-700 hover:bg-green-600/40' : 'bg-red-600/20 text-red-400 border border-red-700 hover:bg-red-600/40'}`}
                                                    >
                                                        {b.type === 'allow' ? 'Allow' : 'Forbid'}
                                                    </button>
                                                </div>
                                                <button
                                                    title='remove-boundary'
                                                    onClick={(e) => { e.stopPropagation(); handleRemoveBoundary(b.id); }} 
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
                )}
            </div>
        </div>
    );
}