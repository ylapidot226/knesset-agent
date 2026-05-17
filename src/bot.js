/**
 * Telegram bot — handles:
 *  • Incoming messages (Hebrew natural-language commands)
 *  • Callback queries (✅ Publish | ✏️ Edit | ❌ Reject)
 *  • Approval/edit flow for auto-generated and custom tweets
 */

const TelegramBot = require('node-telegram-bot-api');
const stateManager = require('./state');
const ai = require('./ai');
const twitter = require('./twitter');
const knesset = require('./knesset');

let bot;

const APPROVE_PREFIX = 'approve:';
const EDIT_PREFIX = 'edit:';
const REJECT_PREFIX = 'reject:';

function createBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

  bot = new TelegramBot(token, { polling: true });

  bot.on('callback_query', handleCallbackQuery);
  bot.on('message', handleMessage);
  bot.on('polling_error', (err) => console.error('[bot] polling error:', err.message));

  console.log('[bot] started, polling for messages...');
  return bot;
}

// ── Approval flow ──────────────────────────────────────────────────────────

async function sendTweetForApproval(tweetText, meta = {}) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.error('[bot] TELEGRAM_CHAT_ID not set');
    return null;
  }

  // First send without buttons
  const msg = await bot.sendMessage(
    chatId,
    `📝 *ציוץ לאישור:*\n\n${escapeMarkdown(tweetText)}`,
    { parse_mode: 'Markdown' }
  );

  const mid = msg.message_id;

  // Store pending tweet
  stateManager.addPendingTweet(mid, { text: tweetText, meta });

  // Add buttons referencing the real message id
  await bot.editMessageReplyMarkup(
    {
      inline_keyboard: [
        [
          { text: '✅ פרסם', callback_data: `${APPROVE_PREFIX}${mid}` },
          { text: '✏️ ערוך', callback_data: `${EDIT_PREFIX}${mid}` },
          { text: '❌ דחה', callback_data: `${REJECT_PREFIX}${mid}` },
        ],
      ],
    },
    { chat_id: chatId, message_id: mid }
  );

  return msg;
}

// ── Callback handler ───────────────────────────────────────────────────────

async function handleCallbackQuery(query) {
  const { data, message } = query;
  const chatId = message.chat.id;

  await bot.answerCallbackQuery(query.id);

  if (data.startsWith(APPROVE_PREFIX)) {
    const mid = data.slice(APPROVE_PREFIX.length);
    await handleApprove(chatId, mid, message);
  } else if (data.startsWith(EDIT_PREFIX)) {
    const mid = data.slice(EDIT_PREFIX.length);
    await handleEditRequest(chatId, mid, message);
  } else if (data.startsWith(REJECT_PREFIX)) {
    const mid = data.slice(REJECT_PREFIX.length);
    await handleReject(chatId, mid, message);
  }
}

async function handleApprove(chatId, messageId, origMessage) {
  const pending = stateManager.getPendingTweet(messageId);
  if (!pending) {
    await bot.sendMessage(chatId, '⚠️ הציוץ כבר לא קיים.');
    return;
  }

  try {
    const result = await twitter.postTweet(pending.text);
    stateManager.recordPublished(pending.text, result.id);
    stateManager.removePendingTweet(messageId);

    await bot.editMessageText(
      `✅ *פורסם!*\n\n${escapeMarkdown(pending.text)}\n\n🔗 ${result.url}`,
      { chat_id: chatId, message_id: origMessage.message_id, parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('[bot] twitter post failed:', err.message);
    await bot.sendMessage(chatId, `❌ שגיאה בפרסום: ${err.message}`);
  }
}

async function handleEditRequest(chatId, messageId, origMessage) {
  const pending = stateManager.getPendingTweet(messageId);
  if (!pending) {
    await bot.sendMessage(chatId, '⚠️ הציוץ כבר לא קיים.');
    return;
  }

  // Save edit context so next message from user is treated as the edit instruction
  stateManager.setEditContext(chatId, {
    messageId,
    originalText: pending.text,
    origMessageId: origMessage.message_id,
  });

  await bot.sendMessage(chatId, '✏️ *מה לשנות?* כתוב לי את ההוראה:', {
    parse_mode: 'Markdown',
  });
}

async function handleReject(chatId, messageId, origMessage) {
  const pending = stateManager.getPendingTweet(messageId);
  stateManager.removePendingTweet(messageId);

  await bot.editMessageText(
    `❌ *נדחה*\n\n~~${escapeMarkdown(pending?.text || '')}~~`,
    { chat_id: chatId, message_id: origMessage.message_id, parse_mode: 'Markdown' }
  );
}

// ── Message handler ────────────────────────────────────────────────────────

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || msg.via_bot) return;

  // Only respond to the configured chat id
  if (String(chatId) !== String(process.env.TELEGRAM_CHAT_ID)) {
    await bot.sendMessage(chatId, `מזהה הצ'אט שלך: \`${chatId}\``, { parse_mode: 'Markdown' });
    return;
  }

  // Check if user is in edit-instruction mode
  const editCtx = stateManager.getEditContext(chatId);
  if (editCtx) {
    await handleEditInstruction(chatId, text, editCtx);
    return;
  }

  // Interpret free-form Hebrew command
  await handleFreeCommand(chatId, text);
}

