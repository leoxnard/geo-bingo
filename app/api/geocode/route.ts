import { NextRequest, NextResponse } from 'next/server';

/*
================================================================================
GEOCODE PROXY (OpenStreetMap Nominatim)
================================================================================
Turns a free-text place query ("Munich", "Bavaria", "France") into real
administrative-boundary polygons for use as game play areas.

Google's Places/Maps JS API does NOT expose administrative boundary polygons —
Autocomplete/Places returns only a viewport rectangle + a center, and Google's
data-driven "Boundaries" product is a paid, limited add-on. OpenStreetMap's
Nominatim search DOES return the real boundary as GeoJSON (polygon_geojson=1),
for free, which is exactly what this game's polygon boundary model needs.

We proxy through the server (rather than calling Nominatim from the browser) for
two reasons: browsers cannot set a custom User-Agent, and Nominatim's usage
policy asks for an identifying User-Agent. Doing it here also keeps the call
policy-compliant and lets us trim the (potentially large) response before it
reaches the client.
================================================================================
*/

// Douglas–Peucker simplification tolerance (degrees) applied by Nominatim to the
// returned polygons. ~0.001° ≈ 110 m — keeps city/region shapes recognisable
// while capping vertex counts so the boundary JSON stays small in the DB and in
// realtime payloads.
const POLYGON_THRESHOLD = 0.001;

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

// Identifying User-Agent per Nominatim usage policy (browsers can't set one).
const USER_AGENT = 'GeoBingo/1.0 (real-time multiplayer street view game)';

interface NominatimResult {
    osm_type?: string;
    osm_id?: number;
    display_name?: string;
    name?: string;
    type?: string;
    addresstype?: string;
    boundingbox?: [string, string, string, string];
    geojson?: { type: string; coordinates: unknown } | null;
}

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (q.length < 2) {
        return NextResponse.json({ results: [] });
    }
    if (q.length > 120) {
        return NextResponse.json({ error: 'Query too long.' }, { status: 400 });
    }

    const url = new URL(NOMINATIM_ENDPOINT);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('polygon_geojson', '1');
    url.searchParams.set('polygon_threshold', String(POLYGON_THRESHOLD));
    url.searchParams.set('limit', '6');
    url.searchParams.set('addressdetails', '0');
    url.searchParams.set('accept-language', req.nextUrl.searchParams.get('lang') || 'en');

    let upstream: Response;
    try {
        upstream = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
    } catch {
        return NextResponse.json({ error: 'Geocoding service unavailable.' }, { status: 502 });
    }

    if (!upstream.ok) {
        return NextResponse.json({ error: 'Geocoding service error.' }, { status: 502 });
    }

    let data: NominatimResult[];
    try {
        data = (await upstream.json()) as NominatimResult[];
    } catch {
        return NextResponse.json({ error: 'Invalid geocoding response.' }, { status: 502 });
    }

    // Trim to the fields the client needs; keep the geometry (polygon) and a bbox
    // fallback (for places with no polygon, e.g. a single POI → a rectangle).
    const results = (Array.isArray(data) ? data : [])
        .map((r) => ({
            osmId: r.osm_type && r.osm_id !== undefined ? `${r.osm_type}${r.osm_id}` : String(r.osm_id ?? ''),
            label: r.display_name || r.name || q,
            name: r.name || (r.display_name ? r.display_name.split(',')[0] : q),
            type: r.addresstype || r.type || '',
            boundingbox: r.boundingbox,
            geojson: r.geojson && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon') ? r.geojson : null,
        }))
        // A usable play area needs either a real polygon or at least a bounding box.
        .filter((r) => r.geojson || (r.boundingbox && r.boundingbox.length === 4));

    return NextResponse.json({ results });
}
