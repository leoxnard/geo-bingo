'use client';


import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleMap, useJsApiLoader, StreetViewPanorama } from '@react-google-maps/api';
import { supabase } from '../lib/supabase';

const safeStartCenter = { lat: 48.137154, lng: 11.576124 }; 
const mapOptions = { streetViewControl: true, mapTypeControl: false, gestureHandling: 'greedy' };
const panoOptions = { 
  addressControl: false, 
  showRoadLabels: false, 
  enableCloseButton: true, 
  visible: false, // Start hidden so we don't block the map
  // position: safeStartCenter // COMMENTED OUT: Caused starting at Marienplatz every time
};

interface Submission {
  id: string; category: string; lat: number; lng: number; heading: number; pitch: number; zoom: number;
}
interface StreetViewProps {
  categories: string[]; gameId: string; playerId: string; 
  gameMode?: 'list' | 'bingo'; gridSize?: number;
}

export default function StreetView({ categories, gameId, playerId, gameMode = 'list', gridSize = 3 }: StreetViewProps) {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  });

  
  const [submittingCategory, setSubmittingCategory] = useState<string | null>(null);
  const [inStreetView, setInStreetView] = useState(false); 
  const [mySubmissions, setMySubmissions] = useState<Submission[]>([]);
  
  const streetViewRef = useRef<google.maps.StreetViewPanorama | null>(null);

  useEffect(() => {
    const fetchMySubmissions = async () => {
      const { data } = await supabase.from('submissions').select('*').eq('game_id', gameId).eq('player_id', playerId);
      if (data) setMySubmissions(data);
    };
    fetchMySubmissions();
  }, [gameId, playerId]);

  // useCallback prevents infinite loop spamming Google API!
  const onLoad = useCallback((pano: google.maps.StreetViewPanorama) => {
    streetViewRef.current = pano;
    pano.addListener('visible_changed', () => {
      setInStreetView(pano.getVisible());
    });
  }, []);

  const onUnmount = useCallback(() => {
    streetViewRef.current = null;
  }, []);

  const handleSubmit = async (targetCategory: string) => {
    if (!streetViewRef.current || !inStreetView) return;
    setSubmittingCategory(targetCategory);
    const position = streetViewRef.current.getPosition();
    const pov = streetViewRef.current.getPov();
    if (!position) { setSubmittingCategory(null); return; }

    const submissionData = {
      game_id: gameId, player_id: playerId, category: targetCategory,
      lat: parseFloat(position.lat().toFixed(6)), lng: parseFloat(position.lng().toFixed(6)),
      heading: parseFloat(pov.heading.toFixed(2)), pitch: parseFloat(pov.pitch.toFixed(2)),
      zoom: streetViewRef.current.getZoom() || 1
    };

    const existingSub = mySubmissions.find(s => s.category === targetCategory);
    if (existingSub) {
      await supabase.from('submissions').update(submissionData).eq('id', existingSub.id);
      setMySubmissions(prev => prev.map(s => s.id === existingSub.id ? { ...s, ...submissionData } : s));
    } else {
      const { data } = await supabase.from('submissions').insert([submissionData]).select().single();
      if (data) setMySubmissions(prev => [...prev, data]);
    }
    setSubmittingCategory(null);
  };

  const jumpToLocation = (sub: Submission) => {
    if (!streetViewRef.current) return;
    streetViewRef.current.setPosition({ lat: sub.lat, lng: sub.lng });
    streetViewRef.current.setPov({ heading: sub.heading, pitch: sub.pitch });
    streetViewRef.current.setZoom(sub.zoom);
    streetViewRef.current.setVisible(true);
    setInStreetView(true);
  };

  if (!isLoaded) return <div className="h-screen flex items-center justify-center text-blue-400">Loading Maps...</div>;

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-8rem)] min-h-[600px]">
      <div className="flex-1 min-h-[400px] h-full border-4 border-slate-700 rounded-2xl overflow-hidden shadow-2xl relative bg-slate-800 absolute-safari-fix">
        <GoogleMap key={gameId} mapContainerStyle={{ width: '100%', height: '100%' }} mapContainerClassName="w-full h-full absolute inset-0" center={safeStartCenter} zoom={12} options={mapOptions}>
          {/* Safely pass onLoad and onUnmount */}
          <StreetViewPanorama options={panoOptions} onLoad={onLoad} onUnmount={onUnmount} />
        </GoogleMap>
      </div>

      {/* Right: Checklist */}
      <div className="w-full lg:w-96 flex flex-col gap-4 bg-slate-800 p-6 rounded-2xl shadow-xl h-full border border-slate-700 overflow-y-auto">
        <h2 className="text-blue-400 font-bold text-xl mb-2 tracking-wide uppercase">
          {gameMode === 'bingo' ? 'Bingo Board' : 'Checklist'}
        </h2>
        
        {gameMode === 'list' ? (
          <ul className="flex flex-col gap-3 flex-1">
            {categories.map((cat) => {
              const foundSub = mySubmissions.find(s => s.category === cat);
              

              return (
                <li 
                  key={cat} 
                  className={`p-3 rounded-xl border-2 transition-all cursor-pointer flex flex-col gap-2
                    border-slate-600 bg-slate-800 hover:bg-slate-700`}
                >
                  <div className="flex flex-col overflow-hidden w-full">
                    <span className={`truncate font-medium ${foundSub ? 'text-slate-300' : 'text-white'}`}>
                      {cat}
                    </span>
                    <span className={`text-xs font-bold uppercase mt-1 ${foundSub ? 'text-green-500' : 'text-slate-500'}`}>
                      {foundSub ? 'Found' : 'Pending'}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center gap-2 mt-1">
                    {!foundSub ? (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                        disabled={submittingCategory === cat || !inStreetView}
                        className={`flex-1 text-[11px] px-2 py-2 font-bold rounded shadow uppercase transition-all
                          ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white'}`}
                      >
                        {submittingCategory === cat ? 'Saving...' : !inStreetView ? 'Enter Streetview' : 'Save'}
                      </button>
                    ) : (
                      <>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                          disabled={submittingCategory === cat || !inStreetView}
                          className={`flex-1 text-[10px] px-2 py-2 font-bold rounded shadow uppercase transition-all
                            ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
                        >
                           {submittingCategory === cat ? '...' : !inStreetView ? 'Enter SV' : 'Overwrite'}
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); jumpToLocation(foundSub); }}
                          className="flex-[0.5] bg-slate-600 hover:bg-slate-500 text-[10px] px-2 py-2 text-white font-bold rounded shadow uppercase"
                        >
                          View
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div 
            className="grid gap-2 flex-1 auto-rows-fr" 
            style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` }}
          >
            {categories.map((cat) => {
              const foundSub = mySubmissions.find(s => s.category === cat);
              

              return (
                <div 
                  key={cat} 
                  title={cat}
                  className={`relative p-2 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-center items-center text-center overflow-hidden pb-8
                    border-slate-600 bg-slate-800 hover:bg-slate-700
                    ${foundSub ? 'opacity-90' : ''}`}
                >
                  <span className={`text-[10px] sm:text-xs font-bold leading-tight line-clamp-2 break-words mt-1 ${foundSub ? 'text-green-400' : 'text-white'}`}>
                    {cat}
                  </span>

                  <div className="absolute bottom-1 w-[90%] left-[5%] flex gap-1 z-10">
                     {!foundSub ? (
                       <button 
                         onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                         disabled={submittingCategory === cat || !inStreetView}
                         className={`w-full text-[8px] py-1 font-bold rounded uppercase transition-all
                           ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-green-600 hover:bg-green-500 text-white'}`}
                       >
                         {submittingCategory === cat ? '...' : 'Save'}
                       </button>
                     ) : (
                       <>
                         <button 
                           onClick={(e) => { e.stopPropagation(); handleSubmit(cat); }}
                           disabled={submittingCategory === cat || !inStreetView}
                           className={`flex-1 text-[8px] py-1 font-bold rounded uppercase transition-all
                             ${!inStreetView ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
                         >
                           {submittingCategory === cat ? '...' : '+'}
                         </button>
                         <button 
                           onClick={(e) => { e.stopPropagation(); jumpToLocation(foundSub); }}
                           className="flex-1 bg-slate-600 hover:bg-slate-500 text-[8px] py-1 text-white font-bold rounded uppercase"
                         >
                           View
                         </button>
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
  );
}