// Local helper to invoke processDueReminders() from bot module
// Usage: set RUN_LOCAL=true and BOT_TOKEN in .env, run `node local-run-reminders.js`

require('dotenv').config();
const { processDueReminders } = require('./bot');

(async () => {
  try {
    console.log('Invoking processDueReminders()...');
    await processDueReminders();
    console.log('Done.');
  } catch (err) {
    console.error('Error running processDueReminders:', err);
    process.exit(1);
  }
})();
