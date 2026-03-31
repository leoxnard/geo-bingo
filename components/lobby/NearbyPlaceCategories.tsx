import { getGridLocations, getDistance, shuffle } from "../utils/Functions";
import { BingoCategory } from "../utils/types";

export const generateNearbyPlaceCategories = async (startPos: { lat: number, lng: number }, radius: number, requiredCount: number): Promise<BingoCategory[]> => {
    try {
        const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
        if (!googleApiKey) throw new Error("Google Maps API Key is missing!");
        
        const radiusMeters = radius * 100;
        const { points: gridPoints, subRadiusMeters } = getGridLocations(startPos.lat, startPos.lng, radiusMeters);

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
                ? (data.places as { id: string, displayName?: { text: string }, formattedAddress: string, location?: { latitude: number, longitude: number } }[]).map(p => ({
                    id: p.id,
                    name: p.displayName?.text || 'Unnamed Place',
                    address: p.formattedAddress,
                    lat: p.location?.latitude || 0,
                    lng: p.location?.longitude || 0
                })).filter(p => Boolean(p.name && p.id)) 
                : [];
        };

        const searchPromises: Promise<{ id: string, name: string, address: string, lat: number, lng: number }[]>[] = [];
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
            
            const isTooClose = Array.from(uniquePlacesMap.values()).some((existingPlace: { lat: number, lng: number }) => {
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

            } catch {
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
                .filter((p: { name: string, lat: number, lng: number } | null) => p !== null);

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