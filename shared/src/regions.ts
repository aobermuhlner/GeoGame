// Region assignment table — the single place to edit which country belongs where.
// Keyed by ISO 3166-1 alpha-2 (upper case). Kosovo uses the user-assigned code XK.

export const REGION_IDS = [
  'europe',
  'asia',
  'africa',
  'oceania',
  'north-america',
  'central-america',
  'caribbean',
  'south-america',
] as const;

export type RegionId = (typeof REGION_IDS)[number];

export const REGION_LABELS: Record<RegionId, string> = {
  europe: 'Europe',
  asia: 'Asia',
  africa: 'Africa',
  oceania: 'Oceania',
  'north-america': 'North America',
  'central-america': 'Central America',
  caribbean: 'Caribbean',
  'south-america': 'South America',
};

const TABLE: Record<RegionId, string> = {
  // Russia and Cyprus are counted as Europe.
  europe:
    'AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA XK',
  // Turkey, Kazakhstan, Georgia, Armenia, Azerbaijan are counted as Asia.
  asia:
    'AF AM AZ BH BD BT BN KH CN GE IN ID IR IQ IL JP JO KZ KW KG LA LB MY MV MN MM NP KP OM PK PH QA SA SG KR LK SY TJ TH TL TR TM AE UZ VN YE PS TW',
  // Egypt is counted as Africa.
  africa:
    'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW',
  oceania: 'AU FJ KI MH FM NR NZ PW PG WS SB TO TV VU',
  'north-america': 'US CA MX',
  'central-america': 'BZ GT HN SV NI CR PA',
  caribbean: 'CU JM HT DO BS BB TT GD LC VC AG DM KN',
  'south-america': 'AR BO BR CL CO EC GY PY PE SR UY VE',
};

export const REGION_OF: Record<string, RegionId> = {};
for (const id of REGION_IDS) {
  for (const code of TABLE[id].split(/\s+/)) REGION_OF[code] = id;
}
