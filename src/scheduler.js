/**
 * Cron scheduler — runs every 2 hours between 09:00 and 21:00 (Israel time).
 * Fetches Knesset data, generates a tweet via Claude, sends to Telegram for approval.
 */

const cron = require('node-cron');
const stateManager = require('./state');
const knesset = require('./knesset');
const ai = require('./ai');
const { sendTweetForApproval, notify } = require('./bot');

// "At minute 0 of every 2nd hour, from 9 through 21" in Asia/Jerusalem
// cron expression: 0 9,11,13,15,17,19,21 * * *
const CRON_EXPR = '0 9,11,13,15,17,19,21 * * *';
const TZ = 'Asia/Jerusalem';

let cronTask = null;

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

  console.log('[scheduler] starting cycle at', new Date().toISOString());

  let activity;
  try {
    activity = await knesset.fetchRecentActivity();
    stateManager.updateLastFetch();
  } catch (err) {
    console.error('[scheduler] knesset fetch failed:', err.message);
    await notify(`⚠️ שגיאה בשליפת נתוני כנסת: ${err.message}`);
    return;
  }

  const hasActivity =
    (activity.votes?.length > 0) ||
    (activity.committeeSessions?.length > 0) ||
    (activity.plenumSessions?.length > 0) ||
    (activity.rawSummary?.length > 100);

  if (!hasActivity) {
    console.log('[scheduler] no activity found — skipping this cycle');
    return;
  }

  let tweet;
  try {
    tweet = await ai.generateTweet(activity, config);
  } catch (err) {
    console.error('[scheduler] tweet generation failed:', err.message);
    await notify(`⚠️ שגיאה ביצירת ציוץ: ${err.message}`);
    return;
  }

  if (!tweet) {
    console.log('[scheduler] AI returned null — no tweet-worthy content found');
    return;
  }

  console.log('[scheduler] sending tweet for approval:', tweet.slice(0, 80) + '...');

  try {
    await sendTweetForApproval(tweet, {
      source: 'auto',
      fetchedAt: activity.fetchedAt,
    });
  } catch (err) {
    console.error('[scheduler] failed to send to Telegram:', err.message);
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
