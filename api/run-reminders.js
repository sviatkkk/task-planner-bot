const { processDueReminders } = require('../bot');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const secret = process.env.RUN_REMINDERS_SECRET;
  if (!secret) {
    console.error('RUN_REMINDERS_SECRET not set');
    return res.status(500).send('server misconfigured');
  }
  const header = req.headers['x-run-reminders-secret'];
  if (!header || header !== secret) return res.status(401).send('invalid secret');

  try {
    await processDueReminders();
    return res.status(200).send('ok');
  } catch (err) {
    console.error('run-reminders error', err);
    return res.status(500).send('error');
  }
};
