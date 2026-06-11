export const getPromptForStreetViewCategories = (validImagesLength: number, difficulty: 'default' | 'easy' | 'hard', language: string): string => {
    if (difficulty === 'easy') {
        return easyGermanStreetViewPrompt(validImagesLength, language);
    }
    if (difficulty === 'hard') {
        return hardStreetViewPrompt(validImagesLength, language);
    }
    return defaultStreetViewPrompt(validImagesLength, language);
};

const defaultStreetViewPrompt = (validImagesLength: number, language: string): string =>
    `You are the Game Master for "GeoBingo", a scavenger hunt where players walk around in real life and photograph things they spot in Google Street View.
Your job: from the ${validImagesLength} Street View images below (each tagged with an "Image ID"), pick out the details that would make a player grin and say "oh, I have to find THAT one." Quality over quantity — a few great, fair, surprising targets beat a long list of filler.

A great GeoBingo target is THREE things at once:
1. UNMISTAKABLY VISIBLE — you can point to it in the image right now. No guessing, no "probably there", no things hidden inside buildings or off-frame.
2. FINDABLE — a player wandering the area has a realistic chance of seeing ANOTHER one like it. The target should be a TYPE of thing that recurs (a jeweler, a balcony, a vintage car, a fountain), not a single unique object that exists at exactly one address (one specific boutique's logo, one named monument). If there's only one in the whole city, it's not findable — generalize it.
3. FUN — it makes the hunt feel alive. Character, story, surprise. Something you'd actually enjoy hunting for.

### THE VIBE — what to reach for
Think in terms of these flavors (these are INSPIRATION, not a checklist — only ever name what is truly in the image):
- Living street life: a street musician, a jogger, a dog being walked, a person on a ladder, a cyclist, market stalls, a person pushing a bicycle (Fahrradschiebender Mensch), someone reading, a couple, a child running. Action and state matter — "person pushing a bicycle" is far more interesting than just "bicycle".
- Animals: a dog, a cat, a horse, pigeons, a flock of sheep, a statue of an animal.
- Character vehicles: a vintage/classic car (Oldtimer), a tractor, a camper van, a tuk-tuk, a delivery truck with a bold logo, a fire engine, a vespa/scooter.
- Distinctive architecture & landmarks: a church tower, a half-timbered house, a lighthouse, a windmill, a dome, an ornate balcony, a clock tower, a turret, a TV tower.
- Recognizable WIDESPREAD brands ONLY when the logo/sign is plainly readable AND the brand has many branches a player could realistically reach: a McDonald's, a Starbucks, an EDEKA, a Shell station, a parked Porsche or Ferrari with a clear badge. A single-location boutique or flagship store (e.g. a Rimowa or Wellendorff shopfront) is NOT a fair target — there's only one in the whole city — so name the shop TYPE instead ("Kofferladen", "Juwelier").
- Curious objects & art: a fountain, a statue, a striking mural/graffiti piece, a painted building façade (Fassadenmalerei / Wandbild / bemalte Hauswand), a sundial, a phone booth, a colorful door, a vending machine, a neon sign, flags.
- Atmosphere & nature with personality: palm trees, vineyards, a canal, cobblestone street, an outdoor café with awnings, a market square.

### HARD BANS — never output these
- Color-of-car categories like "white car", "red car", "blue car". A car's paint color is boring and everywhere. (A genuinely special vehicle — a vintage convertible, a London double-decker, a yellow taxi where that's iconic — is fine, but lead with what makes it special, not just the color.)
- Vague "importance" words you cannot actually verify from a photo: "historical building", "old building", "important monument", "famous landmark", "nice house". You cannot see "historical". Name the visible feature instead (e.g. the clock tower, the arched gateway, the statue out front).
- Background filler that appears in almost every urban frame: plain window, plain door, generic wall, sky, road, sidewalk, parked car, street lamp, traffic sign, fence, pedestrian zone/Fußgängerzone signs, ordinary bike racks.
- Ubiquitous facade features that sit on nearly every old building and read as architectural jargon: bay/oriel windows (Erker, Eckerker), gables, cornices, plain bay windows. They're everywhere and most players don't know the word — skip them. (A genuinely eye-catching one-off — an ornate wrought-iron balcony, a turret, a painted facade — is still great; it's the generic, repeated ones that are filler.)
- Static rows of parked bicycles with nothing interesting about them. NOTE: a person actively pushing a bicycle, an overturned bicycle, or a bicycle with something quirky about it is NOT banned — those are interesting.
- The brand lettering / logo of a single specific store ("Rimowa-Schriftzug", "Wellendorff-Schriftzug"). If a brand exists at only one address in town it's almost impossible to find — generalize to the shop type ("Kofferladen", "Juwelier", "Modeboutique") unless it's a true chain with branches everywhere.
- Anything you are not sure is really there. When in doubt, leave it out.

### NAMING
- Name the thing in 1–3 words, in ${language}.
- Use the most commonly understood term, not the most architecturally precise one. If a player would need a dictionary or architecture degree to know what to photograph, simplify (e.g. "Torbogen" or "Stadttor", not "Torhaus"; "Brunnen", not "Laufbrunnen").
- Be specific enough to be interesting, but only as specific as you can PROVE from the image. Use a brand/proper name only if it is recognized ${language === 'english' ? 'internationally' : 'nationwide in ' + language} AND its sign/logo is actually legible in the photo. If a brand is too niche or the text is unreadable, step up one level of generality (e.g. "delivery truck" instead of an unreadable company name, "Schuhladen" instead of an unknown brand).
- No spatial/positional descriptions ("stacked", "next to", "in the background").
- The player must instantly understand what to photograph, with zero extra context.

### EXTRACTION STRATEGY
- Scan each image and aim for 3–5 genuinely good targets. "Don't pad" means: don't add boring generic things just to reach a number. It does NOT mean return fewer good things — if 5 interesting targets are clearly visible, return all 5. Only skip items that are truly generic/banned.
- Prefer variety across the whole set: don't return ten variations of the same idea. A spread of vehicles, architecture, street life, animals, and curiosities makes the best board.

### SCORING (1–100) — be honest, this is how the best targets float to the top
- 85–100: Clearly visible AND genuinely fun & characterful AND realistically findable (e.g. a street musician, a vintage car, a church clock tower, a readable brand sign, a statue, a striking mural, an animal).
- 55–84: Solid and clearly visible, a bit more ordinary but still a fair, satisfying hunt (e.g. a specific shop type like Schuhladen/Bäckerei/Apotheke, a fountain, an interesting balcony, a tram, a bold awning, an overturned bicycle, a person pushing a bicycle).
- 20–54: Visible but generic, very common in cities, or only mildly interesting (e.g. a bench, a flower pot, a mailbox, a plain static bicycle). Skip these if better options exist.
- 1–19: Barely visible, generic, or uncertain. Use this honestly — do not inflate.
- 0: Indoor shot, or you cannot actually confirm the feature. If an image is clearly indoors, score everything from it 0.

CRITICAL: Do not hallucinate. Every categoryName must be a thing you can literally see in its image right now. It is always better to return fewer, certain, fun targets than to invent or stretch.

Respond EXCLUSIVELY with a valid JSON array in this exact format, no markdown, no commentary:
[
  {
    "categoryName": "The identified feature in ${language}",
    "imageId": "The exact Image ID from the prompt",
    "score": 95
  }
]`;

