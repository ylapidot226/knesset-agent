/**
 * OpenAI integration (GPT-4o).
 * Handles:
 *  1. generateTweet(activityData, config)
 *  2. rewriteTweet(tweet, instruction, config)
 *  3. interpretCommand(text, state, config)
 *  4. generateCustomTweet(instruction, knessetContext, config)
 *  5. explainNoData(instruction)
 */

const OpenAI = require('openai');

let client;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const MODEL = 'gpt-4o';

// ── Shared system prompt ───────────────────────────────────────────────────

const STYLE_SYSTEM = `אתה עוזר שכותב ציוצים בעברית על פעילות חברי כנסת.

═══ מה שזמין בנתונים (OdataV4 רשמי של הכנסת בלבד) ═══
✓ הצבעות: כותרת, תאריך, ספירות (בעד / נגד / נוכח / נעדרים)
✓ תוצאות הצבעה לפי ח"כ: שם, קוד תוצאה (בעד / נגד / נוכח)
✓ ישיבות ועדות: שם ועדה, תאריך, סדר יום
✓ ישיבות מליאה: מספר, תאריך, פריטי סדר יום
✓ שאילתות (שאלות לממשלה): שם ח"כ, תאריך הגשה, נושא
✓ הצעות חוק: שם, סוג, תאריך עדכון, שם מגיש
✓ שיוך סיעתי: סיעה ותפקידים של כל ח"כ

═══ מה שאינו קיים בנתונים — אסור לציין ═══
✗ נוכחות/היעדרות — endpoint זה לא קיים ב-API
✗ ידיות טוויטר — ה-API לא מכיל אותן
✗ קיזוזים (קיזוז) — לא קיים ב-API
✗ פוסטים ברשתות חברתיות — לא קיים ב-API
✗ ציטוטים — לא קיים ב-API
✗ כל מידע שלא הופיע במפורש בנתונים שנמסרו

═══ כלל ברזל: ספק = null ═══
אם יש ספק אם עובדה מופיעה בנתונים — החזר null.
עדיף לא לפרסם מאשר לפרסם עובדה לא מאומתת.
אסור להסתמך על חדשות, ynet, וואלה, הארץ, OpenKnesset, או זיכרון מאימון.

═══ כללים נוספים ═══
• אל תזכיר משכורות, תשלומים, כסף אישי
• אל תיגע במראה, במשפחה, בחיים האישיים
• אין תארים ושמות תואר — רק עובדות מספריות מדויקות
• אין ציטוטים ישנים — רק מה שמופיע בנתונים שנמסרו
• אף פעם לא מתחת לחגורה

═══ סגנון ═══
קול: בנאדם חכם שמדבר עם חבר. לא עיתונאי, לא פרופסור. "תשמע, תראה מה קרה."
עוקצני בגובה העיניים — כזה שכולם מבינים.
כל שורה = עובדה אחת בלבד.
מספרים ספציפיים — לא "הרבה פעמים" אלא "7 פעמים".
המשפט האחרון תמיד הקצר ביותר — לפעמים מילה אחת.
בסוף: #כנסת + האשטג אחד רלוונטי (ידית טוויטר — רק אם מופיעה בנתונים).

═══ דוגמאות (מבנה בלבד — המספרים בדיוניים) ═══

על הצבעה שנפלה:
הצעת הוזלת מחירי מזון נפלה היום.
בעד: 41 | נגד: 62.
נפלה.
#כנסת #מזון

על ח"כ ששאל הרבה שאלות:
כהן הגיש 8 שאילתות השבוע.
כולן למשרד האוצר.
עסוק.
#כנסת #תקציב

על הצבעה שעברה בקושי:
הצעת חוק X עברה היום בקריאה ראשונה.
בעד: 61 | נגד: 59.
בקושי.
#כנסת

על ועדה:
ועדת הכספים דנה היום בתקציב החינוך.
הגיעו 4 מתוך 12 חברים.
המשיכו בכל זאת.
#כנסת #חינוך

על ח"כ שהגיש הצעת חוק:
לוי הגיש היום הצעת חוק בנושא X.
הצעה מספר 5 שלו מתחילת הכנסת.
מתמיד.
#כנסת`;

