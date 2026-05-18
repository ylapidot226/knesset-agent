/**
 * Twitter handles for Knesset 25 MKs and parties.
 * MK names use "FirstName LastName" format matching KNS_Person API fields.
 * Party handles map to the abbreviated/keyword form for fuzzy matching against API faction names.
 */

const MK_HANDLES = {
  // ליכוד
  'בנימין נתניהו':          '@netanyahu',
  'יולי אדלשטיין':          '@yuli_edelstein',
  'ניר ברקת':               '@nirbarkat',
  'מיקי זוהר':              '@zoharmiki',
  'מירי רגב':               '@miriregev',
  'ישראל כץ':               '@israelkatz',
  'חיים כץ':                '@HaimKatz1',
  'יריב לוין':              '@levin_yariv',
  'אמיר אוחנה':             '@AmirOhana',
  'דוד ביטן':               '@David_Bitan',
  'גלית דיסטל-אטבריאן':     '@distelDG',
  'אופיר קץ':               '@ofirkatz',
  'ניסים ואטורי':            '@nissimvaturi',
  'יצחק ברדוגו':            '@BardugoYitzhak',
  'תלי גוטליב':             '@taligotliv',
  'דן אילוז':               '@DanIlouz',
  'שלמה קרעי':              '@shlomo_karai',
  'אריה דרעי':              '@arye_dery',
  // יש עתיד
  'יאיר לפיד':              '@yairlapid',
  'יועז הנדל':              '@yoazhandel',
  'ינון אזולאי':             '@YinonAzulay',
  'מיכל שיר':               '@MichalShir_',
  'אלון טל':                '@alontal_il',
  'יסמין פרידמן':           '@YasminFriedman',
  'מירב כהן':               '@MeiravCohen',
  'עינב קינן':              '@EinavKinan',
  'רם בן ברק':              '@RamBenBarak',
  'כרמל שאמה-הכהן':        '@carmelshama',
  // המחנה הממלכתי
  'בנימין גנץ':             '@gantzbe',
  'גדי אייזנקוט':           '@GadiEisenkot',
  'יואב גלנט':              '@YoavGallant',
  'גדעון סער':              '@gidonsaar',
  'זאב אלקין':              '@ZeevElkin',
  'מתן כהנא':               '@matankahana',
  'חילי טרופר':             '@hilitroper',
  // ציונות דתית
  'בצלאל סמוטריץ':          '@bezalelsm',
  'שמחה רוטמן':             '@rothmar',
  'צבי ידידיה סוכות':       '@zvika_sukkot',
  'אוהד טל':                '@ohad_tal',
  'שמעון סוסן':              '@simonsosan',
  'יצחק קרויזר':            '@KreuzerYitzhak',
  'נטלי בן אחיה':           '@NataliBenAhiya',
  // עוצמה יהודית
  'איתמר בן גביר':          '@itamarbengvir',
  'יצחק וסרלאוף':           '@wasserlauf',
  'לימור סון-הר מלך':       '@LimorSonHarMelekh',
  'יוסי דגן':               '@yossidagan',
  // ישראל ביתנו
  'אביגדור ליברמן':         '@AvigdorLiberman',
  'אבי דיכטר':              '@AviDichter',
  'אודי ר׳קן':               '@udirikun',
  'יואל רזבוזוב':           '@razabozov',
  // עבודה
  'מרב מיכאלי':             '@MeravMichaeli',
  'גלעד קריב':              '@gilad_kariv',
  'נאוה בוקר':              '@navaboker',
  // יהדות התורה
  'משה גפני':               '@moshegafni',
  // חד"ש-תע"ל
  'אחמד טיבי':              '@AhmadTibi',
  'עופר כסיף':              '@oferKassif',
  'עיסאווי פריג':           '@IsawiFreij',
  'יוסף אטאון':             '@yusuf_atawna',
  // רע"מ
  'מנצור עבאס':             '@MansourAbbas_',
  'ואיל טאהא':              '@WaelTaha_Ra',
  'מואז נסאסרה':            '@muaznsasra',
  // נועם
  'אבי מעוז':               '@avimaaoz',
};

// Keyword fragments (lowercase, no spaces) that identify each party from the API's long faction names.
// The API returns names like "הליכוד " or "הציונות הדתית בראשות בצלאל סמוטריץ'"
const FACTION_KEYWORD_MAP = [
  { keywords: ['ליכוד'],                                   handle: '@Likud_Party',       name: 'הליכוד' },
  { keywords: ['יש עתיד'],                                 handle: '@YeshAtidParty',      name: 'יש עתיד' },
  { keywords: ['ימין הממלכתי', 'מחנה הממלכתי', 'כחול לבן'], handle: '@MachaneMamlaht',    name: 'המחנה הממלכתי' },
  { keywords: ['ספרדים שומרי תורה', 'ש"ס', 'שס'],         handle: '@shas_party',         name: 'ש"ס' },
  { keywords: ['יהדות התורה'],                             handle: '@yahaduthatorah',     name: 'יהדות התורה' },
  { keywords: ['ציונות הדתית', 'ציונות דתית'],             handle: '@tzionutdatit',       name: 'הציונות הדתית' },
  { keywords: ['עוצמה יהודית'],                            handle: '@otzma_yehudit',      name: 'עוצמה יהודית' },
  { keywords: ['ישראל ביתנו', 'ביתנו'],                    handle: '@BeytenuEnglish',     name: 'ישראל ביתנו' },
  { keywords: ['העבודה', 'מפלגת העבודה'],                  handle: '@IsraelLabor',        name: 'העבודה' },
  { keywords: ["חד\"ש", 'חדש', "תע\"ל", 'תעל', 'חדש-תעל'], handle: '@Hadash_org',        name: "חד\"ש-תע\"ל" },
  { keywords: ["רע\"מ", 'רעם', 'united arab'],             handle: '@raam_party',         name: "רע\"מ" },
  { keywords: ['נעם', 'אבי מעוז'],                         handle: '@noamparty_il',       name: 'נועם' },
];

/**
 * Returns the Twitter handle for an MK by full name, or null if unknown.
 * Tries exact match first, then partial (last name).
 */
function getMKHandle(fullName) {
  if (!fullName) return null;
  const normalized = fullName.trim();

  if (MK_HANDLES[normalized]) return MK_HANDLES[normalized];

  // Try matching by last name
  const lastName = normalized.split(/\s+/).pop();
  const entry = Object.entries(MK_HANDLES).find(([name]) =>
    name.split(/\s+/).pop() === lastName
  );
  return entry?.[1] ?? null;
}

/**
 * Returns the Twitter handle for a party given the raw API faction name.
 * Uses keyword matching because API returns long names like
 * "הציונות הדתית בראשות בצלאל סמוטריץ'" or "הליכוד " (trailing space).
 */
function getFactionHandle(apiFactionName) {
  if (!apiFactionName) return null;
  const lower = apiFactionName.toLowerCase().trim();

  for (const entry of FACTION_KEYWORD_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return { handle: entry.handle, name: entry.name };
    }
  }
  return null;
}

/**
 * Returns a short display name for a faction, extracted from the API's long name.
 * e.g. "הציונות הדתית בראשות בצלאל סמוטריץ'" → "הציונות הדתית"
 */
function getShortFactionName(apiFactionName) {
  if (!apiFactionName) return null;
  const match = getFactionHandle(apiFactionName);
  return match?.name ?? apiFactionName.trim();
}

module.exports = { MK_HANDLES, FACTION_KEYWORD_MAP, getMKHandle, getFactionHandle, getShortFactionName };