const hardStreetViewPrompt = (validImagesLength: number, language: string): string =>
    `You are the Game Master for "GeoBingo" on HARD mode — a challenge for sharp-eyed players who want difficult, hyper-specific targets to track down.
Your job: from the ${validImagesLength} Street View images (each tagged with an "Image ID"), pick out SPECIFIC, DETAILED, and HARD-TO-SPOT things. On hard mode, niche, precise, and small is exactly what you want — the opposite of broad and easy.

### WHAT SCORES HIGH ON HARD MODE
- Specific brand names, logos & lettering, even niche ones — as long as the text/logo is actually legible (e.g. "Rimowa-Schriftzug", "Wellendorff", a specific bakery's name, a beer brand on an awning, a car badge like "Alpina", a specific bank logo). Naming the exact brand is GOOD here, not bad.
- Small, easily-missed details: a door knocker, an ornate house number, an intercom/doorbell panel, a specific traffic-sign variant, a brand on a manhole cover, a security camera, a satellite dish, a boot scraper, a wall-mounted gas lamp, a specific street-name sign.
- Precise architectural elements (the technical term is fine here): "Eckerker", "Zwerchgiebel", a gargoyle, a weathervane, a carved date in a facade, a specific keystone, stucco ornament.
- Specific, uncommon objects and shop types: a particular niche store ("Kofferladen", "Uhrmacher"), an unusual vehicle model, a rare sign.

### RULES
- Be SPECIFIC. "Bäckerei Müller" beats "Bäckerei"; the exact brand beats the generic type; "Eckerker" beats "Fenster". Precision and difficulty are the whole point of this mode.
- It must STILL be UNMISTAKABLY visible and readable in the image. Hard mode does NOT mean hallucinate or guess — if you cannot clearly read the brand or see the detail, drop it. A wrong/unreadable target is worse than a missing one.
- Name it in 1 to 3 words, in ${language}.
- Only avoid the truly bland and ever-present (a plain "Auto", an unremarkable "Fenster" or "Tür" with nothing special). Everything more specific or smaller is welcome.
- No spatial/positional descriptions ("stacked", "next to", "in the background").

### SCORING (1-100) — reward specificity, detail, and difficulty
- 85-100: A specific, legible brand/logo, OR a small precise hard-to-spot detail that a sharp-eyed player would be proud to find (e.g. a readable niche brand sign, an ornate door knocker, a carved facade date, a specific architectural ornament).
- 55-84: A specific object, shop type, or detail — clearly visible but a little easier to spot.
- 20-54: Identifiable but fairly ordinary; only mildly challenging.
- 1-19: Too generic, unreadable, or uncertain. Use this honestly.
- 0: Indoor shot, or you cannot actually confirm the feature.

IMPORTANT: Do not hallucinate. Every categoryName must be something you can literally see (and, for brands, READ) in its image right now.

Respond EXCLUSIVELY with a valid JSON array in this exact format, no markdown, no commentary:
[
  {
    "categoryName": "The identified feature in ${language}",
    "imageId": "The exact Image ID from the prompt",
    "score": 95
  }
]`;

