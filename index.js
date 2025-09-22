require('dotenv').config();
const { bot } = require('./bot');

// In serverless environment (like Vercel) we should NOT call bot.launch().
// For local development we'll keep a small launcher here — run `node index.js` locally.
if (process.env.RUN_LOCAL === 'true' || process.env.NODE_ENV === 'development') {
  bot.launch().then(() => console.log('✅ Bot (polling) started locally'));
} else {
  console.log('ℹ️ Loaded bot module. Run with RUN_LOCAL=true for polling locally.');
}