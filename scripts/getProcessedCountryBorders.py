import geopandas as gpd
import json
import os
import requests
from shapely.geometry import Polygon, MultiPolygon
from tqdm import tqdm

# URLs for the different datasets
URLS = {
    "admin0": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_map_units.geojson",
    "admin1": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
    "cities": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson",
    "regions": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_regions_polys.geojson"
}

OUTPUT_FILE = "../public/geo_bingo_presets.json"

# Settings for geometry simplification
MERGE_BUFFER_METERS = 10000
BASE_BUFFER_METERS = 10000
START_SIMPLIFY_TOLERANCE = 20000
MAX_POINTS = 50
MIN_AREA_RATIO = 0.01
BUFFER_COMPENSATION_RATIO = 0

# Custom country groups
CUSTOM_REGIONS = {
    "Scandinavia": ["Norway", "Sweden", "Denmark", "Finland", "Iceland"],
    "Balkans": ["Albania", "Bosnia and Herzegovina", "Bulgaria", "Croatia", "Kosovo", "Montenegro", "North Macedonia", "Romania", "Serbia", "Slovenia", "Greece"],
    "Benelux": ["Belgium", "Netherlands", "Luxembourg"],
    "Iberia": ["Spain", "Portugal", "Andorra"],
    "Baltic_States": ["Estonia", "Latvia", "Lithuania"],
    "UK_and_Ireland": ["England", "Scotland", "Wales", "Northern Ireland", "Ireland"],
    "United_Kingdom": ["England", "Scotland", "Wales", "Northern Ireland"],
    "Middle_East": ["Bahrain", "Cyprus", "Egypt", "Iran", "Iraq", "Israel", "Jordan", "Kuwait", "Lebanon", "Oman", "Palestine", "Qatar", "Saudi Arabia", "Syria", "Turkey", "United Arab Emirates", "Yemen"],
    "Islands_Special": ["Seychelles", "Bahamas", "Fiji"] # Grouped for safety
}

# ── Manual preset overrides ──────────────────────────────────────────────────
# import manual overrides from ./manual_overrides.json if it exists, otherwise use an empty dict
if os.path.exists("manual_overrides.json"):
    with open("manual_overrides.json", "r", encoding="utf-8") as f: 
        MANUAL_OVERRIDES = json.load(f)
else:
    MANUAL_OVERRIDES = {}

# ── Name translation ─────────────────────────────────────────────────────────
# English is the single source language. Every preset gets a "names" map
# ({en, de, es, fr, zh}) translated via DeepL at generation time, so the app
# never translates live. Results are cached in data/deepl_cache.json — only
# new/changed names hit the API. Requires the DEEPL_API_KEY env var; without
# it, missing translations fall back to English.
UI_LOCALES = ["de", "es", "fr", "zh"]
DEEPL_TARGET = {"de": "DE", "es": "ES", "fr": "FR", "zh": "ZH"}
DEEPL_CACHE_FILE = os.path.join("data", "deepl_cache.json")


