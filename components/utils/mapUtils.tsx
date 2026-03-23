export const GOOGLE_MAPS_LIBRARIES: ("places" | "geometry" | "drawing" | "visualization" | "marker")[] = ['places', 'geometry'];


export const mapOptions = (additionalOptions: { [key: string]: unknown } = {}): google.maps.MapOptions => ({
    streetViewControl: true,
    mapTypeControl: false,
    gestureHandling: 'greedy',
    fullscreenControl: false,
    zoomControl: false,
    cameraControl: false,
    colorScheme: 'DARK',
    scrollwheel: true,
    disableDoubleClickZoom: false,
    clickableIcons: false,
    styles: [
        {
            featureType: "all",
            elementType: "labels.icon",
            stylers: [{ visibility: "off" }],
        },
    ],
    ...additionalOptions
});


export const insertPoint = (newPoint: {lat: number, lng: number}, points: {lat: number, lng: number}[]) => {
    if (points.length < 3) return [...points, newPoint];

    type Point = { lat: number, lng: number };

    // Helper: Check if three points make a clockwise or counter-clockwise turn
    const orientation = (p: Point, q: Point, r: Point) => {
        const val = (q.lng - p.lng) * (r.lat - q.lat) - (q.lat - p.lat) * (r.lng - q.lng);
        if (Math.abs(val) < 1e-9) return 0; // collinear
        return (val > 0) ? 1 : 2; // 1 = clockwise, 2 = counter-clockwise
    };

    // Helper: Check if segment p1q1 intersects segment p2q2
    const doIntersect = (p1: Point, q1: Point, p2: Point, q2: Point) => {
        // If they share an exact endpoint, they just touch (which is fine), they don't cross.
        const isSame = (a: Point, b: Point) => a.lat === b.lat && a.lng === b.lng;
        if (isSame(p1, p2) || isSame(p1, q2) || isSame(q1, p2) || isSame(q1, q2)) return false;

        const o1 = orientation(p1, q1, p2);
        const o2 = orientation(p1, q1, q2);
        const o3 = orientation(p2, q2, p1);
        const o4 = orientation(p2, q2, q1);

        // General case for strict crossing
        return (o1 !== o2 && o3 !== o4);
    };

    // Helper: Check if inserting the point at a specific index causes ANY lines to cross
    const causesIntersection = (insertIndex: number) => {
        const nextIndex = (insertIndex + 1) % points.length;
        const p1 = points[insertIndex];
        const p2 = points[nextIndex];
        
        // The two new lines that will be created
        const newSeg1 = [p1, newPoint];
        const newSeg2 = [newPoint, p2];

        for (let i = 0; i < points.length; i++) {
            if (i === insertIndex) continue; // Skip the line we are replacing
            
            const edgeStart = points[i];
            const edgeEnd = points[(i + 1) % points.length];

            // If either new line crosses an existing boundary, reject this insertion
            if (doIntersect(newSeg1[0], newSeg1[1], edgeStart, edgeEnd)) return true;
            if (doIntersect(newSeg2[0], newSeg2[1], edgeStart, edgeEnd)) return true;
        }
        return false;
    };

    // Calculate distance to segment, adjusting for map projection (longitude scaling)
    const distToSegmentSq = (p: Point, v: Point, w: Point) => {
        const latMid = (v.lat + w.lat) / 2;
        const cosLat = Math.cos(latMid * Math.PI / 180); // Adjust for map squish
        
        const dx = (w.lng - v.lng) * cosLat;
        const dy = w.lat - v.lat;
        const l2 = dx * dx + dy * dy;

        const pdx = (p.lng - v.lng) * cosLat;
        const pdy = p.lat - v.lat;

        if (l2 === 0) return pdx * pdx + pdy * pdy;
        
        let t = (pdx * dx + pdy * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        
        const projX = v.lng + t * (w.lng - v.lng);
        const projY = v.lat + t * (w.lat - v.lat);

        const distX = (p.lng - projX) * cosLat;
        const distY = p.lat - projY;

        return distX * distX + distY * distY;
    };

    let minDist = Infinity;
    let minIndex = -1;
    let fallbackMinDist = Infinity;
    let fallbackIndex = 0;

    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const d = distToSegmentSq(newPoint, points[i], points[j]);
        
        // Always track the absolute closest edge just in case
        if (d < fallbackMinDist) {
            fallbackMinDist = d;
            fallbackIndex = i;
        }

        // Track the closest edge that DOES NOT cause an intersection
        if (d < minDist && !causesIntersection(i)) {
            minDist = d;
            minIndex = i;
        }
    }
    
    // If every single valid edge causes an intersection (rare, usually happens on wild concave shapes),
    // default to the closest edge anyway to prevent the function from failing.
    const insertAt = minIndex !== -1 ? minIndex : fallbackIndex;

    const newPoints = [...points];
    newPoints.splice(insertAt + 1, 0, newPoint);
    return newPoints;
};

export function isPointInPolygon(point: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]) {
    let isInside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lng;
        const yi = polygon[i].lat;
        const xj = polygon[j].lng;
        const yj = polygon[j].lat;

        const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
            (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
            
        if (intersect) {
            isInside = !isInside;
        }
    }
    return isInside;
}

export function isLocationAllowed(point: { lat: number; lng: number }, gameBoundary: string | null) {
    if (!gameBoundary || gameBoundary === '[]') return true;
    try {
        const parsed = JSON.parse(gameBoundary);
        if (!Array.isArray(parsed) || parsed.length === 0) return true;
        if (parsed.length > 0 && parsed[0].lat !== undefined && parsed[0].id === undefined) {
            return isPointInPolygon(point, parsed);
        }
        for (let i = parsed.length - 1; i >= 0; i--) {
            const boundary = parsed[i];
            if (boundary.points && boundary.points.length >= 3) {
                if (isPointInPolygon(point, boundary.points)) {
                    return boundary.type === 'allow';
                }
            }
        }
        const hasAllowZones = parsed.some(b => b.type === 'allow' && b.points.length >= 3);
        if (hasAllowZones) {
            return false;
        }
        return true;
    } catch (e) {
        console.error("Invalid boundary data", e);
        return true;
    }
}