// ── Fact validation ────────────────────────────────────────────────────────

function validateTweetFacts(tweet, sourceData) {
  const sourceText = typeof sourceData === 'string'
    ? sourceData
    : sourceData?.rawSummary ?? JSON.stringify(sourceData ?? '');

  const today = new Date().toISOString().slice(0, 10);

  // Check full ISO dates in tweet are not in the future and exist in source
  const datePattern = /\b(\d{4}-\d{2}-\d{2})\b/g;
  let dm;
  while ((dm = datePattern.exec(tweet)) !== null) {
    const d = dm[1];
    if (d > today) {
      console.error(`[ai] validation FAILED — date "${d}" is in the future`);
      return false;
    }
    if (!sourceText.includes(d)) {
      console.error(`[ai] validation FAILED — date "${d}" not found in source data`);
      return false;
    }
  }

  // Check standalone numbers (not part of a date) appear in source
  const tweetNoISO = tweet.replace(/\d{4}-\d{2}-\d{2}/g, '');
  const numbers = tweetNoISO.match(/\b\d+\b/g) ?? [];
  for (const num of numbers) {
    if (!sourceText.includes(num)) {
      console.error(`[ai] validation FAILED — number "${num}" not found in source data`);
      return false;
    }
  }

  // Reject any mention of news sites or external sources
  const bannedSources = [
    'israelhayom', 'ynet', 'walla', 'haaretz', 'maariv', 'kan.org', 'n12',
    'מקור:', 'לפי דיווח', 'לפי ynet', 'לפי וואלה', 'לפי הארץ',
  ];
  for (const src of bannedSources) {
    if (tweet.toLowerCase().includes(src.toLowerCase())) {
      console.error(`[ai] validation FAILED — tweet contains banned source reference: "${src}"`);
      return false;
    }
  }

  // Reject Twitter handles (@ mentions) — API has no Twitter data
  if (/@\S+/.test(tweet)) {
    console.error('[ai] validation FAILED — tweet contains @ mention (not in API data)');
    return false;
  }

  // Check MK names after ח"כ pattern exist in source
  const mkPattern = /ח["'״]כ\s+([א-ת]+(?:\s+[א-ת]+)?)/g;
  let m;
  while ((m = mkPattern.exec(tweet)) !== null) {
    const name = m[1].trim();
    if (!sourceText.includes(name)) {
      console.error(`[ai] validation FAILED — MK name "${name}" not found in source data`);
      return false;
    }
  }

  return true;
}

async function chat(systemPrompt, userPrompt, maxTokens = 500) {
  const resp = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() || null;
}

// ── Tweet generation ───────────────────────────────────────────────────────

async function generateTweet(activityData, config) {
  const maxLen = config.maxLength || 250;
  const topics = (config.preferredTopics || []).join(', ');
  const styleNotes = config.styleNotes || '';

  const endpointsUsed = activityData?.usedEndpoints?.join(', ') ?? 'OData רשמי של הכנסת';
  const dataText = activityData?.rawSummary
    ? `נתונים רשמיים מ-OData הכנסת (${activityData.fetchedAt?.slice(0, 10)}):\n\n${activityData.rawSummary}`
    : `נתוני כנסת:\n${JSON.stringify(activityData, null, 2)}`;

  const topicsLine = topics ? `נושאים מועדפים: ${topics}` : '';
  const styleNotesLine = styleNotes ? `הערות נוספות: ${styleNotes}` : '';

  const prompt = `${dataText}

הנתונים שלמעלה הם אמיתיים. כל שורת נתון מכילה [ID:X] — זה המזהה הרשמי ב-OData.

בחר רשומה אחת מעניינת וכתוב עליה ציוץ.

מבנה הציוץ:
- 3-4 שורות קצרות, כל שורה = עובדה אחת
- מספרים מדויקים מהנתונים בלבד
- השורה האחרונה הקצרה ביותר — לפעמים מילה אחת
- בשורה אחרונה: #כנסת + האשטג אחד רלוונטי
- הכל בעברית
${topicsLine}
${styleNotesLine}
אורך מקסימלי: ${maxLen} תווים

כללים נוקשים:
- אסור לציין מקורות חדשות (ynet, וואלה, הארץ, ישראל היום וכו')
- אסור להוסיף "@ידיות" — ה-API אינו מכיל ידיות טוויטר
- אסור להשתמש במידע שלא הופיע במפורש בנתונים שלמעלה

החזר JSON בלבד בפורמט הזה:
{
  "sourceId": <המספר מה-[ID:X] של הרשומה שבחרת>,
  "sourceType": "vote" | "committee" | "session" | "query" | "bill",
  "date": "YYYY-MM-DD",
  "tweet": "<הציוץ המלא>"
}

אם הנתונים ריקים לחלוטין — החזר: null`;

  const raw = await chat(STYLE_SYSTEM, prompt);
  if (!raw || raw.trim() === 'null') return null;

  let parsed;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON found');
    parsed = JSON.parse(match[0]);
  } catch (e) {
    console.error('[ai] failed to parse structured response:', e.message, '| raw:', raw.slice(0, 200));
    return null;
  }

  const { sourceId, sourceType, date, tweet } = parsed;

  if (!tweet || !sourceId) {
    console.error('[ai] missing tweet or sourceId in response');
    return null;
  }

  // Verify sourceId exists in the actual fetched data
  const validIds = activityData?.validIds;
  if (validIds && !validIds.has(Number(sourceId)) && !validIds.has(String(sourceId))) {
    console.error(`[ai] VERIFY FAILED — sourceId ${sourceId} (${sourceType}) not in fetched data. Possible hallucination.`);
    return null;
  }

  const endpoint = endpointForType(sourceType);
  console.log(`[VERIFY] ציוץ מבוסס על: endpoint=${endpoint}, ID=${sourceId}, תאריך=${date}`);

  if (!validateTweetFacts(tweet, activityData)) {
    console.error('[ai] tweet rejected by fact validator — not publishing');
    return null;
  }

  return tweet;
}

