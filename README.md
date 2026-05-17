# Knesset Twitter Agent

סוכן Node.js שמנהל חשבון טוויטר על פעילות חברי כנסת, עובד דרך Telegram ומשתמש ב-Claude AI.

## ארכיטקטורה

```
index.js
├── src/bot.js        — Telegram bot (אישורים, עריכות, פקודות עברית)
├── src/scheduler.js  — cron כל 2 שעות 9:00–21:00
├── src/knesset.js    — שליפה מ-oknesset.org + knesset.gov.il
├── src/ai.js         — Claude: יצירת ציוצים + הבנת פקודות
├── src/twitter.js    — פרסום לטוויטר
└── src/state.js      — ניהול state.json + config.json
```

## התקנה

```bash
cd knesset-agent
npm install
cp .env.example .env
# ערוך את .env עם המפתחות שלך
node index.js
```

## משתני סביבה (`.env`)

| משתנה | תיאור |
|---|---|
| `TELEGRAM_BOT_TOKEN` | טוקן מ-@BotFather |
| `TELEGRAM_CHAT_ID` | מזהה הצ'אט שלך (שלח /start לבוט ותראה את המזהה) |
| `ANTHROPIC_API_KEY` | מפתח API של Anthropic |
| `TWITTER_API_KEY` | מ-developer.twitter.com (OAuth 1.0a) |
| `TWITTER_API_SECRET` | |
| `TWITTER_ACCESS_TOKEN` | |
| `TWITTER_ACCESS_SECRET` | |
| `TWITTER_HANDLE` | שם המשתמש שלך בטוויטר (ללא @) |

### איך לקבל Twitter API

1. נכנס ל-[developer.twitter.com](https://developer.twitter.com)
2. צור App חדש עם **Read and Write** permissions
3. ב-Keys and Tokens: צור **Access Token and Secret**

### איך לקבל Chat ID

1. שלח הודעה לבוט שלך
2. הבוט ישלח בחזרה את ה-Chat ID שלך אוטומטית

## פקודות בטלגרם

| פקודה | תוצאה |
|---|---|
| `כתוב ציוץ על [שם]` | יוצר ציוץ על חבר כנסת ספציפי |
| `תפסיק לשלוח ציוצים היום` | עוצר עד חצות |
| `תפסיק לשלוח ציוצים` | עוצר עד הוראה חדשה |
| `תתחיל לשלוח שוב` | מאפשר מחדש |
| `כמה ציוצים פרסמתי השבוע` | סטטיסטיקות 7 ימים |
| `שנה סגנון ליותר עממי` | מעדכן config.json |
| `שנה אורך ציוץ ל-200` | מעדכן maxLength |

## config.json

```json
{
  "tone": "casual_sharp",
  "maxLength": 250,
  "preferredTopics": ["votes", "attendance", "committees", "bills"],
  "includeHashtags": true,
  "cronActive": true,
  "intervalHours": 2,
  "styleNotes": "..."
}
```

## זרימת עבודה

```
cron (כל 2 שעות)
  → knesset.fetchRecentActivity()     [oknesset.org]
  → ai.generateTweet(data, config)    [Claude]
  → bot.sendTweetForApproval()        [Telegram]
      ↓
  [✅] → twitter.postTweet()          [Twitter]
  [✏️] → "מה לשנות?" → ai.rewriteTweet() → sendTweetForApproval()
  [❌] → נמחק
```

## מקורות מידע

- **oknesset.org/api/v2/** — הצבעות, נוכחות, קיזוזים, ישיבות ועדות
- **knesset.gov.il** — מידע רשמי
- **חדשות (ynet, וואלה, הארץ)** — לאימות בלבד, לא כמקור מספרים

## כלל ברזל

⚠️ הסוכן **לא מפרסם עובדות שאינן מאומתות**. אם ה-AI לא מוצא נתון רשמי — הוא מחזיר `null` ולא נשלח ציוץ.
