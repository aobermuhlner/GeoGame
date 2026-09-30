// GeoGuesser: hand-picked estimation questions. The single place to edit them.
//
// Every value is in the quantity's canonical unit (°C, km, m, km², plain numbers) and was checked against the
// source named in its row (checked 2026-09-30). Only facts with a settled figure are here: where sources
// differ a little (river lengths, the shrinking Dead Sea), the commonly cited figure is used and the scoring
// tolerance (see guess.ts) is far wider than the disagreement. Values that change with every heatwave or
// survey (national heat records, fast-growing cities) are deliberately left out.
//
// More questions come from the country statistics in statsData.ts (see guess.ts → statQuestions).
import type { Quantity } from './units';

export interface GuessFact {
  id: string;
  /** Questions of one topic aren't asked twice in a game while other topics are left */
  topic: string;
  quantity: Quantity;
  answer: number;
  text: string;
  /** ISO code of the country it is about (flag + region filter); null for world-wide facts */
  country: string | null;
  /** One more line on the reveal */
  note?: string;
  source: string;
}

// [id, topic, quantity, answer, question, country, source, note?]
type Row = [string, string, Quantity, number, string, string | null, string, string?];

const WIKI = 'Wikipedia';

const RAW: Row[] = [
  // ---------- Mountains ----------
  ['everest', 'mountains', 'elevation', 8849, 'How high is Mount Everest?', 'NP', 'China–Nepal survey 2020', 'The highest mountain on Earth, on the Nepal–China border.'],
  ['k2', 'mountains', 'elevation', 8611, 'How high is K2, the second-highest mountain on Earth?', 'PK', WIKI],
  ['kilimanjaro', 'mountains', 'elevation', 5895, 'How high is Mount Kilimanjaro, the highest mountain in Africa?', 'TZ', WIKI],
  ['denali', 'mountains', 'elevation', 6190, 'How high is Denali, the highest mountain in North America?', 'US', 'USGS survey 2015'],
  ['aconcagua', 'mountains', 'elevation', 6961, 'How high is Aconcagua, the highest mountain in the Americas?', 'AR', WIKI],
  ['mont-blanc', 'mountains', 'elevation', 4806, 'How high is Mont Blanc, the highest mountain of the Alps?', 'FR', WIKI, 'Its snow cap makes it vary by a metre or two between surveys.'],
  ['elbrus', 'mountains', 'elevation', 5642, 'How high is Mount Elbrus, the highest mountain in Europe?', 'RU', WIKI],
  ['fuji', 'mountains', 'elevation', 3776, 'How high is Mount Fuji?', 'JP', 'Geospatial Information Authority of Japan'],
  ['matterhorn', 'mountains', 'elevation', 4478, 'How high is the Matterhorn?', 'CH', WIKI],
  ['kosciuszko', 'mountains', 'elevation', 2228, 'How high is Mount Kosciuszko, the highest mountain in mainland Australia?', 'AU', WIKI],
  ['vinson', 'mountains', 'elevation', 4892, 'How high is Mount Vinson, the highest mountain in Antarctica?', null, WIKI],
  ['mauna-kea', 'mountains', 'elevation', 4207, 'How high above sea level is the summit of Mauna Kea in Hawaii?', 'US', WIKI, 'Measured from its base on the ocean floor it is over 10,000 m tall.'],
  ['ben-nevis', 'mountains', 'elevation', 1345, 'How high is Ben Nevis, the highest mountain in the United Kingdom?', 'GB', 'Ordnance Survey'],
  ['zugspitze', 'mountains', 'elevation', 2962, 'How high is the Zugspitze, the highest mountain in Germany?', 'DE', WIKI],
  ['olympus', 'mountains', 'elevation', 2918, 'How high is Mount Olympus in Greece?', 'GR', WIKI],
  ['chimborazo', 'mountains', 'elevation', 6263, 'How high above sea level is Chimborazo in Ecuador?', 'EC', WIKI, 'Its summit is the point on Earth farthest from the planet’s centre.'],
  ['table-mountain', 'mountains', 'elevation', 1085, 'How high is Table Mountain above Cape Town?', 'ZA', WIKI],

  // ---------- Buildings and structures ----------
  ['burj-khalifa', 'buildings', 'elevation', 828, 'How tall is the Burj Khalifa in Dubai?', 'AE', WIKI, 'The tallest building in the world since 2010.'],
  ['eiffel', 'buildings', 'elevation', 330, 'How tall is the Eiffel Tower (with its antennas)?', 'FR', 'Tour Eiffel (2022)', 'It grew from 324 m to 330 m when a new antenna was added in 2022.'],
  ['liberty', 'buildings', 'elevation', 93, 'How tall is the Statue of Liberty, from the ground to the tip of the torch?', 'US', 'US National Park Service'],
  ['great-pyramid', 'buildings', 'elevation', 146.6, 'How tall was the Great Pyramid of Giza when it was built?', 'EG', WIKI, 'Today it is about 139 m: its smooth outer casing is gone.'],
  ['cristo', 'buildings', 'elevation', 30, 'How tall is the statue of Christ the Redeemer in Rio de Janeiro (without its pedestal)?', 'BR', WIKI],
  ['cn-tower', 'buildings', 'elevation', 553, 'How tall is the CN Tower in Toronto?', 'CA', WIKI],
  ['taipei-101', 'buildings', 'elevation', 508, 'How tall is Taipei 101?', 'TW', WIKI],
  ['great-wall', 'buildings', 'length', 21196, 'How long is the Great Wall of China, counting all its sections?', 'CN', 'State Administration of Cultural Heritage (2012)'],

  // ---------- Rivers ----------
  ['nile', 'rivers', 'length', 6650, 'How long is the Nile?', 'EG', WIKI, 'Usually called the longest river in the world; the Amazon is a close rival.'],
  ['amazon', 'rivers', 'length', 6400, 'How long is the Amazon river?', 'BR', WIKI],
  ['yangtze', 'rivers', 'length', 6300, 'How long is the Yangtze, the longest river in Asia?', 'CN', WIKI],
  ['danube', 'rivers', 'length', 2850, 'How long is the Danube?', null, WIKI, 'It flows through or along 10 countries, more than any other river.'],
  ['rhine', 'rivers', 'length', 1233, 'How long is the Rhine?', 'DE', WIKI],
  ['volga', 'rivers', 'length', 3530, 'How long is the Volga, the longest river in Europe?', 'RU', WIKI],
  ['thames', 'rivers', 'length', 346, 'How long is the River Thames?', 'GB', WIKI],
  ['congo', 'rivers', 'length', 4700, 'How long is the Congo river?', 'CD', WIKI, 'The deepest river in the world, over 220 m in places.'],
  ['mississippi', 'rivers', 'length', 3730, 'How long is the Mississippi river?', 'US', WIKI],
  ['ganges', 'rivers', 'length', 2525, 'How long is the Ganges?', 'IN', WIKI],

  // ---------- Lakes, seas and oceans ----------
  ['caspian', 'lakes', 'area', 371000, 'How large is the Caspian Sea, the largest lake on Earth?', null, WIKI],
  ['superior', 'lakes', 'area', 82100, 'How large is Lake Superior?', 'US', WIKI, 'The largest freshwater lake by area.'],
  ['victoria', 'lakes', 'area', 59947, 'How large is Lake Victoria, Africa’s largest lake?', 'UG', WIKI],
  ['baikal-area', 'lakes', 'area', 31722, 'How large is Lake Baikal (its surface area)?', 'RU', WIKI],
  ['baikal-depth', 'lakes', 'elevation', 1642, 'How deep is Lake Baikal, the deepest lake in the world?', 'RU', WIKI],
  ['titicaca', 'lakes', 'elevation', 3812, 'At what altitude does Lake Titicaca lie?', 'BO', WIKI],
  ['geneva', 'lakes', 'area', 580, 'How large is Lake Geneva?', 'CH', WIKI],
  ['challenger', 'oceans', 'elevation', 10935, 'How deep is the Challenger Deep in the Mariana Trench, the deepest point of the ocean?', null, WIKI, 'Surveys give 10,902–10,994 m.'],
  ['dead-sea', 'oceans', 'elevation', 440, 'How far below sea level is the shore of the Dead Sea, the lowest land on Earth?', 'IL', WIKI + ' (2025)', 'It keeps sinking by about a metre a year.'],
  ['ocean-share', 'oceans', 'percent', 71, 'What share of the Earth’s surface is covered by water?', null, 'USGS'],
  ['fresh-water', 'oceans', 'percent', 2.5, 'What share of all water on Earth is fresh water?', null, 'USGS', 'Most of it is frozen in ice sheets and glaciers.'],

  // ---------- Islands, deserts, land ----------
  ['greenland', 'islands', 'area', 2166086, 'How large is Greenland, the largest island in the world?', null, WIKI],
  ['madagascar', 'islands', 'area', 587041, 'How large is Madagascar?', 'MG', WIKI],
  ['borneo', 'islands', 'area', 743330, 'How large is Borneo, the island shared by Indonesia, Malaysia and Brunei?', 'ID', WIKI],
  ['great-britain', 'islands', 'area', 209331, 'How large is the island of Great Britain?', 'GB', WIKI],
  ['tasmania', 'islands', 'area', 68401, 'How large is the island of Tasmania?', 'AU', WIKI],
  ['sahara', 'land', 'area', 9200000, 'How large is the Sahara desert?', null, WIKI, 'About as big as the United States or China.'],
  ['antarctica', 'land', 'area', 14200000, 'How large is Antarctica?', null, WIKI],
  ['indonesia-islands', 'counts', 'count', 17380, 'How many islands does Indonesia officially have?', 'ID', 'Geospatial Information Agency of Indonesia (2024)'],
  ['philippines-islands', 'counts', 'count', 7641, 'How many islands make up the Philippines?', 'PH', 'NAMRIA'],
  ['finland-lakes', 'counts', 'count', 187888, 'How many lakes (larger than 500 m²) does Finland have?', 'FI', 'Finnish Environment Institute'],

  // ---------- Climate records ----------
  ['hottest', 'climate', 'temperature', 56.7, 'What is the highest air temperature ever recorded on Earth (Death Valley, 1913)?', 'US', 'WMO'],
  ['coldest', 'climate', 'temperature', -89.2, 'What is the lowest temperature ever measured on Earth (Vostok Station, Antarctica, 1983)?', null, 'WMO'],
  ['europe-hot', 'climate', 'temperature', 48.8, 'What is the highest temperature ever recorded in Europe (Sicily, 2021)?', 'IT', 'WMO'],
  ['greenland-cold', 'climate', 'temperature', -69.6, 'What is the coldest temperature ever recorded in the Northern Hemisphere (Greenland, 1991)?', null, 'WMO'],
  ['uk-hot', 'climate', 'temperature', 40.3, 'What is the highest temperature ever recorded in the United Kingdom (2022)?', 'GB', 'Met Office'],
  ['south-pole', 'climate', 'temperature', -49, 'What is the average yearly temperature at the South Pole?', null, 'US National Science Foundation'],

  // ---------- Cities ----------
  ['la-paz', 'cities', 'elevation', 3640, 'At what altitude lies La Paz, Bolivia’s seat of government?', 'BO', WIKI],
  ['quito', 'cities', 'elevation', 2850, 'At what altitude lies Quito, the capital of Ecuador?', 'EC', WIKI],
  ['mexico-city', 'cities', 'elevation', 2240, 'At what altitude lies Mexico City?', 'MX', WIKI],
  ['denver', 'cities', 'elevation', 1609, 'At what altitude lies Denver, the “Mile High City”?', 'US', WIKI, 'Exactly one mile: 5,280 ft.'],

  // ---------- Borders and counts ----------
  ['china-neighbours', 'borders', 'count', 14, 'How many countries share a land border with China?', 'CN', WIKI, 'Tied with Russia for the most neighbours.'],
  ['brazil-neighbours', 'borders', 'count', 10, 'How many countries share a land border with Brazil?', 'BR', WIKI],
  ['germany-neighbours', 'borders', 'count', 9, 'How many countries share a land border with Germany?', 'DE', WIKI],
  ['russia-timezones', 'borders', 'count', 11, 'How many time zones does Russia span?', 'RU', WIKI],
  ['africa-countries', 'borders', 'count', 54, 'How many UN-recognised countries are there in Africa?', null, 'United Nations'],
  ['un-members', 'borders', 'count', 193, 'How many member states does the United Nations have?', null, 'United Nations'],
  ['swiss-cantons', 'borders', 'count', 26, 'How many cantons does Switzerland have?', 'CH', WIKI],
  ['sa-languages', 'borders', 'count', 12, 'How many official languages does South Africa have?', 'ZA', 'Constitution of South Africa (2023)', 'South African Sign Language became the 12th in 2023.'],

  // ---------- Distances ----------
  ['equator', 'distances', 'length', 40075, 'How long is the equator?', null, WIKI],
  ['earth-diameter', 'distances', 'length', 12742, 'What is the diameter of the Earth (on average)?', null, WIKI],
  ['trans-siberian', 'distances', 'length', 9289, 'How long is the Trans-Siberian Railway from Moscow to Vladivostok?', 'RU', WIKI],
  ['chile-length', 'distances', 'length', 4270, 'How long is Chile from north to south?', 'CL', WIKI],
  ['dover', 'distances', 'length', 33, 'How wide is the Strait of Dover between England and France at its narrowest?', 'GB', WIKI],
  ['bering', 'distances', 'length', 82, 'How wide is the Bering Strait between Russia and Alaska at its narrowest?', null, WIKI],
  ['panama-canal', 'distances', 'length', 82, 'How long is the Panama Canal?', 'PA', WIKI],
  ['suez-canal', 'distances', 'length', 193, 'How long is the Suez Canal?', 'EG', WIKI],
  ['channel-tunnel', 'distances', 'length', 50.45, 'How long is the Channel Tunnel between England and France?', 'GB', WIKI],
  ['arctic-circle', 'distances', 'degrees', 66.56, 'At what latitude (degrees north) lies the Arctic Circle?', null, WIKI],
  ['tropic-cancer', 'distances', 'degrees', 23.44, 'At what latitude (degrees north) lies the Tropic of Cancer?', null, WIKI],

  // ---------- Waterfalls and canyons ----------
  ['angel-falls', 'waterfalls', 'elevation', 979, 'How high is Angel Falls in Venezuela, the tallest waterfall in the world?', 'VE', WIKI],
  ['victoria-falls', 'waterfalls', 'elevation', 108, 'How high is Victoria Falls?', 'ZM', WIKI],
  ['grand-canyon', 'waterfalls', 'elevation', 1857, 'How deep is the Grand Canyon at its deepest?', 'US', 'US National Park Service'],

  // ---------- When? ----------
  ['everest-ascent', 'history', 'year', 1953, 'In which year did Hillary and Tenzing first reach the summit of Mount Everest?', 'NP', WIKI],
  ['south-pole-reached', 'history', 'year', 1911, 'In which year did Amundsen’s expedition first reach the South Pole?', null, WIKI],
  ['suez-opened', 'history', 'year', 1869, 'In which year did the Suez Canal open?', 'EG', WIKI],
  ['panama-opened', 'history', 'year', 1914, 'In which year did the Panama Canal open?', 'PA', WIKI],
  ['eiffel-built', 'history', 'year', 1889, 'In which year was the Eiffel Tower completed?', 'FR', WIKI],
  ['brasilia', 'history', 'year', 1960, 'In which year did Brasília become the capital of Brazil?', 'BR', WIKI],
  ['australia-federation', 'history', 'year', 1901, 'In which year did Australia’s colonies unite as one country?', 'AU', WIKI],
  ['india-independence', 'history', 'year', 1947, 'In which year did India become independent?', 'IN', WIKI],
  ['brazil-independence', 'history', 'year', 1822, 'In which year did Brazil declare independence from Portugal?', 'BR', WIKI],
  ['norway-independence', 'history', 'year', 1905, 'In which year did Norway leave its union with Sweden?', 'NO', WIKI],
  ['south-sudan', 'history', 'year', 2011, 'In which year did South Sudan become independent?', 'SS', WIKI, 'The world’s newest widely recognised country.'],
  ['krakatoa', 'history', 'year', 1883, 'In which year did Krakatoa erupt catastrophically?', 'ID', WIKI],
  ['pompeii', 'history', 'year', 79, 'In which year (AD) did Vesuvius bury Pompeii?', 'IT', WIKI],
  ['magellan', 'history', 'year', 1522, 'In which year did the first voyage around the world (Magellan–Elcano) return to Spain?', 'ES', WIKI],
  ['berlin-wall', 'history', 'year', 1989, 'In which year did the Berlin Wall fall?', 'DE', WIKI],
  ['channel-tunnel-opened', 'history', 'year', 1994, 'In which year did the Channel Tunnel open?', 'GB', WIKI],
];

export const GUESS_FACTS: GuessFact[] = RAW.map(([id, topic, quantity, answer, text, country, source, note]) => ({
  id,
  topic,
  quantity,
  answer,
  text,
  country,
  source,
  ...(note ? { note } : {}),
}));