function endpointForType(sourceType) {
  const map = {
    vote:      'KNS_PlenumVote',
    committee: 'KNS_CommitteeSession',
    session:   'KNS_PlenumSession',
    query:     'KNS_Query',
    bill:      'KNS_Bill',
  };
  return map[sourceType] ?? sourceType;
}

// ── Rewrite with instruction ───────────────────────────────────────────────

async function rewriteTweet(currentTweet, instruction, config) {
  const maxLen = config.maxLength || 250;

  const prompt = `הציוץ הנוכחי:
"${currentTweet}"

בקשת עריכה מהמשתמש: "${instruction}"

שנה את הציוץ בהתאם לבקשה. אל תמציא עובדות חדשות שאינן בציוץ המקורי.
אורך מקסימלי: ${maxLen} תווים.
החזר רק את הציוץ המעודכן, ללא הסברים.`;

  const result = await chat(STYLE_SYSTEM, prompt);
  return result || currentTweet;
}

// ── Interpret Hebrew natural-language command ──────────────────────────────

const COMMAND_SYSTEM = `אתה עוזר שמנתח פקודות טבעיות בעברית ומחזיר JSON מובנה בלבד.

פקודות אפשריות:
- pause_today: להפסיק ציוצים אוטומטיים להיום
- pause_forever: להפסיק ציוצים עד הוראה חדשה
- resume: להתחיל שוב לשלוח ציוצים
- stats: סטטיסטיקות (כמה ציוצים פורסמו)
- write_tweet: לכתוב ציוץ ספציפי לפי בקשה
- change_style: לשנות הגדרות סגנון
- knesset_info: שאלה עובדתית על הכנסת — מי הח"כים של סיעה מסוימת, מה עשה ח"כ מסוים, וכו'
- unknown: שיחה כללית שלא קשורה לכנסת

כלל חשוב: כל שאלה עובדתית על ח"כ, סיעה, הצבעה, ועדה — חייבת להיות knesset_info, לא unknown.

החזר JSON בלבד בפורמט:
{
  "action": "pause_today" | "pause_forever" | "resume" | "stats" | "write_tweet" | "change_style" | "knesset_info" | "unknown",
  "subject": "שם ח\"כ או שם סיעה אם רלוונטי",
  "subjectType": "mk" | "faction" | "general" | null,
  "instruction": "ההוראה המלאה כמו שהמשתמש כתב",
  "styleChanges": { "tone": "...", "maxLength": 250, "includeHashtags": true }
}`;

