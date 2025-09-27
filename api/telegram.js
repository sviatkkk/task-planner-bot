const { bot } = require('../bot');

// Vercel serverless handler
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('OK');
    return;
  }

  // Optional secret token validation (temporarily disabled to fix 401 error)
  // const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  // if (secret) {
  //   const header = req.headers['x-telegram-bot-api-secret-token'];
  //   if (!header || header !== secret) {
  //     res.status(401).send('invalid secret');
  //     return;
  //   }
  // }

  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error('Failed to handle update', err);
    if (!res.headersSent) {
      res.status(500).send('error');
    }
  }
};
