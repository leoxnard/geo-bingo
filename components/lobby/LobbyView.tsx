'use client';

import { useState } from 'react';

import { GoogleMap, useJsApiLoader, Circle, Marker } from '@react-google-maps/api';

import Image from 'next/image';
import toast from 'react-hot-toast';

import LobbyCategories from './LobbyCategories';
import LobbyMap from './LobbyMap';
import LobbySettings from './LobbySettings';
import LobbySidebar from './LobbySidebar';
import { isLocationAllowed } from '../utils/mapUtils';
import { shuffle, getGridLocations, getDistance } from '../utils/Functions';

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
}

type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

export interface BingoCategory {
    categoryName: string;
    matchedPlaces: {
        name: string;
        lat: number;
        lng: number;
    }[];
}

interface LobbyViewProps {
    lastUpdated: string;
    gameMode: 'list' | 'bingo';
    teamMode: 'ffa' | 'teams';
    startingPoint: string;
    endCondition: 'first_bingo' | 'timer';
    gameBoundary: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateGameModeInfo: (updates: any) => void;
    isHost: boolean;
    gridSize: number;
    timeLimit: number;
    exclusiveMode: boolean;
    categories: string[];
    suggestedCategories: string[];
    gameId: string;
    players: Player[];
    onlinePlayers: string[];
    playerId: string;
    gameHostId: string;
    makeHost: (id: string) => void;
    kickPlayer: (id: string) => void;
    banPlayer: (id: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    updateStatus: (nextStatus: GameStatus) => Promise<void>;
    setPlayers: (players: Player[] | ((prev: Player[]) => Player[])) => void;
    hideMapSymbols: boolean;
    fastVoting: boolean;
    categorySource: 'manual' | 'nearbyPlaces' | 'nearbyStreetView';
    generationRadius: number;
    generationNumber: number;
}

export default function LobbyView(props: LobbyViewProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [libraries] = useState<("places" | "geometry")[]>(['places', 'geometry']);
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries
    });

    const MAXGRIDSIZE = 6;

    const DEBUG = true;
    const [debugPlaces, setDebugPlaces] = useState<any[]>([]);
    const [debugCenter, setDebugCenter] = useState<{lat: number, lng: number} | null>(null);
    const [debugRadius, setDebugRadius] = useState<number>(0);
    const [debugSubRadius, setDebugSubRadius] = useState<number>(0);
    const [debugSearchCenters, setDebugSearchCenters] = useState<{lat: number, lng: number}[]>([]);

    // Street-View-based category generation using Gemini Vision API
    const generateStreetViewCategoriesAI = async (startPos: { lat: number, lng: number }, radius: number, requiredCount: number): Promise<BingoCategory[]> => {
        try {
            const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
            const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
            if (!googleApiKey || !geminiApiKey) throw new Error("API Keys missing!");

            const radiusMeters = radius * 100;

            const getRandomLocation = (center: {lat: number, lng: number}, radMeters: number) => {
                const r = radMeters * Math.sqrt(Math.random());
                const theta = Math.random() * 2 * Math.PI;
                const dx = r * Math.cos(theta);
                const dy = r * Math.sin(theta);
                const lat = center.lat + (dy / 111320);
                const lng = center.lng + (dx / (111320 * Math.cos(center.lat * Math.PI / 180)));
                return { lat, lng };
            };

            const validImages: { id: string, lat: number, lng: number, base64: string }[] = [];
            const seenImages = new Set<string>(); // NEU: Speichert die base64-Strings zur Duplikat-Prüfung
            const maxAttempts = requiredCount * 10; 
            let fetchCount = 0;

            for (let i = 0; i < maxAttempts; i++) {
                if (validImages.length >= requiredCount * 1.5) break; 
                
                const loc = getRandomLocation(startPos, radiusMeters);

                const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${loc.lat},${loc.lng}&source=outdoor&key=${googleApiKey}`;
                
                try {
                    const metaRes = await fetch(metaUrl);
                    const metaData = await metaRes.json();

                    if (metaData.status === "OK" && metaData.location) {
                        const exactLat = metaData.location.lat;
                        const exactLng = metaData.location.lng;

                        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${exactLat},${exactLng}&result_type=street_address|route&key=${googleApiKey}`;
                        const geoRes = await fetch(geoUrl);
                        const geoData = await geoRes.json();

                        if (geoData.status === "OK" && geoData.results.length > 0) {
                            
                            const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${exactLat},${exactLng}&fov=120&source=outdoor&key=${googleApiKey}`;
                            
                            const res = await fetch(svUrl);
                            if (res.ok) {
                                const blob = await res.blob();
                                const base64 = await new Promise<string>((resolve, reject) => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => {
                                        const result = reader.result as string;
                                        resolve(result.split(',')[1]);
                                    };
                                    reader.onerror = reject;
                                    reader.readAsDataURL(blob);
                                });
                                
                                if (!seenImages.has(base64)) {
                                    seenImages.add(base64);
                                    validImages.push({ 
                                        id: `img_${fetchCount}`, 
                                        lat: exactLat, 
                                        lng: exactLng, 
                                        base64 
                                    });
                                    fetchCount++;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("Error fetching Street View/Geocoding data:", e);
                }
            }

            if (validImages.length < requiredCount) {
                throw new Error(`Nicht genug echte Straßen-Bilder in diesem Bereich gefunden (${validImages.length}/${requiredCount}). Bitte wähle einen größeren Radius.`);
            }

            const parts: any[] = [
                { text: `Du bist der Game-Master für das Spiel "GeoBingo".
Deine Mission: Finde in den folgenden Street-View-Bildern besonders interessante, einzigartige oder kuriose Details, die Spieler in echt suchen sollen.

Du erhältst ${validImages.length} Bilder. Jedes Bild ist mit einer "Bild-ID" markiert.
Suche dir möglichst viele Merkmale aus den Bildern heraus und benenne das besondere Merkmal in 1 bis maximal 2 Wörtern (auf Deutsch), vermeide räumliche Beschreibungen (z.B. "gestapelt", "nebeneinander"). 
Nenne Eigennamen nur, wenn sie von aussen klar erkennbar sind und nicht zu einzigartig sind (z.B. "EDEKA" ist gut aber "Frauenkirche" nicht, da man den Namen nicht direkt am Gebäude erkennen kann). Es sollte dann aber verständlich sein, was genau gesucht ist (z.B. "Samsonite Koffer" statt "Samsonite").
Bewerte jedes gefundene Merkmal mit einem "interestScore" von 1 bis 100, um zu zeigen, wie interessant es für das Spiel ist und wie sicher du dir bist, dass es im Bild zu sehen ist:
- Hoher Score (80-100): spezielle/kuriose Fahrzeuge (z.B. Oldtimer, Traktor), einmalige Architektur, besondere Statuen/Kunstwerke, Musiker, auffälliges Graffiti, ungewöhnliche Straßenszenen, Tiere.
- Mittlerer Score (40-79): Spezifische Läden, Verkehrsschilder, auffällige Schaufenster, besondere Türen, Menschen mit erkennbaren Merkmalen (z.B. bunte Kleidung, Fahrradfahrer), interessante Pflanzen oder Bäume.
- Niedriger Score (1-39): Normale Autos, generische Hotel- oder Firmenschilder, Ampeln, zu kleine Details, die schwer zu erkennen sind oder auch Begriffe mit denen man nicht sicher ist was gemeint ist (z.B. "Reifen", "Holz").

WICHTIG: Erfinde nichts! Das Merkmal muss ZWEIFELSFREI im Bild erkennbar sein. Wenn du erkennst, dass das Bild ein indoor-Bild ist, gebe ihm ein score von 0!

Antworte AUSSCHLIESSLICH mit einem validen JSON-Array in diesem Format, ohne Markdown drumherum:
[
  {
    "categoryName": "Das gefundene Merkmal (z.B. Katze)",
    "imageId": "Die exakte Bild-ID aus dem Prompt",
    "interestScore": 95
  }
]` }
            ];

            validImages.forEach(img => {
                parts.push({ text: `Bild-ID: ${img.id}` });
                parts.push({
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: img.base64
                    }
                });
            });

            const geminiModels = ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite'];
            let aiResponse;
            let currentModelIndex = 0;

            while (currentModelIndex < geminiModels.length) {
                try {
                    aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModels[currentModelIndex]}:generateContent?key=${geminiApiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts }],
                            generationConfig: {
                                responseMimeType: "application/json",
                            }
                        })
                    });

                    if (!aiResponse.ok) throw new Error("API Error");
                    break;
                } catch (error) {
                    currentModelIndex++;
                }
            }

            if (!aiResponse || !aiResponse.ok) {
                throw new Error("Failed to get a response from Gemini Vision API.");
            }

            const aiData = await aiResponse.json();
            let aiTextResponse = aiData.candidates[0].content.parts[0].text;
            aiTextResponse = aiTextResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedItems = JSON.parse(aiTextResponse);

            if (!Array.isArray(parsedItems) || parsedItems.length < requiredCount) {
                throw new Error(`AI returned invalid format or fewer targets than required!`);
            }

            const finalCategories: BingoCategory[] = parsedItems
                .map((item: { categoryName: string, imageId: string, interestScore: number }) => {
                    const sourceImg = validImages.find(img => img.id === item.imageId);
                    if (!sourceImg) return null;

                    return {
                        categoryName: item.categoryName,
                        interestScore: item.interestScore || 0,
                        matchedPlaces: [{
                            name: item.categoryName,
                            lat: sourceImg.lat,
                            lng: sourceImg.lng
                        }]
                    };
                })
                .filter((item): item is (BingoCategory & { interestScore: number }) => item !== null)
                .filter((cat, index, self) => index === self.findIndex(c => 
                    c.categoryName.toLowerCase().trim() === cat.categoryName.toLowerCase().trim()
                ))
                .sort((a, b) => b.interestScore - a.interestScore)
                .slice(0, requiredCount)
                .map(cat => ({
                    categoryName: cat.categoryName,
                    matchedPlaces: cat.matchedPlaces
                }))
                .filter((cat, index, self) => index === self.findIndex(c => c.categoryName === cat.categoryName));

            if (finalCategories.length < requiredCount) {
                throw new Error("Could not map all generated targets to images. Please try again.");
            }

            return finalCategories;

        } catch (error) {
            console.error("Error during Street View generation:", error);
            throw new Error("Error analyzing Street View images.");
        }
    };

    const generateCategoriesAI = async (startPos: { lat: number, lng: number }, radius: number, requiredCount: number): Promise<BingoCategory[]> => {
        try {
            const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
            if (!googleApiKey) throw new Error("Google Maps API Key is missing!");
            
            const radiusMeters = radius * 100;
            const { points: gridPoints, subRadiusMeters } = getGridLocations(startPos.lat, startPos.lng, radiusMeters);

            setDebugCenter(startPos);
            setDebugRadius(radius);
            setDebugSearchCenters(gridPoints.map(p => ({ lat: p.lat, lng: p.lng })));
            setDebugSubRadius(subRadiusMeters);

            const url = 'https://places.googleapis.com/v1/places:searchNearby';

            const typeGroups = [
                {
                    // 1. Common Essentials
                    name: 'daily_essentials',
                    types: ['bakery', 'cafe', 'restaurant', 'supermarket']
                },
                {
                    // 2. Common Services
                    name: 'neighborhood_services',
                    types: ['pharmacy', 'bank', 'post_office', 'shopping_mall', 'hotel', 'playground']
                },
                {
                    // 3. Ordinary Urban Features
                    name: 'urban_navigation',
                    types: ['park', 'transit_station', 'taxi_stand', 'plaza', 'fountain', 'monument', 'bridge']
                },
                {
                    // 4. Rare Cultural & Architectural Highlights
                    name: 'culture_and_spirit',
                    types: [
                        'library', 'museum', 'art_gallery', 'church', 
                        'sculpture', 'performing_arts_theater', 'university', 'historical_place'
                    ]
                },
                {
                    // 5. Extremely Rare & Unique Landmarks
                    name: 'grand_and_specialized',
                    types: [
                        'city_hall', 'courthouse', 'embassy', 'castle', 'stadium', 
                        'airport', 'ferry_terminal', 'fire_station', 'zoo', 
                        'botanical_garden', 'beach', 'historical_landmark', 
                        'tourist_attraction', 'synagogue', 'mosque', 'shinto_shrine', 
                        'buddhist_temple', 'casino', 'amphitheatre'
                    ]
                }
            ];

            const fetchSingleTypeAtLocation = async (group: { name: string; types: string[] }, searchCenter: {lat: number, lng: number}) => {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': googleApiKey,
                        'X-Goog-FieldMask': 'places.id,places.displayName.text,places.location,places.formattedAddress'
                    },
                    body: JSON.stringify({
                        includedTypes: group.types,
                        maxResultCount: 5,
                        locationRestriction: {
                            circle: {
                                center: { latitude: searchCenter.lat, longitude: searchCenter.lng },
                                radius: subRadiusMeters 
                            }
                        }
                    })
                });

                if (!response.ok) return []; 
                const data = await response.json();
                
                return data.places 
                    ? (data.places as any[]).map(p => ({
                        id: p.id,
                        name: p.displayName?.text,
                        address: p.formattedAddress,
                        lat: p.location?.latitude,
                        lng: p.location?.longitude
                    })).filter(p => Boolean(p.name && p.id)) 
                    : [];
            };

            const searchPromises: Promise<any[]>[] = [];
            gridPoints.forEach(point => {
                typeGroups.forEach(group => {
                    searchPromises.push(fetchSingleTypeAtLocation(group, point));
                });
            });

            const resultsArray = await Promise.all(searchPromises);
            const allPlaces = resultsArray.flat();

            const uniquePlacesMap = new Map();
            const seenNames = new Set();
            
            allPlaces.forEach(place => {
                const normalizedName = place.name.trim().toLowerCase();
                
                const isTooClose = Array.from(uniquePlacesMap.values()).some((existingPlace: any) => {
                    const dist = getDistance(place.lat, place.lng, existingPlace.lat, existingPlace.lng);
                    return dist < 15;
                });

                if (!uniquePlacesMap.has(place.id) && !seenNames.has(normalizedName) && !isTooClose) {
                    uniquePlacesMap.set(place.id, place);
                    seenNames.add(normalizedName);
                }
            });

            const uniquePlaces = Array.from(uniquePlacesMap.values());
            const shuffledPlaces = shuffle(uniquePlaces);
            
            setDebugPlaces(shuffledPlaces);
            setDebugCenter(startPos);
            setDebugRadius(radius);

            if (shuffledPlaces.length < requiredCount) {
                throw new Error(`Not enough places found within the specified radius (${shuffledPlaces.length}/${requiredCount}).`);
            }

            const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
            if (!geminiApiKey) throw new Error("Gemini API Key is missing!");

            const uniquePlacesForLLM = uniquePlaces.map(p => ({
                id: p.id,
                name: p.name,
            }));

            const cityCountry = shuffledPlaces[0].address?.split(',').slice(-2).join(',').trim() || shuffledPlaces[0].address;

            const promptDE = `
Du bist der Game-Master für das Spiel "GeoBingo". Deine Mission: Erstelle einen perfekten Mix aus Alltagsgegenständen und architektonischen Highlights basierend auf echten Kartendaten.

### ORTSANGABE
${cityCountry}

### INPUT-DATEN
${JSON.stringify(uniquePlacesForLLM)}

### DEINE AUFGABE
Analysiere die Input-Daten und generiere daraus exakt ${requiredCount} Bingo-Kategorien. Antworte AUSSCHLIESSLICH mit einem validen JSON-Array.

### DER "PERFEKTE MIX"
Deine Kategorien müssen sich aus diesen zwei Welten zusammensetzen (ca. 50/50):
1. **DIE KLASSIKER (Alltag):** Banale, urbane Dinge, die man bei den gegebenen Orten findet (z. B. typische Supermarkt-Ketten, Sitzgelegenheiten, Infrastruktur).
2. **DIE HIGHLIGHTS (Einzigartig):** Besondere Orte, welche die Stadt besonders auszeichnet (z. B. historische Gebäude, kulturelle Einrichtungen, Denkmal).
WICHTIG: Die Beispiele in Klammern dienen nur zur Erklärung. ÜBERNIMM SIE NICHT WÖRTLICH, sondern erfinde eigene, die exakt zu den Input-Daten passen!

### REGEL-HIERARCHIE

#### 1. Realismus & Visuelle Beweisbarkeit (Street-View-Regel)
* **KEINE Halluzinationen:** Zwinge den Orten keine Merkmale auf, die sie nicht haben. Erfinde keine "Glas-Kuppeln" oder "Surfer", wenn diese nicht zweifelsfrei sichtbar sind.
* Jeder Begriff muss von der Straße aus für einen Fußgänger ZWEIFELSFREI sichtbar sein. Nutze Eigennamen nur, wenn sie von aussen klar erkennbar sind (z. B. "EDEKA" ist okay aber "Frauenkirche" nicht).
* Nutze spezifische visuelle Merkmale bei gängigen Orten (z. B. "Rabatt-Schild" statt nur "Aldi") aber nutze Oberkategorien bei spezifischen Orten (z. B. "Kirchen-Uhr" statt "Frauenkirche").

#### 2. Sprache & Verständlichkeit
* **Kürze:** Formuliere die 'categoryName' in 1 bis maximal 3 Wörtern (z. B. "Rundbogen-Tür", "Discounter-Logo", "Kirchen-Uhr").
* **Deutsch:** Antworte komplett auf Deutsch.
* **Klarheit:** Der Spieler muss ohne Kontext sofort wissen, was er fotografieren soll.

#### 3. Formale Strenge
* **Vielfalt:** Keine doppelten oder extrem ähnlichen Kategorien (nicht "EDEKA" und "LIDL" gleichzeitig).

#### 4. Fallback
* Wenn ein Ort absolut kein klares visuelles Merkmal hergibt, nutze ihn nicht. Fülle fehlende Kategorien notfalls mit stadtbezogenen Zielen auf (z. B. "Straßenbahn-Haltestelle", "Graffiti") und übergib dafür ein leeres Array [] bei 'matchedPlaces'.

### FORMAT-VORGABE
Du darfst NUR dieses JSON-Format zurückgeben, keine Einleitung, keinen Markdown-Text drumherum. Achte darauf, dass 'matchedPlaces' die exakten Schlüssel aus dem Input verwendet (z.B. 'id'):
[
  { 
    "categoryName": "Name der Kategorie", 
    "matchedPlaces": [
      { "id": "id-aus-dem-input", "name": "Name aus dem Input", "lat": 12.34, "lng": 56.78 }
    ] 
  }
]
`;

            const geminiModels = ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite-preview'];
            let aiResponse;
            let currentModelIndex = 0;

            while (currentModelIndex < geminiModels.length) {
                try {
                    aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModels[currentModelIndex]}:generateContent?key=${geminiApiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: promptDE }] }],
                            generationConfig: {
                                responseMimeType: "application/json",
                            }
                        })
                    });

                    if (!aiResponse.ok) {
                        const errorBody = await aiResponse.json();
                        throw new Error(`Gemini API error with model ${geminiModels[currentModelIndex]}: ${errorBody.error?.message || "Unknown AI error"}`);
                    }

                    break;

                } catch (error) {
                    currentModelIndex++;
                    if (currentModelIndex >= geminiModels.length) {
                        throw new Error("All Gemini models failed to generate categories.");
                    }
                }
            }

            if (!aiResponse) {
                throw new Error("Failed to get a response from Gemini API.");
            }

            const aiData = await aiResponse.json();
            let aiTextResponse = aiData.candidates[0].content.parts[0].text;
            
            aiTextResponse = aiTextResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedCategories = JSON.parse(aiTextResponse);
            
            if (!Array.isArray(parsedCategories) || parsedCategories.length < requiredCount) {
                throw new Error(`AI returned invalid format or fewer categories than required!`);
            }

            const finalCategories: BingoCategory[] = parsedCategories.slice(0, requiredCount).map((category) => {
                const enrichedPlaces = category.matchedPlaces
                    .map((matchedPlace: { id: string }) => {
                        const originalData = uniquePlacesMap.get(matchedPlace.id);
                        if (originalData) {
                            return {
                                name: originalData.name,
                                lat: originalData.lat,
                                lng: originalData.lng
                            };
                        }
                        return null;
                    })
                    .filter((p: any) => p !== null);

                return {
                    categoryName: category.categoryName,
                    matchedPlaces: enrichedPlaces
                };
            });

            return finalCategories;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Error fetching places.";
            console.error("Error during generation:", error);
            throw new Error(errorMessage);
        }
    };

    const handleStartGame = async () => {
        let startPos;
        if (props.startingPoint !== 'open-world') {
            try {
                startPos = JSON.parse(props.startingPoint);
                if (props.gameBoundary && props.gameBoundary !== '[]') {
                    if (!isLocationAllowed(startPos, props.gameBoundary)) {
                        toast.error('Starting point is outside the defined game boundary!');
                        return;
                    }
                }
            } catch (error) {
                toast.error('Invalid map configuration!');
                return;
            }
        }

        let finalCategories = [...props.categories];
        const neededCount = props.gameMode === 'bingo' ? props.gridSize * props.gridSize : props.generationNumber;

        // --- ANGEPASSTE LOGIK: Verzweigung der beiden AI-Modi ---
        if ((props.categorySource === 'nearbyPlaces' || props.categorySource === 'nearbyStreetView') && props.startingPoint !== 'open-world' && startPos) {
            setIsGenerating(true);

            try {
                const generatedCategoryNames = await toast.promise(
                    (async () => {
                        let complexResult;
                        
                        if (props.categorySource === 'nearbyStreetView') {
                            complexResult = await generateStreetViewCategoriesAI(startPos, props.generationRadius, neededCount);
                        } else {
                            complexResult = await generateCategoriesAI(startPos, props.generationRadius, neededCount);
                        }

                        const simpleCategoryNames = complexResult.map(cat => cat.categoryName);

                        const { error: dbError } = await props.supabase
                            .from('games')
                            .update({ 
                                categories: simpleCategoryNames,
                                category_details: complexResult
                            })
                            .eq('id', props.gameId);

                        if (dbError) throw new Error(dbError.message);
                        
                        return simpleCategoryNames;
                    })(),
                    {
                        loading: props.categorySource === 'nearbyStreetView' ? 'Analysze Street-View-Panoramas...' : 'Generating...',
                        success: <b>Categories generated successfully!</b>,
                        error: (err) => {
                            let errorMessage = err instanceof Error ? err.message : "Unknown error during generation";
                            console.error("AI Generation Error Details:", err);
                            return `${errorMessage}`;
                        },
                    }
                );

                finalCategories = generatedCategoryNames;

            } catch (error) {
                setIsGenerating(false);
                return;
            }

            setIsGenerating(false);
        }
        
        if (props.gameMode === 'bingo' && finalCategories.length < neededCount) {
            toast.error(`You need at least ${neededCount} categories to start a Bingo game with a grid size of ${props.gridSize}. Please add more categories or reduce the grid size.`);
            return;
        }

        // Bingo Board Generation Logic
        if (props.gameMode === 'bingo') {
            try {
                const board = finalCategories.slice(0, neededCount);
                const { error } = await props.supabase.from('players').update({ bingo_board: board }).eq('game_id', props.gameId);
                if (error) throw error;
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Unknown database error";
                toast.error(`Board Generation Failed: ${errorMessage}`);
                return;
            }
        }

        props.updateStatus('playing');
    };

    const handleLeaveLobby = () => {
        if (props.isHost && props.players.length > 1) {
            const newHost = props.players.find(p => p.id !== props.playerId);
            if (newHost) {
                props.makeHost(newHost.id);
            }
        }
        props.router.push('/');
    };

    if (debugCenter && debugPlaces.length > 0 && isLoaded && DEBUG) return (
        <div className="w-full mt-10 p-6 bg-slate-800 rounded-xl border border-red-500">
            <h2 className="text-2xl font-bold text-red-400 mb-4">
                Debug: Verteilung & Orte ({debugPlaces.length})
            </h2>
            <div className="w-full h-[600px] rounded-lg overflow-hidden relative">
                <GoogleMap
                    mapContainerStyle={{ width: '100%', height: '100%' }}
                    center={debugCenter}
                    zoom={14}
                >
                    <Marker
                        position={debugCenter}
                        icon={{ url: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" }}
                        title="ORIGINAL STARTPUNKT"
                        zIndex={100}
                    />
                    <Circle
                        center={debugCenter}
                        radius={debugRadius * 100} 
                        options={{
                            fillOpacity: 0,
                            strokeColor: "#FF0000",
                            strokeOpacity: 0.8,
                            strokeWeight: 3,
                        }}
                    />
                    {debugSearchCenters.map((center, index) => (
                        <div key={`search-center-${index}`}>
                            <Marker
                                position={center}
                                icon={{ url: "http://maps.google.com/mapfiles/ms/icons/green-dot.png" }}
                                zIndex={50}
                            />
                            <Circle
                                center={center}
                                radius={debugSubRadius} 
                                options={{
                                    fillColor: "#0000FF",
                                    fillOpacity: 0.05,
                                    strokeColor: "#0000FF",
                                    strokeOpacity: 0.2,
                                    strokeWeight: 1,
                                }}
                            />
                        </div>
                    ))}
                    {debugPlaces.map((place) => (
                        <Marker
                            key={place.id}
                            position={{ lat: place.lat, lng: place.lng }}
                            title={place.name}
                            label={{
                                text: place.name.substring(0, 15), 
                                className: "bg-white text-black p-1 rounded shadow-md text-xs mt-8 absolute font-bold",
                            }}
                        />
                    ))}
                </GoogleMap>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen flex flex-col items-center p-10 bg-slate-900 text-white relative">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12 hidden sm:flex">
                <Image src="/mappin.and.ellipse.png" alt="Logo" width={60} height={60} className="w-auto h-auto" />
                <h1 className="text-6xl font-bold text-indigo-400 tracking-tighter">GEO BINGO</h1>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 w-full max-w-5xl">
                <div className="flex-1 gap-6 flex flex-col">
                    <LobbySettings 
                        key={`settings-${props.gameId}-${props.lastUpdated}`}
                        isHost={props.isHost}
                        gameMode={props.gameMode}
                        teamMode={props.teamMode}
                        gridSize={props.gridSize}
                        timeLimit={props.timeLimit}
                        endCondition={props.endCondition}
                        exclusiveMode={props.exclusiveMode}
                        updateGameModeInfo={props.updateGameModeInfo}
                    />

                    <LobbyMap 
                        isHost={props.isHost}
                        isLoaded={isLoaded}
                        startingPoint={props.startingPoint}
                        gameBoundary={props.gameBoundary}
                        generationRadius={props.categorySource !== 'manual' ? props.generationRadius : undefined}
                        updateGameModeInfo={props.updateGameModeInfo}
                    />

                    <LobbyCategories 
                        key={`categories-${props.gameId}-${props.lastUpdated}`}
                        updateGameModeInfo={props.updateGameModeInfo}
                        isHost={props.isHost}
                        gameMode={props.gameMode}
                        gridSize={props.gridSize}
                        categories={props.categories}
                        suggestedCategories={props.suggestedCategories}
                        gameId={props.gameId}
                        supabase={props.supabase}
                        maxGridSize={MAXGRIDSIZE}
                        startingPoint={props.startingPoint}
                        categorySource={props.categorySource}
                        generationRadius={props.generationRadius}
                        generationNumber={props.generationNumber}
                    />
                </div>

                <LobbySidebar 
                    gameId={props.gameId}
                    players={props.players}
                    onlinePlayers={props.onlinePlayers}
                    playerId={props.playerId}
                    gameHostId={props.gameHostId}
                    isHost={props.isHost}
                    teamMode={props.teamMode}
                    categories={props.categories}
                    supabase={props.supabase}
                    makeHost={props.makeHost}
                    kickPlayer={props.kickPlayer}
                    banPlayer={props.banPlayer}
                    handleStartGame={handleStartGame}
                    handleLeaveLobby={handleLeaveLobby}
                    setPlayers={props.setPlayers}
                    hideMapSymbols={props.hideMapSymbols}
                    fastVoting={props.fastVoting}
                    updateGameModeInfo={props.updateGameModeInfo}
                    categorySource={props.categorySource}
                    isGenerating={isGenerating}
                />
            </div>
        </div>
    );
}