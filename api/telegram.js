const { bot } = require('../bot');

// Vercel serverless handler
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('OK');
    return;
  }

  // Optional secret token validation
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (!header || header !== secret) {
      res.status(401).send('invalid secret');
      return;
    }
  }

  try {
    await bot.handleUpdate(req.body, res);
    res.status(200).send('ok');
  } catch (err) {
    console.error('Failed to handle update', err);
    // still respond 200 to avoid Telegram retry storm if desired, but log the error
    res.status(500).send('error');
  }
};
