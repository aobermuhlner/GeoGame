// Landmarks game: famous places, shown as a zoomed-in photo; the answer is the country.
// The single place to edit the list. After adding one, run `node worker/scripts/fetch-landmarks.mjs`:
// it downloads the photo (the English Wikipedia article's lead image, or `file`) to worker/landmarks/<id>.jpg
// and writes coordinates + credits to landmarkMeta.ts. Photos are only served through random per-round
// tokens, like flags, so a file name never gives the answer away.
//
// Only landmarks that clearly belong to one country (no border waterfalls or mountains).

export interface Landmark {
  /** Also the photo's file name */
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 of the country it is in (the answer) */
  country: string;
  /** English Wikipedia article (its lead photo is used unless `file` is set) */
  wiki: string;
  /** Wikimedia Commons file to use instead of the article's lead photo */
  file?: string;
  /** Point the photo zooms out from, as fractions of its width and height (default: the centre) */
  focus?: [number, number];
}

// [id, name, country, wiki article, focus?, commons file?]
type Row = [string, string, string, string, ([number, number] | null)?, string?];

const RAW: Row[] = [
  // Europe
  ['eiffel-tower', 'Eiffel Tower', 'FR', 'Eiffel Tower', [0.5, 0.55]],
  ['mont-saint-michel', 'Mont-Saint-Michel', 'FR', 'Mont-Saint-Michel', [0.52, 0.38]],
  ['colosseum', 'Colosseum', 'IT', 'Colosseum', [0.3, 0.45]],
  ['leaning-tower-of-pisa', 'Leaning Tower of Pisa', 'IT', 'Leaning Tower of Pisa', [0.44, 0.5]],
  ['sagrada-familia', 'Sagrada Família', 'ES', 'Sagrada Família', [0.52, 0.5]],
  ['alhambra', 'Alhambra', 'ES', 'Alhambra', [0.3, 0.5]],
  ['big-ben', 'Big Ben', 'GB', 'Big Ben', [0.5, 0.55]],
  ['stonehenge', 'Stonehenge', 'GB', 'Stonehenge'],
  ['tower-bridge', 'Tower Bridge', 'GB', 'Tower Bridge', [0.43, 0.42]],
  ['brandenburg-gate', 'Brandenburg Gate', 'DE', 'Brandenburg Gate', [0.62, 0.6]],
  ['neuschwanstein', 'Neuschwanstein Castle', 'DE', 'Neuschwanstein Castle', [0.3, 0.45]],
  ['cologne-cathedral', 'Cologne Cathedral', 'DE', 'Cologne Cathedral', [0.5, 0.55]],
  ['parthenon', 'Parthenon', 'GR', 'Parthenon', [0.55, 0.45]],
  ['st-basils-cathedral', "Saint Basil's Cathedral", 'RU', "Saint Basil's Cathedral", [0.46, 0.5]],
  ['charles-bridge', 'Charles Bridge', 'CZ', 'Charles Bridge', [0.55, 0.65]],
  ['hungarian-parliament', 'Hungarian Parliament Building', 'HU', 'Hungarian Parliament Building', [0.5, 0.55]],
  ['belem-tower', 'Belém Tower', 'PT', 'Belém Tower', [0.55, 0.4]],
  ['st-peters-basilica', "St. Peter's Basilica", 'VA', "St. Peter's Basilica", [0.5, 0.45]],
  ['chapel-bridge', 'Chapel Bridge, Lucerne', 'CH', 'Chapel Bridge', [0.68, 0.3]],
  ['kinderdijk', 'Windmills of Kinderdijk', 'NL', 'Kinderdijk', [0.35, 0.45]],
  ['dubrovnik', 'Dubrovnik city walls', 'HR', 'Walls of Dubrovnik', [0.55, 0.5]],
  ['hallgrimskirkja', 'Hallgrímskirkja', 'IS', 'Hallgrímskirkja', [0.4, 0.45]],
  ['cliffs-of-moher', 'Cliffs of Moher', 'IE', 'Cliffs of Moher', [0.7, 0.55]],
  ['geirangerfjord', 'Geirangerfjord', 'NO', 'Geirangerfjord', [0.55, 0.6]],
  ['atomium', 'Atomium', 'BE', 'Atomium', [0.5, 0.45]],
  ['wawel-castle', 'Wawel Castle', 'PL', 'Wawel Castle', [0.45, 0.45]],
  ['schonbrunn', 'Schönbrunn Palace', 'AT', 'Schönbrunn Palace', [0.5, 0.52]],
  ['bran-castle', 'Bran Castle', 'RO', 'Bran Castle', [0.6, 0.4]],
  ['stari-most', 'Stari Most', 'BA', 'Stari Most', [0.42, 0.5]],
  // Asia
  ['taj-mahal', 'Taj Mahal', 'IN', 'Taj Mahal'],
  ['golden-temple', 'Golden Temple', 'IN', 'Golden Temple', [0.5, 0.45]],
  ['great-wall', 'Great Wall of China', 'CN', 'Great Wall of China', [0.72, 0.5]],
  ['forbidden-city', 'Forbidden City', 'CN', 'Forbidden City', [0.5, 0.4], 'Sunset of the Forbidden City 2006.JPG'],
  ['potala-palace', 'Potala Palace', 'CN', 'Potala Palace', [0.5, 0.66]],
  ['angkor-wat', 'Angkor Wat', 'KH', 'Angkor Wat', [0.5, 0.4]],
  ['petronas-towers', 'Petronas Towers', 'MY', 'Petronas Towers', [0.6, 0.35], '2016 Kuala Lumpur, Petronas Towers (26).jpg'],
  ['burj-khalifa', 'Burj Khalifa', 'AE', 'Burj Khalifa', [0.78, 0.3], 'Dubai skyline 2015 (crop).jpg'],
  ['mount-fuji', 'Mount Fuji', 'JP', 'Mount Fuji'],
  ['fushimi-inari', 'Fushimi Inari-taisha', 'JP', 'Fushimi Inari-taisha', [0.6, 0.5]],
  ['petra', 'Petra', 'JO', 'Petra', [0.45, 0.5]],
  ['marina-bay-sands', 'Marina Bay Sands', 'SG', 'Marina Bay Sands', [0.5, 0.4]],
  ['borobudur', 'Borobudur', 'ID', 'Borobudur', [0.5, 0.45]],
  ['hagia-sophia', 'Hagia Sophia', 'TR', 'Hagia Sophia', [0.47, 0.5]],
  ['shwedagon', 'Shwedagon Pagoda', 'MM', 'Shwedagon Pagoda', [0.47, 0.55]],
  ['wat-arun', 'Wat Arun', 'TH', 'Wat Arun'],
  ['ha-long-bay', 'Ha Long Bay', 'VN', 'Ha Long Bay', [0.3, 0.62]],
  ['registan', 'Registan', 'UZ', 'Registan', [0.3, 0.6]],
  ['taipei-101', 'Taipei 101', 'TW', 'Taipei 101', [0.52, 0.3], 'Taipei Taiwan Taipei-101-Tower-01.jpg'],
  ['gyeongbokgung', 'Gyeongbokgung', 'KR', 'Gyeongbokgung', [0.5, 0.66]],
  ['sigiriya', 'Sigiriya', 'LK', 'Sigiriya', [0.45, 0.3]],
  ['persepolis', 'Persepolis', 'IR', 'Persepolis', [0.45, 0.45]],
  ['tigers-nest', "Tiger's Nest", 'BT', 'Paro Taktsang', [0.35, 0.6]],
  ['chocolate-hills', 'Chocolate Hills', 'PH', 'Chocolate Hills', [0.6, 0.6], 'Chocolate Hills overview.JPG'],
  ['boudhanath', 'Boudhanath', 'NP', 'Boudhanath', [0.5, 0.4]],
  // Africa
  ['pyramids-of-giza', 'Pyramids of Giza', 'EG', 'Giza pyramid complex', [0.5, 0.45]],
  ['abu-simbel', 'Abu Simbel', 'EG', 'Abu Simbel', [0.3, 0.45]],
  ['table-mountain', 'Table Mountain', 'ZA', 'Table Mountain', [0.35, 0.52]],
  ['kilimanjaro', 'Mount Kilimanjaro', 'TZ', 'Mount Kilimanjaro', [0.6, 0.5]],
  ['djenne-mosque', 'Great Mosque of Djenné', 'ML', 'Great Mosque of Djenné', [0.5, 0.4]],
  ['ait-benhaddou', 'Aït Benhaddou', 'MA', 'Aït Benhaddou', [0.35, 0.5]],
  ['lalibela', 'Church of Saint George, Lalibela', 'ET', 'Church of Saint George, Lalibela', [0.5, 0.4]],
  ['avenue-of-the-baobabs', 'Avenue of the Baobabs', 'MG', 'Avenue of the Baobabs', [0.6, 0.5]],
  ['el-jem', 'Amphitheatre of El Jem', 'TN', 'Amphitheatre of El Jem', [0.5, 0.45]],
  ['sossusvlei', 'Sossusvlei', 'NA', 'Sossusvlei'],
  ['great-zimbabwe', 'Great Zimbabwe', 'ZW', 'Great Zimbabwe', [0.4, 0.4]],
  ['our-lady-of-peace', 'Basilica of Our Lady of Peace', 'CI', 'Basilica of Our Lady of Peace', [0.6, 0.4], 'Basilique notre Dame de la Paix de Yamoussoukro 9.jpg'],
  ['goree', 'Gorée', 'SN', 'Gorée', [0.5, 0.6]],
  // North America
  ['statue-of-liberty', 'Statue of Liberty', 'US', 'Statue of Liberty', [0.53, 0.3]],
  ['golden-gate-bridge', 'Golden Gate Bridge', 'US', 'Golden Gate Bridge', [0.5, 0.45]],
  ['mount-rushmore', 'Mount Rushmore', 'US', 'Mount Rushmore', [0.4, 0.45]],
  ['grand-canyon', 'Grand Canyon', 'US', 'Grand Canyon', [0.4, 0.55]],
  ['space-needle', 'Space Needle', 'US', 'Space Needle', [0.5, 0.3]],
  ['cn-tower', 'CN Tower', 'CA', 'CN Tower', [0.52, 0.4], 'Toronto - ON - Skyline bei Nacht.jpg'],
  ['chateau-frontenac', 'Château Frontenac', 'CA', 'Château Frontenac', [0.5, 0.5]],
  ['moraine-lake', 'Moraine Lake', 'CA', 'Moraine Lake', [0.5, 0.4]],
  ['chichen-itza', 'Chichén Itzá', 'MX', 'Chichen Itza', [0.5, 0.55]],
  ['teotihuacan', 'Teotihuacan', 'MX', 'Teotihuacan', [0.45, 0.6]],
  ['bellas-artes', 'Palacio de Bellas Artes', 'MX', 'Palacio de Bellas Artes', [0.5, 0.45]],
  // Central America
  ['tikal', 'Tikal', 'GT', 'Tikal', [0.7, 0.55]],
  ['santa-catalina-arch', 'Santa Catalina Arch, Antigua', 'GT', 'Antigua Guatemala', [0.5, 0.5]],
  ['panama-canal', 'Panama Canal', 'PA', 'Miraflores Locks', [0.6, 0.35], 'Panama Canal Miraflores Locks.jpg'],
  ['arenal', 'Arenal Volcano', 'CR', 'Arenal Volcano', [0.5, 0.4]],
  ['great-blue-hole', 'Great Blue Hole', 'BZ', 'Great Blue Hole', [0.5, 0.4]],
  ['copan', 'Copán', 'HN', 'Copán'],
  ['leon-cathedral', 'León Cathedral', 'NI', 'León Cathedral, Nicaragua', [0.4, 0.45]],
  // Caribbean
  ['el-capitolio', 'El Capitolio', 'CU', 'El Capitolio', [0.58, 0.35]],
  ['citadelle-laferriere', 'Citadelle Laferrière', 'HT', 'Citadelle Laferrière', [0.55, 0.35]],
  ['pitons', 'Pitons', 'LC', 'Pitons (Saint Lucia)', [0.72, 0.45]],
  ['dunns-river-falls', "Dunn's River Falls", 'JM', "Dunn's River Falls", [0.4, 0.45]],
  ['alcazar-de-colon', 'Alcázar de Colón', 'DO', 'Alcázar de Colón', [0.6, 0.45]],
  // South America
  ['machu-picchu', 'Machu Picchu', 'PE', 'Machu Picchu', [0.6, 0.6]],
  ['christ-the-redeemer', 'Christ the Redeemer', 'BR', 'Christ the Redeemer (statue)', [0.5, 0.35]],
  ['sugarloaf', 'Sugarloaf Mountain', 'BR', 'Sugarloaf Mountain', [0.45, 0.4]],
  ['moai', 'Moai (Easter Island)', 'CL', 'Moai', [0.4, 0.55]],
  ['torres-del-paine', 'Torres del Paine', 'CL', 'Torres del Paine National Park', [0.55, 0.45], 'Towers of Paine - Torres del Paine National Park 13.jpg'],
  ['salar-de-uyuni', 'Salar de Uyuni', 'BO', 'Salar de Uyuni'],
  ['angel-falls', 'Angel Falls', 'VE', 'Angel Falls', [0.5, 0.45]],
  ['perito-moreno', 'Perito Moreno Glacier', 'AR', 'Perito Moreno Glacier', [0.55, 0.55]],
  ['obelisco', 'Obelisco de Buenos Aires', 'AR', 'Obelisco de Buenos Aires', [0.5, 0.45]],
  ['las-lajas', 'Las Lajas Sanctuary', 'CO', 'Las Lajas Sanctuary', [0.62, 0.3]],
  ['kaieteur-falls', 'Kaieteur Falls', 'GY', 'Kaieteur Falls', [0.45, 0.35]],
  ['galapagos', 'Galápagos Islands', 'EC', 'Galápagos Islands', [0.55, 0.62]],
  // Oceania
  ['sydney-opera-house', 'Sydney Opera House', 'AU', 'Sydney Opera House', [0.62, 0.45]],
  ['uluru', 'Uluru', 'AU', 'Uluru', [0.5, 0.55]],
  ['twelve-apostles', 'Twelve Apostles', 'AU', 'The Twelve Apostles (Victoria)', [0.4, 0.62]],
  ['milford-sound', 'Milford Sound', 'NZ', 'Milford Sound'],
  ['sky-tower', 'Sky Tower', 'NZ', 'Sky Tower (Auckland)', [0.53, 0.2]],
  ['nan-madol', 'Nan Madol', 'FM', 'Nan Madol', [0.5, 0.55]],
];

export const LANDMARKS: Landmark[] = RAW.map(([id, name, country, wiki, focus, file]) => ({
  id,
  name,
  country,
  wiki,
  ...(file ? { file } : {}),
  ...(focus ? { focus } : {}),
}));
