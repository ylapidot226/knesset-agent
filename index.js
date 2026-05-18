require('dotenv').config();

const { createBot, notify } = require('./src/bot');
const { startScheduler } = require('./src/scheduler');
const { validateCredentials } = require('./src/twitter');

async function main() {
  console.log('=== Knesset Twitter Agent starting ===');

  // Validate required env vars
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'OPENAI_API_KEY',
    'TWITTER_API_KEY',
    'TWITTER_API_SECRET',
    'TWITTER_ACCESS_TOKEN',
    'TWITTER_ACCESS_SECRET',
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error('Missing environment variables:', missing.join(', '));
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  // Start Telegram bot
  try {
    createBot();
  } catch (err) {
    console.error('Failed to start Telegram bot:', err.message);
    process.exit(1);
  }

  // Validate Twitter credentials
  const twitterOk = await validateCredentials();
  if (!twitterOk) {
    console.warn('[main] Twitter credentials invalid — tweets will fail to publish');
    await notify('⚠️ פרטי הגישה לטוויטר לא תקינים. ציוצים לא יפורסמו עד שיתוקן.');
  } else {
    console.log('[main] Twitter credentials OK');
  }

  // Start cron scheduler
  startScheduler();

  await notify('הסוכן עלה. בדיקות כל 30 דקות בין 8:00 ל-23:30.');

  console.log('=== Agent running ===');
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
