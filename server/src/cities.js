/**
 * City presets.
 *
 * Blinkit and Zepto resolve a dark store from lat/lon. Flipkart, JioMart and
 * DMart instead gate everything behind a delivery pincode — no pincode, no
 * prices, not even an error. So a location here is both: coordinates AND a
 * representative pincode for that city.
 *
 * The pincode is a central one per city, good enough to make those platforms
 * return their catalogue. For accurate stock and fees, override it in Settings
 * with your actual pincode.
 */
export const CITIES = [
  { id: 'bengaluru',  name: 'Bengaluru',     lat: 12.9716, lon: 77.5946, pincode: '560001' },
  { id: 'mumbai',     name: 'Mumbai',        lat: 19.0760, lon: 72.8777, pincode: '400001' },
  { id: 'delhi',      name: 'Delhi',         lat: 28.6139, lon: 77.2090, pincode: '110001' },
  { id: 'gurugram',   name: 'Gurugram',      lat: 28.4595, lon: 77.0266, pincode: '122001' },
  { id: 'noida',      name: 'Noida',         lat: 28.5355, lon: 77.3910, pincode: '201301' },
  { id: 'hyderabad',  name: 'Hyderabad',     lat: 17.3850, lon: 78.4867, pincode: '500001' },
  { id: 'chennai',    name: 'Chennai',       lat: 13.0827, lon: 80.2707, pincode: '600001' },
  { id: 'pune',       name: 'Pune',          lat: 18.5204, lon: 73.8567, pincode: '411001' },
  { id: 'kolkata',    name: 'Kolkata',       lat: 22.5726, lon: 88.3639, pincode: '700001' },
  { id: 'ahmedabad',  name: 'Ahmedabad',     lat: 23.0225, lon: 72.5714, pincode: '380001' },
  { id: 'jaipur',     name: 'Jaipur',        lat: 26.9124, lon: 75.7873, pincode: '302001' },
  { id: 'lucknow',    name: 'Lucknow',       lat: 26.8467, lon: 80.9462, pincode: '226001' },
  { id: 'chandigarh', name: 'Chandigarh',    lat: 30.7333, lon: 76.7794, pincode: '160001' },
  { id: 'kochi',      name: 'Kochi',         lat: 9.9312,  lon: 76.2673, pincode: '682001' },
  { id: 'indore',     name: 'Indore',        lat: 22.7196, lon: 75.8577, pincode: '452001' },
  { id: 'bhopal',     name: 'Bhopal',        lat: 23.2599, lon: 77.4126, pincode: '462001' },
  { id: 'nagpur',     name: 'Nagpur',        lat: 21.1458, lon: 79.0882, pincode: '440001' },
  { id: 'surat',      name: 'Surat',         lat: 21.1702, lon: 72.8311, pincode: '395003' },
  { id: 'coimbatore', name: 'Coimbatore',    lat: 11.0168, lon: 76.9558, pincode: '641001' },
  { id: 'vizag',      name: 'Visakhapatnam', lat: 17.6868, lon: 83.2185, pincode: '530001' },
];

/** Nearest preset city to a coordinate — used after a GPS fix to guess a pincode. */
export function nearestCity(lat, lon) {
  let best = null, bestD = Infinity;
  for (const c of CITIES) {
    // Equirectangular approximation; exact enough to pick a city.
    const dx = (c.lon - lon) * Math.cos(((c.lat + lat) / 2) * Math.PI / 180);
    const dy = c.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c; }
  }
  // ~1.5 degrees ≈ 165km. Beyond that, don't pretend we know the city.
  return bestD < 2.25 ? best : null;
}