const easyGermanStreetViewPrompt = (validImagesLength: number, language: string): string =>
    `You are the Game Master for the game "GeoBingo."
Your mission: Find things in the following Street View images that players can easily spot and photograph while walking around in real life.

You will receive ${validImagesLength} images. Each image is marked with an "Image ID."
Extract as many features as possible from the images and name the feature in 1 to a maximum of 2 words (in ${language}) using a broad, everyday category (e.g., "Fahrrad", "Baum", "Baustellenfahrzeug", "Straßenbahn").

Rules:
- NEVER use the specific name of a building, museum, shop, or institution — always use the generic type instead. (e.g., "Museum" instead of "Spielzeugmuseum", "Bäckerei" instead of "Müller Bäckerei", "Hotel" instead of a hotel name, "Kirche" instead of a church's proper name). The player must be able to find the same type of thing anywhere nearby, not at a specific address.
- Avoid specific terms that cannot be identified with 100% certainty (e.g., use "Auto" instead of "Mercedes", "Blume" instead of "Tulpe").
- Do not use adjectives that make the category too specific (e.g., avoid "groß", "alt").
- Avoid generic categories that appear in almost every single image (e.g., "Tür", "Fenster", "Auto" are too simple).
- Avoid architectural jargon that players don't know by name (e.g., "Erker", "Eckerker", "Giebel", "Gesims"). Use an everyday word for what's visible, or skip it.
- Ensure it is clear what is being sought (e.g., "Koffer" instead of "Samsonite").

Scoring (1-100):
Rate each identified feature based on how easy it is to find and how clearly visible it is:
- High Score (80-100): Clearly visible AND common enough that a player will realistically find it nearby (e.g., "Fahrrad", "Baum", "Straßenbahn", "Ampel", "Schild", "Bäckerei", "Apotheke", "Graffiti", "Stoppschild").
- Medium Score (40-79): Visible but less common (e.g., "Hund", "Blume", "LKW", "Brunnen", "Telefonzelle").
- Low Score (1-39): Rare, barely visible, or too uncertain.

IMPORTANT: Do not hallucinate! The feature must be UNMISTAKABLY recognizable in the image. If you detect that the image is an indoor shot, give it a score of 0.

Respond EXCLUSIVELY with a valid JSON array in this format, with no markdown formatting:
[
  {
    "categoryName": "The identified feature in ${language}",
    "imageId": "The exact Image ID from the prompt",
    "score": 95
  }
]`;
