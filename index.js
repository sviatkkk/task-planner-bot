require("dotenv").config();
const { Telegraf } = require("telegraf");

// Функція для екранування спецсимволів MarkdownV2
function escapeMarkdownV2(text) {
  if (text === null || text === undefined) return "";
  const s = String(text);
  return s.replace(/([_\*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Список завдань для кожного користувача
const userTasks = {};

const EMOJI = {
  header: '📝',
  done: '✅',
  todo: '▫️',
  timer: '⏰',
  add: '➕',
  remove: '🗑️',
  reminder: '🔔',
  urgent: '🔥',
  general: '🟢'
};

function formatTaskInfo(t, i, done, forMarkdown = false) {
  const idx = `${i + 1}.`;
  const text = getTaskText(t);
  const label = (t && typeof t === 'object' && t.reminderLabel) ? t.reminderLabel : null;
  const interval = (t && typeof t === 'object' && t.reminderInterval) ? t.reminderInterval : null;
  if (forMarkdown) {
    const safeNum = escapeMarkdownV2(idx);
    const safeText = escapeMarkdownV2(text);
    const timerPart = label ? ` ${EMOJI.timer} ${escapeMarkdownV2(label)} ${escapeMarkdownV2('(' + humanizeInterval(interval) + ')' )}` : '';
    return `${done ? EMOJI.done : EMOJI.todo} ${safeNum} ${done ? '~' + safeText + '~' : safeText}${timerPart}`;
  }
  const timerPart = label ? ` ${EMOJI.timer} ${label} (${humanizeInterval(interval)})` : '';
  return `${done ? EMOJI.done : EMOJI.todo} ${i + 1}. ${text}${timerPart}`;
}

// Допоміжні функції для задач
function getTaskText(task) {
  return typeof task === "string" ? task : task.text || "";
}

function setTaskReminder(userId, taskIndex, intervalMs, ctx, label) {
  const user = userTasks[userId];
  if (!user) return;
  const task = user.tasks[taskIndex];
  if (!task) return;
  // Очистити існуючий
  if (task.reminderId) clearInterval(task.reminderId);
  task.reminderInterval = intervalMs;
  if (label) task.reminderLabel = label;
  // reminderLabel will be set by caller when possible
  task.reminderId = setInterval(() => {
    const text = `🔔 Нагадування: ${getTaskText(task)}\n\nБільше функцій — /help`;
    ctx.telegram.sendMessage(userId, text, {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Позначити як виконане', callback_data: `task_action:complete:${taskIndex}` },
          { text: '⏸️ Зупинити нагадування', callback_data: `task_action:stop:${taskIndex}` },
          { text: '🔁 Нагадувати далі', callback_data: `task_action:keep:${taskIndex}` }
        ]]
      }
    });
  }, intervalMs);
}

function humanizeInterval(ms) {
  if (!ms) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} сек.`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} хв.`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} год.`;
  const days = Math.floor(hr / 24);
  return `${days} дн.`;
}

// Очистити всі види нагадувань для задачі
function clearTaskReminder(task) {
  if (!task) return;
  if (task.reminderId) {
    try { clearInterval(task.reminderId); } catch (e) {}
    task.reminderId = null;
  }
  if (task.reminderTimeoutId) {
    try { clearTimeout(task.reminderTimeoutId); } catch (e) {}
    task.reminderTimeoutId = null;
  }
  if (task.reminderIntervalId) {
    try { clearInterval(task.reminderIntervalId); } catch (e) {}
    task.reminderIntervalId = null;
  }
  task.reminderInterval = null;
  task.reminderLabel = null;
  task.reminderSchedule = null;
}

// Таймери для кожного користувача
const userTimers = {};

// Список доступних таймінгів
const timerOptions = [
  { label: "1 хвилина", value: 60 * 1000 },
  { label: "1 година", value: 60 * 60 * 1000 },
  { label: "3 години", value: 3 * 60 * 60 * 1000 },
  { label: "10 годин", value: 10 * 60 * 60 * 1000 },
  { label: "Оберіть годину", value: "pick_hour" },
  { label: "Щодня", value: 24 * 60 * 60 * 1000 }
];

function withFooter(text) {
  const footer = "\n\nБільше функцій — /help";
  return text + footer;
}

// Відправити список задач (використовується в різних місцях)
function sendTaskList(userId, ctx) {
  const user = userTasks[userId];
  if (!user || !Array.isArray(user.tasks) || user.tasks.length === 0) {
    ctx.reply(withFooter('Список завдань пустий.\nЩоб додати нове завдання, введіть команду /add і напишіть свої завдання.'));
    return;
  }
  const completed = [];
  const uncompleted = [];
  user.tasks.forEach((t, i) => {
    const done = user.completed && user.completed[i];
    let line = formatTaskInfo(t, i, done, true);
    // якщо є глобальний таймер для користувача і задача не urgent і не має власного reminderLabel
    const isGeneral = userTimers[userId] && userTimers[userId].enabled && !(t && t.urgent) && !(t && t.reminderLabel);
    if (!done && isGeneral) {
      line += ` ${escapeMarkdownV2('(під загальним таймером)')}`;
    }
    if (done) completed.push(line); else uncompleted.push(line);
  });
  let msg = '📋 Стан ваших завдань:\n';
  if (completed.length) msg += `${EMOJI.done} Виконані:\n` + completed.join('\n') + '\n';
  if (uncompleted.length) msg += `${EMOJI.todo} Невиконані:\n` + uncompleted.join('\n');
  ctx.reply(withFooter(msg), { parse_mode: 'MarkdownV2' });
}

// Короткий список невиконаних задач з позначками urgent / general timer
function sendUncompletedListPlain(userId, ctx) {
  const user = userTasks[userId];
  if (!user || !user.tasks || user.tasks.length === 0) {
    ctx.reply(withFooter('Список завдань пустий.\nЩоб додати нове завдання, введіть команду /add і напишіть свої завдання.'));
    return;
  }
  const lines = [];
  user.tasks.forEach((t, i) => {
    const done = user.completed && user.completed[i];
    if (done) return;
    const isGeneral = userTimers[userId] && userTimers[userId].enabled && !(t && t.urgent);
    const marker = t && t.urgent ? EMOJI.urgent : (isGeneral ? EMOJI.general : EMOJI.todo);
    const txt = getTaskText(t);
    const timerInfo = (t && t.reminderLabel) ? ` ${EMOJI.timer} ${t.reminderLabel}` : '';
    lines.push(`${marker} ${i + 1}. ${txt}${timerInfo}`);
  });
  if (lines.length === 0) {
    ctx.reply(withFooter('Нема невиконаних задач.'));
    return;
  }
  ctx.reply(withFooter('Невиконані задачі:\n' + lines.join('\n')));
}

// Обробка натискань на кнопки нагадувань
bot.action(/task_action:(complete|stop):(\d+)/, async (ctx) => {
  try {
    const action = ctx.match[1];
    const idx = parseInt(ctx.match[2], 10);
    const userId = ctx.from.id;
    const user = userTasks[userId];
    if (!user || !user.tasks || !user.tasks[idx]) {
      await ctx.answerCbQuery('Задача не знайдена');
      return;
    }
    const taskObj = user.tasks[idx];
    if (action === 'complete') {
      if (!user.completed) user.completed = {};
      user.completed[idx] = true;
      if (taskObj) {
        clearTaskReminder(taskObj);
      }
      await ctx.editMessageReplyMarkup();
      await ctx.reply(withFooter('Позначив завдання як виконане.'));
      sendTaskList(userId, ctx);
      await ctx.answerCbQuery('Завдання позначено як виконане');
    } else if (action === 'stop') {
      if (taskObj) {
        clearTaskReminder(taskObj);
      }
      await ctx.editMessageReplyMarkup();
      await ctx.reply(withFooter('Нагадування для цього завдання зупинено. Якщо хочеш знову увімкнути — встанови таймер заново.'));
      await ctx.answerCbQuery('Нагадування зупинено');
    } else if (action === 'keep') {
      // Нічого не робимо з таймером — просто підтверджуємо
      await ctx.answerCbQuery('Продовжуватиму нагадувати');
      await ctx.reply(withFooter('Добре — я продовжуватиму нагадувати про це завдання.'));
    }
  } catch (err) {
    console.error('action handler error', err);
  }
});

// Команда /list
bot.command("list", (ctx) => {
  const userId = ctx.from.id;
  sendTaskList(userId, ctx);
});

// Команда /start
bot.start((ctx) => {
  ctx.reply("Привіт 👋 Я твій планувальник! Напиши мені завдання.");
  ctx.reply("Ось є команда /help, яка допоможе тобі з усіма можливими функціями, які у мене є.");
});


// Команда /help
bot.command("help", (ctx) => {
  ctx.reply(
    "Ось список доступних команд:\n" +
      "/add – додати завдання\n" +
      "/remove – видалити завдання\n" +
      "/edit – виправити список\n" +
      "/complete – позначити виконання завдання\n" +
      "/list – вивести список завдань\n" +
      "/timer – налаштувати глобальні нагадування"
  );
});

// Команда /timer (реєструємо перед обробником тексту)
bot.command("timer", (ctx) => {
  const userId = ctx.from.id;
  let msg = "⏰ Обери частоту нагадувань:\n";
  timerOptions.forEach((opt, i) => {
    msg += `${i + 1}. ${opt.label}\n`;
  });
  ctx.reply(msg);
  userTimers[userId] = userTimers[userId] || {};
  userTimers[userId].waitingForTimer = true;
});

// Команда /add
bot.command("add", (ctx) => {
  const userId = ctx.from.id;
  if (!userTasks[userId]) userTasks[userId] = { tasks: [], waitingForTask: false };
  userTasks[userId].waitingForTask = true;
  ctx.reply("Напиши текст завдання одним повідомленням.");
});

// Команда /remove
bot.command("remove", (ctx) => {
  const userId = ctx.from.id;
  if (!userTasks[userId] || userTasks[userId].tasks.length === 0) {
    ctx.reply("Список завдань пустий. \nЩоб додати нове завдання, введіть команду /add і напишіть свої завдання.");
    return;
  }
  const tasksList = userTasks[userId].tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
  ctx.reply(`Введіть номер завдання, яке потрібно видалити:\n${tasksList}`);
  userTasks[userId].waitingForRemove = true;
});

// Команда /edit
bot.command("edit", (ctx) => {
  const userId = ctx.from.id;
  if (!userTasks[userId] || userTasks[userId].tasks.length === 0) {
    ctx.reply("Список завдань пустий. \nЩоб додати нове завдання, введіть команду /add і напишіть свої завдання.");
    return;
  }
  const tasksList = userTasks[userId].tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
  ctx.reply(`Введіть номер завдання, яке потрібно змінити:\n${tasksList}`);
  userTasks[userId].waitingForEditIndex = true;
});

// Команда /complete
bot.command("complete", (ctx) => {
  const userId = ctx.from.id;
  if (!userTasks[userId] || userTasks[userId].tasks.length === 0) {
    ctx.reply("Список завдань пустий. \nЩоб додати нове завдання, введіть команду /add і напишіть свої завдання.");
    return;
  }
  // Перевіряємо, чи є невиконані завдання
  const uncompletedIndexes = userTasks[userId].tasks
    .map((_, i) => i)
    .filter(i => !(userTasks[userId].completed && userTasks[userId].completed[i]));
  if (uncompletedIndexes.length === 0) {
    ctx.reply("Всі завдання виконані! Додайте нові через /add.");
    return;
  }
  const tasksList = userTasks[userId].tasks.map((t, i) => {
    const done = userTasks[userId].completed && userTasks[userId].completed[i];
    return formatTaskInfo(t, i, done, true);
  }).join("\n");
  ctx.reply(`✅ Введіть номер завдання, яке виконано:\n${tasksList}`, { parse_mode: "MarkdownV2" });
  userTasks[userId].waitingForComplete = true;
});

// Обробка тексту для видалення завдання

bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  // Додавання завдання (чекаємо тексту)
  if (userTasks[userId] && userTasks[userId].waitingForTask) {
    const text = ctx.message.text;
    const user = userTasks[userId];
    // зберігаємо як об'єкт
    const idx = user.tasks.push({ text, urgent: false, reminderId: null, reminderInterval: null }) - 1;
    user.waitingForTask = false;
    user.pendingTaskIndex = idx;
    user.waitingForUrgency = true;
    ctx.reply("Чи важливе це завдання?\n1. Так\n2. Ні (якщо ні, завдання буде під загальним таймером)");
    return;
  }

  // Обробка відповіді на питання про терміновість
  if (userTasks[userId] && userTasks[userId].waitingForUrgency) {
    const ans = ctx.message.text.trim();
    const user = userTasks[userId];
    const idx = user.pendingTaskIndex;
    if (ans === '1' || /^так$/i.test(ans)) {
      // важливе — пропонуємо таймер для цієї задачі
      user.tasks[idx].urgent = true;
      user.waitingForUrgency = false;
      user.waitingForTaskTimer = true;
      // показуємо опції таймера
      let msg = "Оберіть таймер для цього завдання:\n";
      timerOptions.forEach((opt, i) => { msg += `${i + 1}. ${opt.label}\n`; });
      ctx.reply(msg);
      return;
    }
    // не термінове
    user.waitingForUrgency = false;
  const tasksList = user.tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
  ctx.reply(withFooter(`Завдання збережено. Ось ваші задачі:\n${tasksList}\nДодайте нові через /add`));
    delete user.pendingTaskIndex;
    return;           
  }

  // Обробка вибору таймера для конкретної задачі
  if (userTasks[userId] && userTasks[userId].waitingForTaskTimer) {
    const num = parseInt(ctx.message.text);
    const user = userTasks[userId];
    if (isNaN(num) || num < 1 || num > timerOptions.length) {
      ctx.reply("Введіть коректний номер таймера.");
      return;
    }
    const idx = user.pendingTaskIndex;
    const ms = timerOptions[num - 1].value;
    const label = timerOptions[num - 1].label;
    if (ms === "pick_hour") {
      // show inline keyboard with hours 0..23
      const keyboard = [];
      for (let r = 0; r < 6; r++) {
        const row = [];
        for (let c = 0; c < 4; c++) {
          const hour = r * 4 + c;
          row.push({ text: (hour.toString().padStart(2, '0') + ':00'), callback_data: `pick_hour:${idx}:${hour}` });
        }
        keyboard.push(row);
      }
      await ctx.reply('Оберіть годину для щоденного нагадування:', { reply_markup: { inline_keyboard: keyboard } });
      // store pending info
      user.pendingHourForTask = idx;
    } else {
      setTaskReminder(userId, idx, ms, ctx, label);
      user.waitingForTaskTimer = false;
      const tasksList = user.tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
      ctx.reply(withFooter(`${EMOJI.reminder} Таймер для задачі встановлено: ${timerOptions[num - 1].label}\nОсь ваші задачі:\n${tasksList}`));
      delete user.pendingTaskIndex;
      return;
    }
    return;
  }
  // Видалення завдання
  if (userTasks[userId] && userTasks[userId].waitingForRemove) {
    const num = parseInt(ctx.message.text);
    if (isNaN(num) || num < 1 || num > userTasks[userId].tasks.length) {
      ctx.reply(withFooter("Введіть коректний номер завдання для видалення."));
      return;
    }
    const removed = userTasks[userId].tasks.splice(num - 1, 1)[0];
    // очистити нагадування для видаленого завдання, якщо воно було об'єктом з reminderId
    if (removed && typeof removed === 'object') {
      clearTaskReminder(removed);
    }
    userTasks[userId].waitingForRemove = false;
    if (userTasks[userId].tasks.length === 0) {
      ctx.reply(withFooter("Завдання було видалено. Список завдань пустий. Щоб додати нове завдання, введіть команду /add і напишіть свої завдання."));
    } else {
  const tasksList = userTasks[userId].tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
  ctx.reply(withFooter(`Оновлений список:\n${tasksList}`));
    }
    return;
  }
  // Позначення виконаного завдання
  if (userTasks[userId] && userTasks[userId].waitingForComplete) {
    const num = parseInt(ctx.message.text);
    if (isNaN(num) || num < 1 || num > userTasks[userId].tasks.length) {
      ctx.reply("Введіть коректний номер завдання для виконання.");
      return;
    }
    if (!userTasks[userId].completed) userTasks[userId].completed = {};
    if (userTasks[userId].completed[num - 1]) {
      ctx.reply(withFooter("Це завдання вже виконане. Оберіть інше."));
      return;
    }
    // clear reminder for completed task if present
    const taskObj = userTasks[userId].tasks[num - 1];
    if (taskObj && typeof taskObj === 'object' && taskObj.reminderId) {
      clearInterval(taskObj.reminderId);
      taskObj.reminderId = null;
      taskObj.reminderInterval = null;
    }
    userTasks[userId].completed[num - 1] = true;
    userTasks[userId].waitingForComplete = false;
    const tasksList = userTasks[userId].tasks.map((t, i) => {
      const done = userTasks[userId].completed && userTasks[userId].completed[i];
      return formatTaskInfo(t, i, done, true);
    }).join("\n");
  const headerEsc = escapeMarkdownV2("Завдання виконано! Ось ваш оновлений список:");
  const footerEsc = escapeMarkdownV2("\n\nБільше функцій — /help");
  ctx.reply(`${headerEsc}\n${tasksList}${footerEsc}`, { parse_mode: "MarkdownV2" });
    return;
  }
  // Початок редагування завдання
  if (userTasks[userId] && userTasks[userId].waitingForEditIndex) {
    const num = parseInt(ctx.message.text);
    if (isNaN(num) || num < 1 || num > userTasks[userId].tasks.length) {
      ctx.reply("Введіть коректний номер завдання для редагування.");
      return;
    }
    userTasks[userId].editIndex = num - 1;
    userTasks[userId].waitingForEditIndex = false;
    userTasks[userId].waitingForEditText = true;
    ctx.reply("Введіть новий текст для цього завдання:");
    return;
  }
  // Завершення редагування завдання
  if (userTasks[userId] && userTasks[userId].waitingForEditText) {
    userTasks[userId].tasks[userTasks[userId].editIndex] = ctx.message.text;
    userTasks[userId].waitingForEditText = false;
    delete userTasks[userId].editIndex;
  const tasksList = userTasks[userId].tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
  ctx.reply(withFooter(`Зміни збережено! Ось ваш оновлений список:\n${tasksList}`));
    return;
  }
  // Вибір таймера
  if (userTimers[userId] && userTimers[userId].waitingForTimer) {
    const num = parseInt(ctx.message.text);
    if (isNaN(num) || num < 1 || num > timerOptions.length) {
      ctx.reply("Введіть коректний номер таймера.");
      return;
    }
    const choice = timerOptions[num - 1].value;
    userTimers[userId].waitingForTimer = false;
    if (choice === 'pick_hour') {
      // show inline keyboard with hours 0..23 for global timer
      const keyboard = [];
      for (let r = 0; r < 6; r++) {
        const row = [];
        for (let c = 0; c < 4; c++) {
          const hour = r * 4 + c;
          row.push({ text: hour.toString().padStart(2, '0') + ':00', callback_data: `pick_global_hour:${hour}` });
        }
        keyboard.push(row);
      }
      await ctx.reply('Оберіть годину для глобального щоденного нагадування:', { reply_markup: { inline_keyboard: keyboard } });
      return;
    }
    setUserReminder(userId, choice, ctx);
    ctx.reply(withFooter(`Таймер встановлено: ${timerOptions[num - 1].label}`));
    return;
  }
  // Якщо нічого не очікується
  ctx.reply(`Вибач, я не зрозумів( Обери одну з команд /help`); // bot pls do not change the text in this line
});

// (timer command already registered earlier)

// Обробка вибору години для глобального щоденного таймера
bot.action(/pick_global_hour:(\d+)/, async (ctx) => {
  try {
    const hour = parseInt(ctx.match[1], 10);
    const userId = ctx.from.id;
    if (!userTimers[userId]) userTimers[userId] = {};
    // clear existing global schedule
    const ut = userTimers[userId];
    if (ut.timeoutId) { try { clearTimeout(ut.timeoutId); } catch (e) {} ut.timeoutId = null; }
    if (ut.intervalId) { try { clearInterval(ut.intervalId); } catch (e) {} ut.intervalId = null; }
    // compute next occurrence
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const msUntil = next - now;
    ut.schedule = { type: 'daily_hour', hour };
    ut.label = `${hour.toString().padStart(2,'0')}:00 (щодня)`;
    ut.enabled = true;
    ut.timeoutId = setTimeout(() => {
      // send uncompleted list
      if (userTasks[userId] && userTasks[userId].tasks && userTasks[userId].tasks.length > 0) {
        sendUncompletedListPlain(userId, ctx);
      }
      ut.intervalId = setInterval(() => {
        if (userTasks[userId] && userTasks[userId].tasks && userTasks[userId].tasks.length > 0) {
          sendUncompletedListPlain(userId, ctx);
        }
      }, 24 * 60 * 60 * 1000);
    }, msUntil);
    await ctx.editMessageReplyMarkup();
    await ctx.reply(withFooter(`Глобальний таймер щоденно о ${hour.toString().padStart(2,'0')}:00 встановлено.`));
    await ctx.answerCbQuery('Година встановлена');
  } catch (err) {
    console.error('pick_global_hour handler err', err);
  }
});

// Обробка вибору таймера
function setUserReminder(userId, intervalMs, ctx) {
  // Якщо вже є таймер — очищаємо
  if (!userTimers[userId]) userTimers[userId] = {};
  if (userTimers[userId].intervalId) {
    try { clearInterval(userTimers[userId].intervalId); } catch (e) {}
  }
  userTimers[userId].intervalMs = intervalMs;
  userTimers[userId].enabled = true;
  // store readable label
  userTimers[userId].label = humanizeInterval(intervalMs) || 'custom';
  userTimers[userId].intervalId = setInterval(() => {
    if (userTasks[userId] && userTasks[userId].tasks && userTasks[userId].tasks.length > 0) {
      // send compact uncompleted list
      const lines = [];
      userTasks[userId].tasks.forEach((t, i) => {
        const done = userTasks[userId].completed && userTasks[userId].completed[i];
        if (done) return;
        // don't include tasks that have their own urgent reminders if they are marked urgent
        const marker = t && t.urgent ? EMOJI.urgent : EMOJI.general;
        lines.push(`${marker} ${i + 1}. ${getTaskText(t)}`);
      });
      if (lines.length > 0) {
        ctx.telegram.sendMessage(userId, `🔔 Нагадування (${userTimers[userId].label})\n` + lines.join('\n'));
      }
    }
  }, intervalMs);
}

// Запуск
bot.launch().then(() => {
  console.log("✅ Бот запущено");
});

// Обробка вибору години для щоденного таймера
bot.action(/pick_hour:(\d+):(\d+)/, async (ctx) => {
  try {
    const taskIdx = parseInt(ctx.match[1], 10);
    const hour = parseInt(ctx.match[2], 10);
    const userId = ctx.from.id;
    const user = userTasks[userId];
    if (!user || !user.tasks || !user.tasks[taskIdx]) {
      await ctx.answerCbQuery('Задача не знайдена');
      return;
    }
    const task = user.tasks[taskIdx];
    // clear existing
    clearTaskReminder(task);
    // compute ms until next occurrence of given hour
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const msUntil = next - now;
    task.reminderLabel = `${hour.toString().padStart(2, '0')}:00 (щодня)`;
    task.reminderSchedule = { type: 'daily_hour', hour };
    // set a timeout for first occurrence, then interval every 24h
    task.reminderTimeoutId = setTimeout(() => {
      ctx.telegram.sendMessage(userId, `🔔 Нагадування: ${getTaskText(task)}\n\nБільше функцій — /help`, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Позначити як виконане', callback_data: `task_action:complete:${taskIdx}` }, { text: '⏸️ Зупинити нагадування', callback_data: `task_action:stop:${taskIdx}` }, { text: '🔁 Нагадувати далі', callback_data: `task_action:keep:${taskIdx}` }]] }
      });
      // set interval for next days
      task.reminderIntervalId = setInterval(() => {
        ctx.telegram.sendMessage(userId, `🔔 Нагадування: ${getTaskText(task)}\n\nБільше функцій — /help`, {
          reply_markup: { inline_keyboard: [[{ text: '✅ Позначити як виконане', callback_data: `task_action:complete:${taskIdx}` }, { text: '⏸️ Зупинити нагадування', callback_data: `task_action:stop:${taskIdx}` }, { text: '🔁 Нагадувати далі', callback_data: `task_action:keep:${taskIdx}` }]] }
        });
      }, 24 * 60 * 60 * 1000);
    }, msUntil);
    await ctx.editMessageReplyMarkup();
    await ctx.reply(withFooter(`Таймер щоденно о ${hour.toString().padStart(2, '0')}:00 встановлено.`));
    await ctx.answerCbQuery('Година встановлена');
  } catch (err) {
    console.error('pick_hour handler err', err);
  }
});