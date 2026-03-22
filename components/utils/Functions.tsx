export const shuffle = <T,>(array: T[]): T[] => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
};

export const validatePolygon = (startLat: number, startLng: number, polyString: string | null) => {
    if (!polyString || polyString === '[]') {
        return true; // No polygon to validate, so it's valid by default
    }

    try {
        const points = JSON.parse(polyString);
        if (!Array.isArray(points) || points.length < 3) {
            return false; // Not a valid polygon
        }

        const point = new google.maps.LatLng(startLat, startLng);
        const polygon = new google.maps.Polygon({ paths: points });
        
        return google.maps.geometry.poly.containsLocation(point, polygon);
    } catch (error) {
        console.error('Error validating polygon:', error);
        return false; // If there's an error parsing or validating, treat it as invalid
    }  
}