async function handleEditInstruction(chatId, instruction, editCtx) {
  stateManager.clearEditContext(chatId);

  const config = stateManager.readConfig();
  const typingMsg = await bot.sendMessage(chatId, '⏳ מעדכן את הציוץ...');

  try {
    const updated = await ai.rewriteTweet(editCtx.originalText, instruction, config);

    // Delete typing indicator
    await bot.deleteMessage(chatId, typingMsg.message_id);

    // Remove old pending and send updated tweet for re-approval
    stateManager.removePendingTweet(editCtx.messageId);

    // Update original message to show it was edited
    try {
      await bot.editMessageText(
        `✏️ *נערך — ראה גרסה חדשה למטה*`,
        { chat_id: chatId, message_id: editCtx.origMessageId, parse_mode: 'Markdown' }
      );
    } catch {}

    await sendTweetForApproval(updated, { editedFrom: editCtx.originalText });
  } catch (err) {
    console.error('[bot] rewrite failed:', err.message);
    await bot.editMessageText(`❌ שגיאה בעריכה: ${err.message}`, {
      chat_id: chatId,
      message_id: typingMsg.message_id,
    });
  }
}

async function handleFreeCommand(chatId, text) {
  const state = stateManager.readState();
  const config = stateManager.readConfig();

  const typingMsg = await bot.sendMessage(chatId, '⏳ מעבד...');

  let parsed;
  try {
    parsed = await ai.interpretCommand(text, state, config);
  } catch (err) {
    await bot.editMessageText(`❌ שגיאה: ${err.message}`, {
      chat_id: chatId,
      message_id: typingMsg.message_id,
    });
    return;
  }

  await bot.deleteMessage(chatId, typingMsg.message_id);

  switch (parsed.action) {
    case 'pause_today': {
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      stateManager.pauseCron(endOfDay.toISOString());
      await bot.sendMessage(chatId, '⏸ הציוצים האוטומטיים הופסקו עד סוף היום.');
      break;
    }

    case 'pause_forever': {
      stateManager.pauseCron('forever');
      await bot.sendMessage(chatId, '⏸ הציוצים האוטומטיים הופסקו. שלח "תתחיל לשלוח שוב" להמשיך.');
      break;
    }

    case 'resume': {
      stateManager.resumeCron();
      await bot.sendMessage(chatId, '▶️ הציוצים האוטומטיים פועלים שוב.');
      break;
    }

    case 'stats': {
      const { count, tweets } = stateManager.getWeeklyStats();
      const lastThree = tweets
        .slice(-3)
        .map((t) => `• ${t.text.slice(0, 60)}...`)
        .join('\n');
      await bot.sendMessage(
        chatId,
        `📊 *סטטיסטיקות השבוע:*\nפורסמו ${count} ציוצים.\n\n*אחרונים:*\n${lastThree || 'אין עדיין'}`,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case 'write_tweet': {
      const subject = parsed.subject || '';
      const instruction = parsed.instruction || text;

      await bot.sendMessage(chatId, `🔍 מחפש נתונים מאומתים על ${subject || 'הנושא'}...`);

      let knessetCtx = null;
      try {
        if (subject) {
          knessetCtx = await knesset.findMemberActivity(subject);
        } else {
          knessetCtx = await knesset.fetchRecentActivity();
        }
      } catch (err) {
        console.error('[bot] knesset fetch for custom tweet failed:', err.message);
      }

      const tweet = await ai.generateCustomTweet(instruction, knessetCtx, config);

      if (!tweet) {
        const explanation = await ai.explainNoData(instruction);
        await bot.sendMessage(chatId, `ℹ️ ${explanation}`);
      } else {
        await sendTweetForApproval(tweet, { requestedBy: text });
      }
      break;
    }

    case 'change_style': {
      const changes = parsed.styleChanges || {};
      if (Object.keys(changes).length === 0) {
        await bot.sendMessage(chatId, '⚠️ לא הבנתי מה לשנות. נסה שוב בצורה יותר ברורה.');
        break;
      }
      const newConfig = { ...config, ...changes };
      stateManager.writeConfig(newConfig);
      const summary = Object.entries(changes)
        .map(([k, v]) => `• ${k}: ${JSON.stringify(v)}`)
        .join('\n');
      await bot.sendMessage(chatId, `✅ *הגדרות עודכנו:*\n${summary}`, {
        parse_mode: 'Markdown',
      });
      break;
    }

    case 'knesset_info': {
      const subject  = parsed.subject || '';
      const subjType = parsed.subjectType || 'general';

      await bot.sendMessage(chatId, `🔍 שולף נתונים מה-API...`);

      let apiContext = '';
      try {
        if (subjType === 'faction' && subject) {
          const { members, factionName, allFactions } = await knesset.fetchFactionMembers(subject);
          if (factionName && members.length) {
            apiContext = `סיעה: ${factionName}\nחברים (${members.length}): ${members.join(', ')}`;
          } else {
            const facList = (allFactions || []).join(', ');
            apiContext = `לא נמצאה סיעה התואמת "${subject}".\nסיעות קיימות בכנסת 25: ${facList}`;
          }
        } else if (subjType === 'mk' && subject) {
          const data = await knesset.findMemberActivity(subject);
          apiContext = data?.rawSummary ?? `לא נמצא ח"כ בשם "${subject}" ב-API.`;
        } else {
          const data = await knesset.fetchRecentActivity();
          apiContext = data?.rawSummary ?? 'לא נמצאו נתונים עדכניים.';
        }
      } catch (err) {
        console.error('[bot] knesset_info fetch failed:', err.message);
        apiContext = `שגיאה בשליפת נתונים: ${err.message}`;
      }

      const reply = await ai.freeChat(text, apiContext);
      await bot.sendMessage(chatId, reply);
      break;
    }

    default: {
      // שיחה שאינה עובדתית — בוט עונה בלי לגשת ל-API
      const reply = await ai.freeChat(text);
      await bot.sendMessage(chatId, reply);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeMarkdown(text) {
  return (text || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Send a plain notification to the configured chat.
 */
async function notify(text) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId || !bot) return;
  await bot.sendMessage(chatId, text);
}

module.exports = { createBot, sendTweetForApproval, notify };
