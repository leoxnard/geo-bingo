export const getPromptForStreetViewCategories = (validImagesLength: number, difficulty: 'default' | 'easy'): string => {
    if (difficulty === 'easy') {
        return easyGermanStreetViewPrompt(validImagesLength);
    }
    return defaultGermanStreetViewPrompt(validImagesLength);
}

const defaultGermanStreetViewPrompt = (validImagesLength: number): string =>
`Du bist der Game-Master für das Spiel "GeoBingo".
Deine Mission: Finde in den folgenden Street-View-Bildern besonders interessante, einzigartige oder kuriose Details, die Spieler in echt suchen sollen.

Du erhältst ${validImagesLength} Bilder. Jedes Bild ist mit einer "Bild-ID" markiert.
Suche dir möglichst viele Merkmale aus den Bildern heraus und benenne das besondere Merkmal in 1 bis maximal 2 Wörtern (auf Deutsch), vermeide räumliche Beschreibungen (z.B. "gestapelt", "nebeneinander"). 
Nenne Eigennamen nur, wenn sie deutschlandweit bekannt sind (z.B. "EDEKA" ist gut aber "Frauenkirche" nicht, da man den Namen nicht direkt am Gebäude erkennen kann).
Es geht darum Kategorien zu finden die man auf der Suche durchaus finden könnte, aber nicht zu generisch sind, dass sie auf fast jedem Bild vorkommen (z.B. "Tür", "Fenster", "Auto" wären zu generisch).
Es sollte dann aber verständlich sein, was genau gesucht ist (z.B. "Samsonite Koffer" statt "Samsonite"), nutze lieber allgemeinere Begriffe, wenn es zu spezifisch wird (z.B. "LKW" statt "Moser LKW"). 
Bewerte jedes gefundene Merkmal mit einem "score" von 1 bis 100. Dieser spiegelt sowohl deine Sicherheit bei der Erkennung als auch den Unterhaltungswert für das Spiel wider. (Die folgenden Kategorien dienen als Orientierung, du kannst auch andere Begriffe wählen):
- Hoher Score (80-100): Sehr hohe Sicherheit und passende Kategorien! Zum Beispiel spezielle/kuriose Fahrzeuge (z.B. Oldtimer, Traktor), einmalige Architektur, besondere Statuen/Kunstwerke, Musiker, auffälliges Graffiti, ungewöhnliche Straßenszenen, Tiere, Menschen mit besonderen erkennbaren Merkmalen.
- Mittlerer Score (40-79): Akurate Sicherheit! Zum Beispiel spezifische Läden, Verkehrsschilder, auffällige Schaufenster, besondere Türen, interessante Pflanzen oder Bäume, Fahrzeuge mit besonderen Farben oder Merkmalen.
- Niedriger Score (1-39): Niedrige Sicherheit oder uninteressant! Zum Beispiel Normale Autos, generische Hotel- oder Firmenschilder, Ampeln, zu kleine Details, die schwer zu erkennen sind oder auch Begriffe mit denen man nicht sicher ist was gemeint ist (z.B. "Reifen", "Holz").

WICHTIG: Erfinde nichts! Das Merkmal muss ZWEIFELSFREI im Bild erkennbar sein. Wenn du erkennst, dass das Bild ein indoor-Bild ist, gebe ihm ein score von 0!

Antworte AUSSCHLIESSLICH mit einem validen JSON-Array in diesem Format, ohne Markdown drumherum:
[
{
"categoryName": "Das gefundene Merkmal (z.B. Katze)",
"imageId": "Die exakte Bild-ID aus dem Prompt",
"score": 95
},
]`;

const easyGermanStreetViewPrompt = (validImagesLength: number): string =>
`Du bist der Game-Master für das Spiel "GeoBingo".
Deine Mission: Finde in den folgenden Street-View-Bildern besonders interessante, einzigartige oder kuriose Details, die Spieler in echt suchen sollen.

Du erhältst ${validImagesLength} Bilder. Jedes Bild ist mit einer "Bild-ID" markiert.
Suche dir möglichst viele Merkmale aus den Bildern heraus und benenne das Merkmal in 1 bis maximal 2 Wörtern (auf Deutsch) in einer etwas gröberen Kategorie (z.B. "Weißes Auto", "Ortsschild", "Baustellenfahrzeug"). Vermeide spezifische Begriffe, die man nicht sicher erkennen kann (z.B. "Mercedes", "Tulpe") und verwende keine weiteren adjective, welche die Kategorie zu spezifisch machen (z.B. "groß", "alt").
Nenne Eigennamen nur, wenn sie deutschlandweit bekannt sind (z.B. "EDEKA" ist gut aber "Frauenkirche" nicht, da man den Namen nicht direkt am Gebäude erkennen kann).
Es geht darum Kategorien zu finden die man auf der Suche durchaus finden könnte, aber nicht zu generisch sind, dass sie auf fast jedem Bild vorkommen (z.B. "Tür", "Fenster", "Auto" wären zu einfach).
Es sollte dann aber verständlich sein, was genau gesucht ist (z.B. "Koffer" statt "Samsonite").
Bewerte jedes gefundene Merkmal mit einem "score" von 1 bis 100. Dieser spiegelt sowohl deine Sicherheit bei der Erkennung als auch den Unterhaltungswert für das Spiel wider. (Die folgenden Kategorien dienen als Orientierung, du kannst auch andere Begriffe wählen):
- Hoher Score (80-100): Sehr hohe Sicherheit und passende Kategorien! Zum Beispiel spezifisches Schild ("Stoppschild", "Bahnhofsschild"), farbiges Fahrzeug ("Rotes Auto", "Blauer LKW"), auffälliges Graffiti, oder bestimmte Orte (z.B. "Bäckerei", "Apotheke", "Garften").
- Mittlerer Score (40-79): Akurate Sicherheit! Extrem seltene Begriffe oder sehr häufige Begriffe, die aber trotzdem gut erkennbar sind (z.B. "Baum", "Fahrrad", "Pflanze", "LKW", "Straßenbahn", "Möwe").
- Niedriger Score (1-39): Niedrige Sicherheit!

WICHTIG: Erfinde nichts! Das Merkmal muss ZWEIFELSFREI im Bild erkennbar sein. Wenn du erkennst, dass das Bild ein indoor-Bild ist, gebe ihm ein score von 0!

Antworte AUSSCHLIESSLICH mit einem validen JSON-Array in diesem Format, ohne Markdown drumherum:
[
{
"categoryName": "Das gefundene Merkmal (z.B. Katze)",
"imageId": "Die exakte Bild-ID aus dem Prompt",
"score": 95
},
]`;
