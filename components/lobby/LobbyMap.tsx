'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleMap, PolygonF, MarkerF, OverlayView, OverlayViewF } from '@react-google-maps/api';
import { FaUndo } from "react-icons/fa";
import { insertPoint, mapOptions } from '../utils/mapUtils';
import { FullscreenButton } from '../utils/Elements';

const DEFAULT_CENTER = { lat: 20, lng: 0 };
const RECOMMENDED_STARTS = [
    { name: 'New York', lat: 40.7570095, lng: -73.9859724 },
    { name: 'Paris', lat: 48.853586, lng: 2.349171 },
    { name: 'Tokyo', lat: 35.658537, lng: 139.700240 }
];

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
    const [hoveredLocation, setHoveredLocation] = useState<{ lat: number; lng: number } | null>(null);

    const actualStart = startingPoint || 'open-world';
    const hasFittedBounds = useRef(false);

    const additionalMapOptions = {
        streetViewControl: isHost,
        gestureHandling: isHost ? 'greedy' : 'none',
        draggableCursor: isHost ? 'crosshair' : 'default',
    };

    // Parse polygon points from gameBoundary
    const draftPolygonPoints = useMemo(() => {
        if (!gameBoundary || gameBoundary === '[]') return [];
        try {
            const points = JSON.parse(gameBoundary);
            return Array.isArray(points) ? points : [];
        } catch (e) {
            console.error("Invalid polygon data", e);
            return [];
        }
    }, [gameBoundary]);

    // Auto-zoom and center when polygon changes
    useEffect(() => {
        if (!mapInstance || typeof window === 'undefined' || !window.google) return;
        
        if (draftPolygonPoints.length >= 3) {
            // Snap the camera if we just hit 3 points, OR if the map just loaded with an existing polygon
            if (draftPolygonPoints.length === 3 || !hasFittedBounds.current) {
                const bounds = new window.google.maps.LatLngBounds();
                draftPolygonPoints.forEach(point => bounds.extend(point));
                
                mapInstance.fitBounds(bounds);
                
                const currentZoom = mapInstance.getZoom();
                if (currentZoom && currentZoom > 18) {
                    mapInstance.setZoom(18);
                }
                
                hasFittedBounds.current = true;
            }
        } else {
            // Reset the flag if the area is cleared
            hasFittedBounds.current = false;
        }
    }, [draftPolygonPoints, mapInstance]);

    // Intercept Pegman Drop
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
                                onClick={(e) => {
                                    if (!isHost || !e.latLng) return;
                                    const newPoint = { lat: e.latLng.lat(), lng: e.latLng.lng() };
                                    const newPoints = insertPoint(newPoint, draftPolygonPoints);
                                    updateGameModeInfo({ gameBoundary: JSON.stringify(newPoints) });
                                }}
                                options={mapOptions(additionalMapOptions)}
                            >
                                {RECOMMENDED_STARTS.map(loc => (
                                    <MarkerF
                                        key={loc.name}
                                        position={{ lat: loc.lat, lng: loc.lng }}
                                        onClick={() => isHost && updateGameModeInfo({
                                            starting_point: JSON.stringify({ lat: loc.lat, lng: loc.lng }),
                                            gameBoundary: JSON.stringify(draftPolygonPoints)
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
                                        // This acts exactly like your pixelOffset: Size(0, -40)
                                        // It centers the box horizontally and pushes it up 40px
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

                                {draftPolygonPoints.length > 0 && (
                                    <PolygonF
                                        paths={draftPolygonPoints}
                                        options={{
                                            fillOpacity: 0.35,
                                            fillColor: '#6366f1',
                                            strokeColor: '#4f46e5',
                                            strokeOpacity: 0.8,
                                            strokeWeight: 2,
                                            clickable: false,
                                        }}
                                    />
                                )}

                                {draftPolygonPoints.map((point, idx) => (
                                    <MarkerF
                                        key={`poly-${idx}`}
                                        position={point}
                                        options={{
                                            clickable: false,
                                            icon: {
                                                path: google.maps.SymbolPath.CIRCLE,
                                                scale: 4,
                                                fillColor: '#ffffff',
                                                fillOpacity: 1,
                                                strokeColor: '#4f46e5',
                                                strokeWeight: 2,
                                            }
                                        }}
                                    />
                                ))}
                            </GoogleMap>
                            <FullscreenButton isFullscreen={isFullscreen} containerRef={containerRef} setIsFullscreen={setIsFullscreen} />
                        </div>
                    )}
                </div>
                
                {isHost && (
                    <div className="flex flex-col sm:flex-row justify-between items-center w-full text-sm text-slate-400 gap-2 mt-2">
                        <button type="button"
                            onClick={() => updateGameModeInfo({ starting_point: 'open-world' })}
                            disabled={actualStart === 'open-world'}
                            className="px-3 py-1 bg-indigo-900 border border-indigo-700 hover:bg-indigo-800 text-slate-200 rounded flex gap-2 items-center transition-colors disabled:opacity-50 disabled:bg-slate-800 disabled:border-slate-700 disabled:text-slate-500"
                        >
                            Reset Start
                        </button>

                        <div className="flex gap-2">
                            <button 
                                type="button" 
                                onClick={() => {
                                    if (draftPolygonPoints.length === 0) return;
                                    // Create the new state by removing the last point
                                    const newPoints = draftPolygonPoints.slice(0, -1);
                                    // Sync to parent
                                    updateGameModeInfo({ gameBoundary: JSON.stringify(newPoints) });
                                }}
                                disabled={draftPolygonPoints.length === 0}
                                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex gap-2 items-center transition-colors disabled:opacity-50 border border-slate-700"
                            >
                                <FaUndo /> Undo Point
                            </button>
                            <button 
                                type="button"
                                onClick={() => {
                                    updateGameModeInfo({ gameBoundary: '[]' });
                                }}
                                disabled={draftPolygonPoints.length === 0}
                                className="px-3 py-1 bg-rose-900 border border-rose-700 hover:bg-rose-800 text-slate-200 rounded flex gap-2 items-center transition-colors disabled:opacity-50"
                            >
                                Reset Area
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}