const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'state.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {
      pausedUntil: null,
      pendingTweets: {},
      editContext: {},
      publishedTweets: [],
      lastFetchTime: null,
    };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {
      tone: 'casual_sharp',
      maxLength: 250,
      preferredTopics: ['votes', 'attendance', 'committees'],
      includeHashtags: true,
      cronActive: true,
      intervalHours: 2,
      language: 'he',
      styleNotes: 'דבר כמו חבר חכם שמספר לחבר מה קרה.',
    };
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function isCronPaused() {
  const state = readState();
  if (!state.pausedUntil) return false;
  if (state.pausedUntil === 'forever') return true;
  return new Date(state.pausedUntil) > new Date();
}

function pauseCron(until = 'forever') {
  const state = readState();
  state.pausedUntil = until;
  writeState(state);
}

function resumeCron() {
  const state = readState();
  state.pausedUntil = null;
  writeState(state);
}

function addPendingTweet(messageId, data) {
  const state = readState();
  state.pendingTweets[String(messageId)] = data;
  writeState(state);
}

function getPendingTweet(messageId) {
  const state = readState();
  return state.pendingTweets[String(messageId)] || null;
}

function removePendingTweet(messageId) {
  const state = readState();
  delete state.pendingTweets[String(messageId)];
  writeState(state);
}

function setEditContext(chatId, data) {
  const state = readState();
  state.editContext[String(chatId)] = data;
  writeState(state);
}

function getEditContext(chatId) {
  const state = readState();
  return state.editContext[String(chatId)] || null;
}

function clearEditContext(chatId) {
  const state = readState();
  delete state.editContext[String(chatId)];
  writeState(state);
}

function recordPublished(tweet, twitterId) {
  const state = readState();
  if (!Array.isArray(state.publishedTweets)) state.publishedTweets = [];
  state.publishedTweets.push({
    text: tweet,
    twitterId,
    publishedAt: new Date().toISOString(),
  });
  // keep last 500
  if (state.publishedTweets.length > 500) {
    state.publishedTweets = state.publishedTweets.slice(-500);
  }
  writeState(state);
}

function getWeeklyStats() {
  const state = readState();
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const tweets = (state.publishedTweets || []).filter(
    (t) => new Date(t.publishedAt) >= oneWeekAgo
  );
  return { count: tweets.length, tweets };
}

function updateLastFetch() {
  const state = readState();
  state.lastFetchTime = new Date().toISOString();
  writeState(state);
}

function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

function clearSentItemsIfNewDay() {
  const state = readState();
  if (!state.sentItemIds) state.sentItemIds = {};
  const today = todayKey();
  const keys = Object.keys(state.sentItemIds);
  const stale = keys.filter((k) => k !== today);
  if (stale.length) {
    for (const k of stale) delete state.sentItemIds[k];
    writeState(state);
  }
}

function hasItemBeenSent(itemId) {
  const state = readState();
  const today = todayKey();
  return Array.isArray(state.sentItemIds?.[today]) && state.sentItemIds[today].includes(String(itemId));
}

function markItemSent(itemId) {
  const state = readState();
  if (!state.sentItemIds) state.sentItemIds = {};
  const today = todayKey();
  if (!Array.isArray(state.sentItemIds[today])) state.sentItemIds[today] = [];
  if (!state.sentItemIds[today].includes(String(itemId))) {
    state.sentItemIds[today].push(String(itemId));
  }
  writeState(state);
}

// ── Tweet queue ───────────────────────────────────────────────────────────

function enqueue(pair, meta) {
  const state = readState();
  if (!Array.isArray(state.tweetQueue)) state.tweetQueue = [];
  state.tweetQueue.push({ pair, meta });
  writeState(state);
}

function dequeue() {
  const state = readState();
  if (!Array.isArray(state.tweetQueue) || state.tweetQueue.length === 0) return null;
  const item = state.tweetQueue.shift();
  writeState(state);
  return item;
}

function getQueueLength() {
  const state = readState();
  return (state.tweetQueue || []).length;
}

function hasPendingApprovals() {
  const state = readState();
  return Object.keys(state.pendingTweets || {}).length > 0;
}

// ── Weekly report cache ────────────────────────────────────────────────────

function getWeeklyReportCache() {
  const state = readState();
  return state.weeklyReportCache ?? null;
}

function setWeeklyReportCache(data) {
  const state = readState();
  state.weeklyReportCache = { ...data, cachedAt: new Date().toISOString() };
  writeState(state);
}

// ── Last-seen ID watermarks (per entity) ──────────────────────────────────

function getLastSeenId(entity) {
  const state = readState();
  return state.lastSeenIds?.[entity] ?? 0;
}

function setLastSeenId(entity, id) {
  if (!id || id <= 0) return;
  const state = readState();
  if (!state.lastSeenIds) state.lastSeenIds = {};
  if (id > (state.lastSeenIds[entity] ?? 0)) {
    state.lastSeenIds[entity] = id;
    writeState(state);
  }
}

module.exports = {
  readState,
  writeState,
  readConfig,
  writeConfig,
  isCronPaused,
  pauseCron,
  resumeCron,
  addPendingTweet,
  getPendingTweet,
  removePendingTweet,
  setEditContext,
  getEditContext,
  clearEditContext,
  recordPublished,
  getWeeklyStats,
  updateLastFetch,
  hasItemBeenSent,
  markItemSent,
  clearSentItemsIfNewDay,
  getLastSeenId,
  setLastSeenId,
  enqueue,
  dequeue,
  getQueueLength,
  hasPendingApprovals,
  getWeeklyReportCache,
  setWeeklyReportCache,
};
