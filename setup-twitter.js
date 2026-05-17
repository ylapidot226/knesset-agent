/**
 * One-time Twitter OAuth 2.0 setup.
 * Run: node setup-twitter.js
 * Then open the URL, authorize, paste the redirect URL back.
 */
require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const readline = require('readline');
const fs = require('fs');
const axios = require('axios');

const CLIENT_ID = process.env.TWITTER_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
const CALLBACK = 'https://example.com';

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('חסר TWITTER_CLIENT_ID או TWITTER_CLIENT_SECRET ב-.env');
    process.exit(1);
  }

  const client = new TwitterApi({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

  const { url, codeVerifier, state } = client.generateOAuth2AuthLink(CALLBACK, {
    scope: ['tweet.write', 'tweet.read', 'users.read', 'offline.access'],
  });

  console.log('\n══════════════════════════════════════');
  console.log('1. פתח את הקישור הזה בדפדפן:');
  console.log('\n' + url + '\n');
  console.log('2. אשר את החיבור לחשבון @Knesset_Ground');
  console.log('3. תועבר לכתובת כמו:');
  console.log('   https://example.com?state=xxx&code=yyy');
  console.log('4. העתק את כל הכתובת שקיבלת (מה-https ועד הסוף)');
  console.log('══════════════════════════════════════\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('הדבק כאן את הכתובת המלאה: ', async (input) => {
    rl.close();
    try {
      const redirectUrl = new URL(input.trim());
      const code = redirectUrl.searchParams.get('code');
      const returnedState = redirectUrl.searchParams.get('state');

      if (!code) { console.error('לא מצאתי code בכתובת'); process.exit(1); }
      if (returnedState !== state) { console.error('state לא תואם — נסה שוב'); process.exit(1); }

      // Manual token exchange with Basic Auth (required for confidential clients)
      const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
      const tokenResp = await axios.post(
        'https://api.twitter.com/2/oauth2/token',
        new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          redirect_uri: CALLBACK,
          code_verifier: codeVerifier,
        }).toString(),
        {
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      const accessToken = tokenResp.data.access_token;
      const refreshToken = tokenResp.data.refresh_token;

      // Save to .env
      let env = fs.readFileSync('.env', 'utf8');
      if (env.includes('TWITTER_ACCESS_TOKEN_V2=')) {
        env = env.replace(/TWITTER_ACCESS_TOKEN_V2=.*/, `TWITTER_ACCESS_TOKEN_V2=${accessToken}`);
      } else {
        env += `\nTWITTER_ACCESS_TOKEN_V2=${accessToken}`;
      }
      if (refreshToken) {
        if (env.includes('TWITTER_REFRESH_TOKEN=')) {
          env = env.replace(/TWITTER_REFRESH_TOKEN=.*/, `TWITTER_REFRESH_TOKEN=${refreshToken}`);
        } else {
          env += `\nTWITTER_REFRESH_TOKEN=${refreshToken}`;
        }
      }
      fs.writeFileSync('.env', env);

      console.log('\n✅ מחובר בהצלחה! הטוקן נשמר ב-.env');
      console.log('עכשיו הפעל: node index.js');
    } catch (err) {
      console.error('שגיאה:', err.message);
      console.error('פרטים:', JSON.stringify(err.response?.data || err.data || {}, null, 2));
      console.error('סטטוס:', err.response?.status);
    }
  });
}

main();
