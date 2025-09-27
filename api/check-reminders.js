const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    console.error('BOT_TOKEN not set');
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  try {
    // Get list of active users with timers
    const activeUsers = await kv.get('active_timers:list') || [];
    if (!Array.isArray(activeUsers)) activeUsers = [];

    console.log(`Active users count: ${activeUsers.length}`);

    const now = Date.now();
    const processed = [];

    for (const userId of activeUsers) {
      console.log(`Checking user ${userId}`);
      // Load userTimers
      const timersKey = `timers:${userId}`;
      const userTimers = await kv.get(timersKey);
      console.log(`User ${userId} timers:`, userTimers);
      if (!userTimers || !userTimers.enabled || !userTimers.nextGlobalReminder) {
        console.log(`User ${userId} skipped: not enabled or no next reminder`);
        continue;
      }

      // Load tasks
      const tasksKey = `tasks:${userId}`;
      const userTasks = await kv.get(tasksKey) || { tasks: [], completed: {} };
      console.log(`User ${userId} uncompleted tasks count: ${userTasks.tasks.filter((t, i) => !userTasks.completed[i]).length}`);

      if (userTimers.nextGlobalReminder <= now) {
        console.log(`User ${userId} global timer due`);
        // Send global reminder
        const uncompleted = userTasks.tasks.filter((t, i) => !userTasks.completed[i]);
        if (uncompleted.length > 0) {
          const reminderText = `🔔 Нагадування (${userTimers.label})\n` + uncompleted.map((t, i) => `🟢 ${i+1}. ${t.text || t}`).join('\n');
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: userId,
              text: reminderText,
              parse_mode: 'Markdown'
            })
          });
          console.log(`Sent global reminder to user ${userId}`);
        } else {
          console.log(`No uncompleted tasks for user ${userId}`);
        }

        // Update next reminder
        if (userTimers.schedule && userTimers.schedule.type === 'daily_hour') {
          const next = new Date(now);
          next.setHours(userTimers.schedule.hour, userTimers.schedule.minute || 0, 0, 0);
          if (next <= now) next.setDate(next.getDate() + 1);
          userTimers.nextGlobalReminder = next.getTime();
        } else {
          userTimers.nextGlobalReminder += userTimers.intervalMs;
        }
        await kv.set(timersKey, userTimers);

        processed.push(userId);
      } else {
        console.log(`User ${userId} global timer not due yet (next: ${new Date(userTimers.nextGlobalReminder)})`);
      }

      // Also check per-task reminders
      if (userTasks.tasks) {
        for (let i = 0; i < userTasks.tasks.length; i++) {
          const task = userTasks.tasks[i];
          if (task && typeof task === 'object' && task.nextReminder && task.nextReminder <= now && !userTasks.completed[i]) {
            console.log(`User ${userId} task ${i} reminder due`);
            const reminderText = `🔔 Нагадування: ${task.text}\n\nБільше функцій — /help`;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: userId,
                text: reminderText,
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '✅ Позначити як виконане', callback_data: `task_action:complete:${i}` },
                      { text: '⏸️ Зупинити нагадування', callback_data: `task_action:stop:${i}` },
                      { text: '🔁 Нагадувати далі', callback_data: `task_action:keep:${i}` }
                    ]
                  ]
                }
              })
            });
            console.log(`Sent task reminder to user ${userId} for task ${i}`);

            // Update next for task
            if (task.reminderSchedule && task.reminderSchedule.type === 'daily_hour') {
              const next = new Date(now);
              next.setHours(task.reminderSchedule.hour, task.reminderSchedule.minute || 0, 0, 0);
              if (next <= now) next.setDate(next.getDate() + 1);
              task.nextReminder = next.getTime();
            } else {
              task.nextReminder += task.reminderInterval;
            }
            await kv.set(tasksKey, userTasks);
          } else {
            if (task && typeof task === 'object' && task.nextReminder) {
              console.log(`User ${userId} task ${i} not due (next: ${new Date(task.nextReminder)})`);
            }
          }
        }
      }
    }

    console.log(`Processed ${processed.length} reminders`);
    res.status(200).json({ status: 'ok', processed: processed.length });
  } catch (error) {
    console.error('Check reminders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