async function interpretCommand(text, state, config) {
  const prompt = `הגדרות נוכחיות: ${JSON.stringify(config)}
מצב נוכחי: ${JSON.stringify({ pausedUntil: state.pausedUntil })}

פקודת המשתמש: "${text}"`;

  const raw = await chat(COMMAND_SYSTEM, prompt, 300);
  if (!raw) return { action: 'unknown' };
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { action: 'unknown' };
  } catch {
    return { action: 'unknown' };
  }
}

// ── Generate custom tweet on demand ───────────────────────────────────────

async function generateCustomTweet(instruction, knessetContext, config) {
  const maxLen = config.maxLength || 250;
  const hashtags = config.includeHashtags ? 'כן' : 'לא';

  const endpointsUsed = knessetContext?.usedEndpoints?.join(', ') ?? null;
  const contextSection = knessetContext?.rawSummary
    ? `\nנתונים רשמיים מ-OData הכנסת${endpointsUsed ? ' (' + endpointsUsed + ')' : ''}:\n${knessetContext.rawSummary}\n`
    : knessetContext
      ? `\nנתוני כנסת:\n${JSON.stringify(knessetContext, null, 2)}\n`
      : '\n⚠️ לא נמצאו נתוני כנסת עדכניים מאומתים לנושא הזה.\n';

  const prompt = `בקשת המשתמש: "${instruction}"
${contextSection}
כתוב ציוץ בהתאם לבקשה.
${!knessetContext ? 'אם אין מידע מאומת — החזר: null' : ''}
אורך מקסימלי: ${maxLen} תווים

החזר רק את הציוץ, ללא הסברים. אם אין מידע מאומת — החזר בדיוק: null`;

  const text = await chat(STYLE_SYSTEM, prompt);
  if (!text || text === 'null') return null;

  if (!validateTweetFacts(text, knessetContext)) {
    console.error('[ai] custom tweet rejected by fact validator — not publishing');
    return null;
  }

  return text;
}

// ── Explain refusal ────────────────────────────────────────────────────────

async function explainNoData(instruction) {
  const prompt = `המשתמש ביקש: "${instruction}"
אין לי נתונים מאומתים ממקורות רשמיים לכתוב על זה.
כתוב תשובה קצרה בעברית (1-2 משפטים) שמסבירה שלא מצאתי מידע מאומת לנושא הזה.`;

  const result = await chat('אתה עוזר ידידותי בעברית.', prompt, 150);
  return result || 'לא מצאתי מידע מאומת לנושא הזה.';
}

// ── Free conversation ──────────────────────────────────────────────────────

const CHAT_SYSTEM = `אתה עוזר שמנהל חשבון טוויטר בשם "כנסת מהשטח".
אתה מדבר עברית שוטפת וישירה.

כללי ברזל:
- אם נמסר לך מידע מה-API — ענה רק על בסיסו. אל תוסיף עובדות משלך.
- אם לא נמסר מידע ונשאלת שאלה עובדתית על כנסת — אמור במפורש: "אין לי את הנתונים האלה כרגע, נסה לשאול שוב בניסוח שאוכל לחפש."
- אל תנחש שמות ח"כים, תפקידים, הצבעות, או כל עובדה כנסתית מזיכרון.
- על שאלות על ניהול הבוט (ציוצים, הגדרות) — ענה בחופשיות.
תענה קצר וישיר.`;

async function freeChat(userMessage, apiContext = '') {
  const contextBlock = apiContext
    ? `נתונים שנשלפו מה-API הרשמי של הכנסת:\n${apiContext}\n\n`
    : '';
  const prompt = `${contextBlock}המשתמש שואל: "${userMessage}"`;

  const result = await chat(CHAT_SYSTEM, prompt, 300);
  return result || 'סליחה, לא הבנתי. נסה שוב.';
}

module.exports = {
  generateTweet,
  rewriteTweet,
  interpretCommand,
  generateCustomTweet,
  explainNoData,
  freeChat,
  validateTweetFacts,
};
