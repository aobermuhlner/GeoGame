// Countries by how well known they are, best known first — the single place to edit ranked division pools.
// Keyed by ISO 3166-1 alpha-2 (upper case). One string per division, about 40 countries each.
//
// Score: 60% Wikipedia pageviews Jan 2023–Dec 2025 over 15 language editions (en es ja de ru fr zh pt it ar fa
// id tr ko hi; log scale per language, each country's best and worst language dropped), 20% population and
// 20% GDP (World Bank, log scale). Manual tweaks: Israel moved from Bronze to Silver, Belgium up into Bronze.

export const FAME_TIERS: readonly string[] = [
  // Bronze: 1–40
  'US CN RU JP IN GB DE TR FR CA IR IT AU ID KR ES BR PK SA NL ' +
    'SG UA CH EG MX TH TW VN PL BD AR ZA KP AE MA PH KZ SY MY BE',
  // Silver: 41–80
  'IL NG SE PT NZ NO AF GE AT GR AZ RO IE UZ IQ MM CO DK CZ FI ' +
    'HU ET LB DZ PS LK VE CD CU YE RS AL JO CL QA NP SD KH AM CY',
  // Gold: 81–121
  'LU HR PE MN BY TZ IS TM BG OM MG SK MT LY DO KE LT SI BA KG ' +
    'XK EC TN CI MC KW BF MV TJ HT MU BO GH EE AO BH UG MD NE PG LV',
  // Platinum: 122–161
  'SO SV LA ME MK RW UY ML PA GT ZW SN BN JM CR CM GY SS LI MR ' +
    'MZ CV TD PY NA SR ER BT NI HN CG AD GN BJ LR FJ GQ SL SZ VA',
  // Diamond: 162–197
  'BI TT TL ZM BW BS GA SM SC BB BZ DJ MW LS TG CF GM GW VU WS ' +
    'KM LC KI SB KN GD NR TO PW DM ST TV AG FM MH VC',
];
