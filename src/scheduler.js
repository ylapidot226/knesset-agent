const cron = require('node-cron');
const stateManager = require('./state');
const knesset = require('./knesset');
const ai = require('./ai');
const { sendTweetPairForApproval, sendTweetForApproval, notify } = require('./bot');

const CRON_EXPR = '0 9,11,13,15,17,19,21 * * *';
const TZ = 'Asia/Jerusalem';

let cronTask = null;

const DAY_FETCH_MAP = {
  Sunday:    { fn: () => knesset.fetchNewBillsThisWeek(),         type: 'bills' },
  Monday:    { fn: () => knesset.fetchTodaysPlenaryAgenda(),      type: 'agenda' },
  Tuesday:   { fn: () => knesset.fetchRecentVotesWithResults(),   type: 'votes' },
  Wednesday: { fn: () => knesset.fetchTodaysCommitteeSessions(),  type: 'committees' },
  Thursday:  { fn: () => knesset.fetchQueriesThisWeek(),          type: 'queries' },
  Friday:    { fn: () => knesset.fetchWeeklyMKActivity(),         type: 'weekly' },
};

async function runCycle() {
  if (stateManager.isCronPaused()) {
    console.log('[scheduler] paused — skipping cycle');
    return;
  }

  const config = stateManager.readConfig();
  if (!config.cronActive) {
    console.log('[scheduler] cronActive=false — skipping');
    return;
  }

  stateManager.clearSentItemsIfNewDay();

  const dayOfWeek = new Date().toLocaleString('en-US', { weekday: 'long', timeZone: 'Asia/Jerusalem' });
  console.log('[scheduler] starting cycle at', new Date().toISOString(), 'day:', dayOfWeek);

  if (dayOfWeek === 'Saturday') {
    console.log('[scheduler] שבת — מדלג');
    return;
  }

  const dayConfig = DAY_FETCH_MAP[dayOfWeek];
  if (!dayConfig) {
    console.log('[scheduler] לא נמצא config ליום:', dayOfWeek);
    return;
  }

  let fetchedItems;
  try {
    fetchedItems = await dayConfig.fn();
    stateManager.updateLastFetch();
  } catch (err) {
    console.error('[scheduler] knesset fetch failed:', err.message);
    await notify(`⚠️ שגיאה בשליפת נתוני כנסת: ${err.message}`);
    return;
  }

  if (!fetchedItems || fetchedItems.length === 0) {
    console.log('[scheduler] no items found');
    await notify('אין נתונים זמינים כרגע מאתר הכנסת');
    return;
  }

  const validIds = new Set(fetchedItems.map((i) => i.id));
  let processed = 0;

  for (const item of fetchedItems) {
    if (processed >= 50) break;
    if (stateManager.hasItemBeenSent(item.id)) continue;

    let pair;
    try {
      pair = await ai.generateTweetPair(item, dayConfig.type, config, validIds);
    } catch (err) {
      console.error('[scheduler] generateTweetPair failed:', err.message);
      continue;
    }

    if (!pair) continue;

    stateManager.markItemSent(item.id);
    try {
      await sendTweetPairForApproval(pair, { itemId: item.id, source: 'auto' });
      processed++;
    } catch (err) {
      console.error('[scheduler] failed to send pair to Telegram:', err.message);
    }
  }

  if (processed === 0) {
    console.log('[scheduler] no new pairs generated this cycle');
  }
}

function startScheduler() {
  if (cronTask) {
    cronTask.stop();
  }

  cronTask = cron.schedule(CRON_EXPR, runCycle, {
    timezone: TZ,
    scheduled: true,
  });

  console.log(`[scheduler] cron started (${CRON_EXPR} ${TZ})`);
  return cronTask;
}

function stopScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('[scheduler] stopped');
  }
}

module.exports = { startScheduler, stopScheduler, runCycle };
