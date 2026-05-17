/**
 * Twitter / X publisher — OAuth 2.0 user context.
 * First run: node setup-twitter.js  to get TWITTER_ACCESS_TOKEN_V2
 */

const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

function getUserClient() {
  const token = process.env.TWITTER_ACCESS_TOKEN_V2;
  if (!token) throw new Error('TWITTER_ACCESS_TOKEN_V2 לא הוגדר — הרץ: node setup-twitter.js');
  return new TwitterApi(token);
}

async function refreshIfNeeded() {
  const refreshToken = process.env.TWITTER_REFRESH_TOKEN;
  if (!refreshToken) return;

  try {
    const client = new TwitterApi({
      clientId: process.env.TWITTER_CLIENT_ID,
      clientSecret: process.env.TWITTER_CLIENT_SECRET,
    });
    const { accessToken, refreshToken: newRefresh } = await client.refreshOAuth2Token(refreshToken);

    // Update .env
    const envPath = path.join(__dirname, '..', '.env');
    let env = fs.readFileSync(envPath, 'utf8');
    env = env.replace(/TWITTER_ACCESS_TOKEN_V2=.*/, `TWITTER_ACCESS_TOKEN_V2=${accessToken}`);
    if (newRefresh) {
      env = env.replace(/TWITTER_REFRESH_TOKEN=.*/, `TWITTER_REFRESH_TOKEN=${newRefresh}`);
    }
    fs.writeFileSync(envPath, env);
    process.env.TWITTER_ACCESS_TOKEN_V2 = accessToken;
    if (newRefresh) process.env.TWITTER_REFRESH_TOKEN = newRefresh;
  } catch (err) {
    console.error('[twitter] token refresh failed:', err.message);
  }
}

/**
 * Post a tweet. Returns { id, url } on success.
 */
async function postTweet(text) {
  const client = getUserClient();
  try {
    const { data } = await client.v2.tweet(text);
    const handle = process.env.TWITTER_HANDLE || 'Knesset_Ground';
    return {
      id: data.id,
      url: `https://twitter.com/${handle}/status/${data.id}`,
    };
  } catch (err) {
    // If 401, try refreshing token and retry once
    if (err.code === 401) {
      await refreshIfNeeded();
      const { data } = await getUserClient().v2.tweet(text);
      const handle = process.env.TWITTER_HANDLE || 'Knesset_Ground';
      return { id: data.id, url: `https://twitter.com/${handle}/status/${data.id}` };
    }
    throw err;
  }
}

/**
 * Validate — returns true if token exists and works.
 */
async function validateCredentials() {
  const token = process.env.TWITTER_ACCESS_TOKEN_V2;
  if (!token) return false;
  try {
    const client = new TwitterApi(token);
    await client.v2.me();
    return true;
  } catch {
    return false;
  }
}

module.exports = { postTweet, validateCredentials };
