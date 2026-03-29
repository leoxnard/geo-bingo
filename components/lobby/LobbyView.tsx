'use client';

import { useState } from 'react';

import { useJsApiLoader } from '@react-google-maps/api';
import toast from 'react-hot-toast';
import Image from 'next/image';

import LobbyCategories from './LobbyCategories';
import LobbyMap from './LobbyMap';
import LobbySettings from './LobbySettings';
import LobbySidebar from './LobbySidebar';
import { shuffle } from '../utils/Functions';
import { isLocationAllowed } from '../utils/mapUtils';

interface Player {
    id: string;
    name: string;
    bingo_board?: string[];
    team?: number;
}

type GameStatus = 'lobby' | 'playing' | 'voting' | 'finished';

interface LobbyViewProps {
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
    categorySource: 'manual' | 'generation';
    generationRadius: number;
    generationNumber: number;
}

export default function LobbyView(props: LobbyViewProps) {
    const [libraries] = useState<("places" | "geometry")[]>(['places', 'geometry']);
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        libraries
    });
    const MAXGRIDSIZE = 6;

    const [isGenerating, setIsGenerating] = useState(false);

    const generateCategoriesAI = async (startPos: { lat: number, lng: number }, radius: number, requiredCount: number): Promise<string[]> => {
        return new Promise(async (resolve, reject) => {
            try {
                const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
                if (!googleApiKey) {
                    reject("Google Maps API Key is missing! Please add it to your .env file.");
                    return;
                }

                const url = 'https://places.googleapis.com/v1/places:searchNearby';
                
                const fetchPlacesNewAPI = async (includedTypes: string[]) => {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Goog-Api-Key': googleApiKey,
                            'X-Goog-FieldMask': 'places.displayName.text'
                        },
                        body: JSON.stringify({
                            includedTypes: includedTypes,
                            maxResultCount: 20,
                            locationRestriction: {
                                circle: {
                                    center: {
                                        latitude: startPos.lat,
                                        longitude: startPos.lng
                                    },
                                    radius: radius * 100 // convert 100m to m
                                }
                            }
                        })
                    });

                    console.log(`Radius: ${radius * 100}m, Included Types: ${includedTypes.join(', ')}, Status: ${response.status}`);

                    if (!response.ok) {
                        const errorData = await response.json();
                        console.error("Google Places API (New) Error:", errorData);
                        throw new Error("Places API (New) denied the request. Did you enable it in the Cloud Console?");
                    }

                    const data = await response.json();
                    return data.places ? data.places.map((p: any) => p.displayName?.text).filter(Boolean) : [];
                };

                const [culturalPlaces, urbanPlaces] = await Promise.all([
                    fetchPlacesNewAPI(['tourist_attraction', 'museum', 'historical_landmark', 'church', 'park']),
                    fetchPlacesNewAPI(['transit_station', 'restaurant', 'shopping_mall', 'stadium', 'supermarket'])
                ]);

                // Merge and remove duplicates
                let uniquePlaces = Array.from(new Set([...culturalPlaces, ...urbanPlaces]));
                console.log(`Google Places API (New) found ${uniquePlaces.length} places:`);
                console.log(uniquePlaces);
                
                if (uniquePlaces.length < requiredCount) {
                    reject(`Not enough places found within the specified radius (${uniquePlaces.length}/${requiredCount}).`);
                    return;
                }

                const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
                if (!geminiApiKey) {
                    reject("Gemini API Key is missing!");
                    return;
                }

                const promptDE = `
                    Du bist der Spielleiter für "GeoBingo". Deine Aufgabe ist es, aus einer Liste von realen Orten (POIs) ein spannendes, visuelles Suchspiel zu machen.

                    INPUT-DATEN (Echte Orte im Umkreis):
                    ${JSON.stringify(uniquePlaces)}

                    DEINE AUFGABE:
                    Erstelle aus diesen Daten exakt ${requiredCount} Bingo-Begriffe auf Deutsch. 
                    Wähle eine abwechslungsreiche Mischung aus:
                    1. LANDMARKS (z.B. Kirchturm, Altes Stadttor, Denkmal)
                    2. INFRASTRUKTUR (z.B. U-Bahn Abgang, Gelber Briefkasten, Bushaltestelle)
                    3. GEWERBE (z.B. Apotheke, Supermarkt, Tankstelle)

                    STRENGE REGELN:
                    - MAX. 3 WÖRTER: Halte die Begriffe extrem kurz und knackig.
                    - MARKEN-REGEL: Nenne Firmennamen NUR wenn es bekannte Ketten sind und wenn sie visuell markant sind (Beispiel: "EDEKA", "REWE", "Deutsche Post", "IKEA"). Ansonsten verallgemeinern (z.B. "Metzgerei", "Bäckerei").
                    - STREET-VIEW-CHECK: Wähle nur Begriffe, die man von der Straße aus sicher sehen kann.
                    - KEINE DUPLIKATE: Jeder Begriff muss einzigartig sein.
                    - FORMAT: Antworte AUSSCHLIESSLICH mit einem validen JSON-Array aus Strings.

                    Beispiel-Output:
                    ["Gelber Briefkasten", "EDEKA", "Kirchturm", "U-Bahn Schild", "Apotheke"]
                `;

                const prompt = promptDE; // TODO: For now, we can just use German since the game is in German. Adjust if you want to support multiple languages.

                const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            responseMimeType: "application/json",
                        }
                    })
                });

                if (!aiResponse.ok) {
                    const errorBody = await aiResponse.json();
                    console.error("Detailed Gemini error:", errorBody);
                    
                    const message = errorBody.error?.message || "Unknown AI error";
                    throw new Error(`Gemini API error: ${message}`);
                }

                const aiData = await aiResponse.json();
                let aiTextResponse = aiData.candidates[0].content.parts[0].text;
                
                aiTextResponse = aiTextResponse.replace(/```json/g, '').replace(/```/g, '').trim();
                const finalCategories = JSON.parse(aiTextResponse);
                
                if (!Array.isArray(finalCategories)) {
                    throw new Error("The AI did not return the expected array format.");
                }

                if (finalCategories.length < requiredCount) {
                    throw new Error(`AI returned fewer categories than required! Got ${finalCategories.length}, but need ${requiredCount}.`);
                }

                console.log("Final categories from AI:", finalCategories);

                resolve(finalCategories.slice(0, requiredCount));

            } catch (error: any) {
                console.error("Error during generation:", error);
                reject(error.message || "Error fetching places.");
            }
        });
    };

    const handleStartGame = async () => {
        if (isGenerating) return;

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
                console.error("Invalid map configuration parsing:", error);
                toast.error('Invalid map configuration!');
                return;
            }
        }

        let finalCategories = [...props.categories];
        const neededCount = props.gameMode === 'bingo' ? props.gridSize * props.gridSize : props.generationNumber;

        // AI Generation Logic
        if (props.categorySource === 'generation' && props.startingPoint !== 'open-world' && startPos) {
            setIsGenerating(true);

            try {
                const categories = await toast.promise(
                    (async () => {
                        const result = await generateCategoriesAI(startPos, props.generationRadius, neededCount);

                        const { error: dbError } = await props.supabase
                            .from('games')
                            .update({ categories: result })
                            .eq('id', props.gameId);

                        if (dbError) throw new Error(dbError.message);
                        
                        return result;
                    })(),
                    {
                        loading: 'Generating...',
                        success: <b>Categories generated successfully!</b>,
                        error: (err: any) => {
                            console.error("AI Generation Error Details:", err);

                            let errorMessage = "Unknown error occurred during category generation.";

                            if (typeof err === 'string') {
                                errorMessage = err;
                            } else if (err instanceof Error) {
                                errorMessage = err.message;
                            } else if (err?.response?.data?.error) {
                                errorMessage = err.response.data.error;
                            } else if (err?.message) {
                                errorMessage = err.message;
                            } else if (err?.error) {
                                errorMessage = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
                            }

                            return `${errorMessage}`;
                        },
                    }
                );

                finalCategories = categories;
                console.log("Generated categories:", finalCategories);

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
            } catch (err: any) {
                console.error("Failed to generate boards:", err);
                toast.error(`Board Generation Failed: ${err?.message || "Unknown database error"}`);
                return;
            }
        }

        props.updateStatus('playing');
    };

    const handleLeaveLobby = () => {
        // If host leaves, assign a new host
        if (props.isHost && props.players.length > 1) {
            const newHost = props.players.find(p => p.id !== props.playerId);
            if (newHost) {
                props.makeHost(newHost.id);
            }
        }
        props.router.push('/');
    };

    return (
        <div className="min-h-screen flex flex-col items-center p-10 bg-slate-900 text-white relative">
            {/* Logo Header */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12 hidden sm:flex">
                <Image src="/mappin.and.ellipse.png" alt="Logo" width={60} height={60} className="w-auto h-auto" />
                <h1 className="text-6xl font-bold text-indigo-400 tracking-tighter">GEO BINGO</h1>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 w-full max-w-5xl">
                <div className="flex-1 gap-6 flex flex-col">
                    <LobbySettings 
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
                        updateGameModeInfo={props.updateGameModeInfo}
                    />

                    <LobbyCategories 
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
                />
            </div>
        </div>
    );
}