def get_deepl_api_key():
    """DEEPL_API_KEY from the environment, else from the repo's .env.local."""
    key = os.environ.get("DEEPL_API_KEY")
    if key:
        return key
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env.local")
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("DEEPL_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    return None

# Geographic regions
GEO_REGION_MAP = {
    "Sahara": "Sahara Desert",
    "Alpen": "Alps",
    "Himalaya": "Himalayas",
    "Amazonas": "Amazon Basin",
    "Nil-Delta": "Nile Delta",
    "Patagonien": "Patagonia"
}

def download_data(url):
    os.makedirs('data', exist_ok=True)
    filename = os.path.join('data', url.split("/")[-1])
    if not os.path.exists(filename):
        print(f"Downloading {filename} ...")
        response = requests.get(url)
        with open(filename, 'wb') as f:
            f.write(response.content)
    return filename

def get_col(gdf, possible_names):
    """Helper function: Searches for a column, case-insensitive."""
    for col in gdf.columns:
        if col.lower() in [n.lower() for n in possible_names]:
            return col
    return None

def process_geometry(geom, dict_key, name_de, name_en, presets, original_crs):
    if geom is None or geom.is_empty: return

    if dict_key not in presets:
        presets[dict_key] = []

    centroid = geom.centroid
    local_crs = f"+proj=aeqd +lat_0={centroid.y} +lon_0={centroid.x} +datum=WGS84 +units=m"
    
    single_gdf = gpd.GeoDataFrame(geometry=[geom], crs=original_crs)
    local_gdf = single_gdf.to_crs(local_crs)
    local_geom = local_gdf.geometry.iloc[0]

    merged_geom = local_geom.buffer(MERGE_BUFFER_METERS)
    
    blobs = []
    if isinstance(merged_geom, MultiPolygon):
        sorted_geoms = sorted(merged_geom.geoms, key=lambda p: p.area, reverse=True)
        max_area = sorted_geoms[0].area
        for g in sorted_geoms:
            if g.area >= max_area * MIN_AREA_RATIO:
                blobs.append(g)
    else:
        blobs.append(merged_geom)

    for part_idx, blob in enumerate(blobs):
        tolerance = START_SIMPLIFY_TOLERANCE
        while True:
            current_buffer = BASE_BUFFER_METERS + (tolerance * BUFFER_COMPENSATION_RATIO)
            buffered = blob.buffer(current_buffer)
            simplified = buffered.simplify(tolerance)
            
            if isinstance(simplified, MultiPolygon):
                simplified = max(simplified.geoms, key=lambda p: p.area)
            if simplified.is_empty or not isinstance(simplified, Polygon):
                point_count = 0
                break
                
            point_count = len(simplified.exterior.coords)
            if point_count <= MAX_POINTS: break
            tolerance += 2000 

        if point_count == 0: continue
        
        final_gdf = gpd.GeoDataFrame(geometry=[simplified], crs=local_crs).to_crs(epsg=4326)
        final_geom = final_gdf.geometry.iloc[0]
        
        coords = list(final_geom.exterior.coords)
        points = []
        unwrap_offset = 0
        prev_raw_lng = coords[0][0]

        for raw_lng, lat in coords:
            if raw_lng - prev_raw_lng > 180: unwrap_offset -= 360
            elif raw_lng - prev_raw_lng < -180: unwrap_offset += 360
            lng = raw_lng + unwrap_offset
            points.append({"lat": round(lat, 6), "lng": round(lng, 6)})
            prev_raw_lng = raw_lng

        presets[dict_key].append({
            "id": f"preset_{dict_key}_{part_idx}",
            "name_de": name_de,
            "name_en": name_en,
            "type": "allow",
            "points": points
        })

def translate_names(presets):
    """Attach a names map {en, de, es, fr, zh} to every area, translating the
    English display name via DeepL (cached). Replaces legacy name_de/name_en."""
    api_key = get_deepl_api_key()
    cache = {}
    if os.path.exists(DEEPL_CACHE_FILE):
        with open(DEEPL_CACHE_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)

    # English source name per preset: existing names.en / name_en, else the key.
    sources = {}
    for pkey, areas in presets.items():
        name = None
        for a in areas:
            name = (a.get("names") or {}).get("en") or a.get("name_en")
            if name:
                break
        sources[pkey] = name or pkey.replace("_", " ")

    missing = sorted({n for n in sources.values() if any(loc not in cache.get(n, {}) for loc in UI_LOCALES)})
    if missing and not api_key:
        print(f"WARNING: DEEPL_API_KEY not set — {len(missing)} name(s) fall back to English in all languages.")
    elif missing:
        endpoint = "https://api-free.deepl.com/v2/translate" if api_key.endswith(":fx") else "https://api.deepl.com/v2/translate"
        print(f"Translating {len(missing)} preset name(s) via DeepL...")
        for loc in UI_LOCALES:
            todo = [n for n in missing if loc not in cache.get(n, {})]
            for i in range(0, len(todo), 50):
                batch = todo[i:i + 50]
                res = requests.post(
                    endpoint,
                    headers={"Authorization": f"DeepL-Auth-Key {api_key}"},
                    json={"text": batch, "target_lang": DEEPL_TARGET[loc], "source_lang": "EN"},
                )
                res.raise_for_status()
                for src, tr in zip(batch, res.json()["translations"]):
                    cache.setdefault(src, {})[loc] = tr["text"]
        os.makedirs("data", exist_ok=True)
        with open(DEEPL_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)

    for pkey, areas in presets.items():
        en = sources[pkey]
        names = {"en": en}
        for loc in UI_LOCALES:
            names[loc] = cache.get(en, {}).get(loc, en)
        for a in areas:
            a["names"] = names
            a.pop("name_de", None)
            a.pop("name_en", None)


def process_boundaries():
    print("Checking downloads...")
    files = {k: download_data(v) for k, v in URLS.items()}
    
    print("Reading geodata (this may take a moment)...")
    gdf_units = gpd.read_file(files["admin0"])
    gdf_states = gpd.read_file(files["admin1"])
    gdf_cities = gpd.read_file(files["cities"])
    gdf_regions = gpd.read_file(files["regions"])
    
    presets = {}

    # Dynamically determine columns (prevents KeyError)
    unit_name_col = get_col(gdf_units, ['NAME_EN', 'NAME', 'name'])
    unit_cont_col = get_col(gdf_units, ['CONTINENT', 'continent'])
    unit_subreg_col = get_col(gdf_units, ['SUBREGION', 'subregion'])
    reg_name_col = get_col(gdf_regions, ['NAME_EN', 'NAME', 'name'])
    state_admin_col = get_col(gdf_states, ['admin', 'ADMIN'])
    state_name_col = get_col(gdf_states, ['name_en', 'name', 'NAME'])

    # 1. Map Units (Countries / Country parts)
    print("Processing map units (Map Units)...")
    for _, row in tqdm(gdf_units.iterrows(), total=len(gdf_units)):
        name = row.get(unit_name_col, "Unknown")
        if name and name != "Unknown":
            process_geometry(row['geometry'], name.replace(' ', '_'), name, name, presets, gdf_units.crs)

    # 2. Custom Regions (Balkans, Scandinavia, etc.)
    print("\nProcessing custom political regions...")
    for region_name, country_names in tqdm(CUSTOM_REGIONS.items()):
        region_gdf = gdf_units[gdf_units[unit_name_col].isin(country_names)]
        if not region_gdf.empty:
            merged_geom = region_gdf.geometry.union_all()
            display_name = region_name.replace('_', ' ')
            process_geometry(merged_geom, region_name, display_name, display_name, presets, gdf_units.crs)

    # 3. Continents (Europe WITHOUT Russia)
    print("\nProcessing continents...")
    if unit_cont_col:
        for cont in gdf_units[unit_cont_col].dropna().unique():
            cont_gdf = gdf_units[gdf_units[unit_cont_col] == cont]
            if cont == "Europe":
                # Filter Russia out of Europe
                cont_gdf = cont_gdf[cont_gdf[unit_name_col] != "Russia"]
            
            merged = cont_gdf.geometry.union_all()
            process_geometry(merged, cont.replace(' ', '_'), cont, cont, presets, gdf_units.crs)


    # 4. Top cities presets (points -> 20km buffer)
    print("\nProcessing city presets...")
    pop_col = get_col(gdf_cities, ['POP_MAX', 'pop_max'])
    if pop_col:
        gdf_cities_sorted = gdf_cities.sort_values(by=pop_col, ascending=False)
        for count in [3, 10, 50]:
            top_cities = gdf_cities_sorted.head(count)
            city_polys = [city.geometry.buffer(0.2) for _, city in top_cities.iterrows()]
            merged_cities = gpd.GeoDataFrame(geometry=city_polys, crs=gdf_cities.crs).geometry.union_all()
            process_geometry(merged_cities, f"Top_{count:02d}_largest_cities", f"Top {count} Cities", f"Top {count} Cities", presets, gdf_cities.crs)


    # 5. Geographic natural regions (Alps, Sahara, etc.)
    print("\nProcessing geographic natural regions...")
    if reg_name_col:
        for de_name, en_name in GEO_REGION_MAP.items():
            # Ignore case for safety
            reg = gdf_regions[gdf_regions[reg_name_col].str.lower() == en_name.lower()]
            if not reg.empty:
                process_geometry(reg.geometry.union_all(), en_name.replace(' ', '_'), de_name, en_name, presets, gdf_regions.crs)


    # 6. Special regions from admin data (Central America, Polynesia)
    print("\nProcessing subregions (Central America, Polynesia)...")
    specials = {"Mittelamerika": "Central America", "Polynesien": "Polynesia"}
    if unit_subreg_col:
        for de, en in specials.items():
            reg_gdf = gdf_units[gdf_units[unit_subreg_col].str.lower() == en.lower()]
            if not reg_gdf.empty:
                process_geometry(reg_gdf.geometry.union_all(), en.replace(' ', '_'), de, en, presets, gdf_units.crs)


    # 7. US states & German federal states
    print("\nProcessing federal states (USA/DE)...")
    if state_admin_col and state_name_col:
        filtered_states = gdf_states[gdf_states[state_admin_col].isin(["United States of America", "Germany"])]
        for _, row in tqdm(filtered_states.iterrows(), total=len(filtered_states)):
            prefix = "US" if row[state_admin_col] == "United States of America" else "DE"
            name = row.get(state_name_col, "Unknown")
            if name != "Unknown":
                process_geometry(row['geometry'], f"{prefix}_{name.replace(' ', '_')}", name, name, presets, gdf_states.crs)

    # 8. Manual overrides (drawn in the in-app admin tool) win over everything
    if MANUAL_OVERRIDES:
        print("\nApplying manual overrides...")
        for key, areas in MANUAL_OVERRIDES.items():
            action = "replacing" if key in presets else "adding"
            print(f"  {action} {key} ({len(areas)} area(s))")
            presets[key] = areas

    # 9. Translate every preset name into all UI languages (English source)
    translate_names(presets)

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(presets, f, indent=2, ensure_ascii=False)
    print(f"\nDone! {len(presets)} presets successfully generated and saved.")

if __name__ == "__main__":
    process_boundaries()