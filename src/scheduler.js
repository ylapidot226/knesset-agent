const cron = require('node-cron');
const stateManager = require('./state');
const knesset = require('./knesset');
const ai = require('./ai');
const { sendTweetPairForApproval, flushQueue, notify } = require('./bot');

const CRON_EXPR = '*/30 8-23 * * *';
const TZ = 'Asia/Jerusalem';
const MAX_PER_ENTITY = 3;

const FETCH_SPECS = [
  { entity: 'KNS_PlenumSession',    fn: (id) => knesset.fetchNewSincePlenumSessions(id),    type: 'session'    },
  { entity: 'KNS_PlenumVote',       fn: (id) => knesset.fetchNewSinceVotes(id),             type: 'votes'      },
  { entity: 'KNS_CommitteeSession', fn: (id) => knesset.fetchNewSinceCommitteeSessions(id), type: 'committees' },
  { entity: 'KNS_Bill',             fn: (id) => knesset.fetchNewSinceBills(id),             type: 'bills'      },
  { entity: 'KNS_Query',            fn: (id) => knesset.fetchNewSinceQueries(id),           type: 'queries'    },
];

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

  stateManager.clearSentItemsIfNewDay();
  console.log('[scheduler] starting cycle at', new Date().toISOString());

  let totalQueued = 0;

  for (const spec of FETCH_SPECS) {
    const sinceId = stateManager.getLastSeenId(spec.entity);
    console.log(`[scheduler] checking ${spec.entity} since id=${sinceId}`);

    let items;
    try {
      items = await spec.fn(sinceId);
      stateManager.updateLastFetch();
    } catch (err) {
      console.error(`[scheduler] fetch failed for ${spec.entity}:`, err.message);
      await notify(`⚠️ שגיאה בשליפת ${spec.entity}: ${err.message}`);
      continue;
    }

    if (!items || items.length === 0) {
      console.log(`[scheduler] no new items for ${spec.entity}`);
      continue;
    }

    items.sort((a, b) => a.id - b.id);

    const tz = 'Asia/Jerusalem';
    const today     = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: tz });
    const recentItems = items.filter((i) => {
      const d = i.activityDate ?? i.date;
      return !d || d >= yesterday;
    });

    if (recentItems.length === 0) {
      console.log(`[scheduler] no recent items (today/yesterday) for ${spec.entity}`);
      continue;
    }

    const validIds = new Set(recentItems.map((i) => i.id));

    let sent = 0;
    for (const item of recentItems) {

      if (stateManager.hasItemBeenSent(item.id)) {
        stateManager.setLastSeenId(spec.entity, item.id);
        continue;
      }

      if (sent >= MAX_PER_ENTITY) {
        console.log(`[scheduler] hit limit of ${MAX_PER_ENTITY} for ${spec.entity}, stopping (next cycle continues from id=${item.id - 1})`);
        break;
      }

      let pair;
      try {
        pair = await ai.generateTweetPair(item, spec.type, config, validIds);
      } catch (err) {
        console.error(`[scheduler] generateTweetPair failed for ${spec.entity} id=${item.id}:`, err.message);
        stateManager.setLastSeenId(spec.entity, item.id);
        continue;
      }

      if (!pair) {
        stateManager.setLastSeenId(spec.entity, item.id);
        continue;
      }

      stateManager.enqueue(pair, { itemId: item.id, source: 'auto', entity: spec.entity });
      stateManager.markItemSent(item.id);
      stateManager.setLastSeenId(spec.entity, item.id);
      sent++;
      totalQueued++;
      console.log(`[scheduler] queued pair for ${spec.entity} id=${item.id}`);
    }
  }

  if (totalQueued > 0) {
    console.log(`[scheduler] ${totalQueued} pairs queued — flushing first`);
    await flushQueue();
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
