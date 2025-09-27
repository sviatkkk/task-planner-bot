const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

const { kv } = require('@vercel/kv');

const USE_KV = process.env.USE_KV === 'true';

// In-memory for local dev
let userTasks = {};
let userTimers = {};

// KV functions
async function loadUserTasks(userId) {
  if (!userTasks[userId]) {
    userTasks[userId] = { tasks: [], completed: {}, waitingForTask: false, waitingForUrgency: false, waitingForTaskTimer: false, waitingForRemove: false, waitingForEditIndex: false, waitingForEditText: false, waitingForComplete: false };
  }
  if (USE_KV) {
    const data = await kv.get(`tasks:${userId}`);
    if (data) {
      userTasks[userId] = data;
    }
  }
  return userTasks[userId];
}

async function saveUserTasks(userId) {
  if (USE_KV && userTasks[userId]) {
    await kv.set(`tasks:${userId}`, userTasks[userId]);
  }
}

async function loadUserTimers(userId) {
  if (!userTimers[userId]) {
    userTimers[userId] = { enabled: false, intervalMs: null, label: null, nextGlobalReminder: null, waitingForTimer: false };
  }
  if (USE_KV) {
    const data = await kv.get(`timers:${userId}`);
    if (data) {
      userTimers[userId] = data;
    }
  }
  return userTimers[userId];
}

async function saveUserTimers(userId) {
  if (USE_KV && userTimers[userId]) {
    await kv.set(`timers:${userId}`, userTimers[userId]);
    // Add to active list if enabled
    if (userTimers[userId].enabled) {
      let active = await kv.get('active_timers:list') || [];
      if (!active.includes(userId)) {
        active.push(userId);
        await kv.set('active_timers:list', active);
      }
    }
  }
}

// Список завдань для кожного користувача (now loaded on demand)

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

function escapeMarkdownV2(str) {
  return str.replace(/([_*[\]()~`>#+-=|{}.!\\])/g, '\\$1');
}

function formatTaskInfo(t, i, done, forMarkdown = false, globalLabel = null, isGeneral = false) {
  const idx = `${i + 1}.`;
  const text = getTaskText(t);
  const label = (t && typeof t === 'object' && t.reminderLabel) ? t.reminderLabel : null;
  const interval = (t && typeof t === 'object' && t.reminderInterval) ? t.reminderInterval : null;
  let timerPart = '';
  let globalPart = '';
  if (label) {
    if (forMarkdown) {
      timerPart = ` ${EMOJI.timer} ${escapeMarkdownV2(label)} ${escapeMarkdownV2('(' + humanizeInterval(interval) + ')' )}`;
    } else {
      timerPart = ` ${EMOJI.timer} ${label} (${humanizeInterval(interval)})`;
    }
  }
  if (isGeneral && globalLabel) {
    if (forMarkdown) {
      globalPart = ` ${escapeMarkdownV2(globalLabel)}`;
    } else {
      globalPart = ` ${globalLabel}`;
    }
  }
  let marker = done ? EMOJI.done : EMOJI.todo;
  if (!done) {
    if (t && t.urgent) marker = EMOJI.urgent;
    else if (isGeneral) marker = EMOJI.general;
  }
  if (forMarkdown) {
    const safeNum = escapeMarkdownV2(idx);
    const safeText = escapeMarkdownV2(text);
    return `${marker} ${safeNum} ${done ? '~' + safeText + '~' : safeText}${timerPart}${globalPart}`;
  }
  return `${marker} ${i + 1}. ${text}${timerPart}${globalPart}`;
}

// Допоміжні функції для задач
function getTaskText(task) {
  return typeof task === "string" ? task : task.text || "";
}

async function setTaskReminder(userId, taskIndex, intervalMs, ctx, label) {
  const user = await loadUserTasks(userId);
  if (!user) return;
  const task = user.tasks[taskIndex];
  if (!task) return;
  // Очистити існуючий
  clearTaskReminder(task);
  task.reminderInterval = intervalMs;
  if (label) task.reminderLabel = label;
  // Store next reminder timestamp
  task.nextReminder = Date.now() + intervalMs;
  await saveUserTasks(userId);
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

// Parse custom time input
function parseCustomTime(input) {
  const trimmed = input.trim().toLowerCase();
  // Check for HH:MM format
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { type: 'daily', hour, minute };
    }
  }
  // Check for "через X хвилин/годин"
  const intervalMatch = trimmed.match(/^через\s+(\d+)\s+(хвилин|хвилини|годин|години|хв|год)$/);
  if (intervalMatch) {
    const num = parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2];
    let ms;
    if (unit === 'хвилин' || unit === 'хвилини' || unit === 'хв') {
      ms = num * 60 * 1000;
    } else if (unit === 'годин' || unit === 'години' || unit === 'год') {
      ms = num * 60 * 60 * 1000;
    }
    if (ms) {
      return { type: 'interval', ms };
    }
  }
  return null;
}

// Очистити всі види нагадувань для задачі
function clearTaskReminder(task) {
  if (!task) return;
  task.reminderInterval = null;
  task.reminderLabel = null;
  task.reminderSchedule = null;
  task.nextReminder = null;
}

// Таймери для кожного користувача (now loaded on demand)

// Список доступних таймінгів
const timerOptions = [
  { label: "30 секунд", value: 30 * 1000 },
  { label: "1 хвилина", value: 60 * 1000 },
  { label: "5 хвилин", value: 5 * 60 * 1000 },
  { label: "15 хвилин", value: 15 * 60 * 1000 },
  { label: "30 хвилин", value: 30 * 60 * 1000 },
  { label: "1 година", value: 60 * 60 * 1000 },
  { label: "2 години", value: 2 * 60 * 60 * 1000 },
  { label: "3 години", value: 3 * 60 * 60 * 1000 },
  { label: "6 годин", value: 6 * 60 * 60 * 1000 },
  { label: "10 годин", value: 10 * 60 * 60 * 1000 },
  { label: "12 годин", value: 12 * 60 * 60 * 1000 },
  { label: "Оберіть годину", value: "pick_hour" },
  { label: "Щодня", value: 24 * 60 * 60 * 1000 }
];

function withFooter(text) {
  const footer = "\n\nБільше функцій — /help";
  return text + footer;
}

// Відправити список задач (використовується в різних місцях)
async function sendTaskList(userId, ctx) {
  const user = await loadUserTasks(userId);
  if (!user || !Array.isArray(user.tasks) || user.tasks.length === 0) {
    ctx.reply(withFooter('Список завдань пустий.\nЩоб додати нове завдання, введіть команду /add і напишіть свої завдання.'));
    return;
  }
  const ut = await loadUserTimers(userId);
  const globalLabel = ut?.label || null;
  const completed = [];
  const uncompleted = [];
  user.tasks.forEach((t, i) => {
    const done = user.completed && user.completed[i];
    const isGeneral = ut?.enabled && !(t?.urgent) && !(t?.reminderLabel);
    const line = formatTaskInfo(t, i, done, true, globalLabel, isGeneral && !done);
    if (done) completed.push(line); else uncompleted.push(line);
  });
  let msg = '📋 Стан ваших завдань:\n';
  if (completed.length) msg += `${EMOJI.done} Виконані:\n` + completed.join('\n') + '\n';
  if (uncompleted.length) msg += `${EMOJI.todo} Невиконані:\n` + uncompleted.join('\n');
  ctx.reply(withFooter(msg), { parse_mode: 'MarkdownV2' });
}

// Короткий список невиконаних задач з позначками urgent / general timer
async function sendUncompletedListPlain(userId, ctx) {
  const user = await loadUserTasks(userId);
  if (!user || !user.tasks || user.tasks.length === 0) {
    ctx.reply(withFooter('Список завдань пустий.\nЩоб додати нове завдання, введіть команду /add і напишіть свої завдання.'));
    return;
  }
  const ut = await loadUserTimers(userId);
  const globalLabel = ut?.label || null;
  const lines = [];
  user.tasks.forEach((t, i) => {
    const done = user.completed && user.completed[i];
    if (done) return;
    const isGeneral = ut?.enabled && !(t?.urgent) && !(t?.reminderLabel);
    lines.push(formatTaskInfo(t, i, false, false, globalLabel, isGeneral));
  });
  if (lines.length === 0) {
    ctx.reply(withFooter('Нема невиконаних задач.'));
    return;
  }
  ctx.reply(withFooter('Невиконані задачі:\n' + lines.join('\n')));
}

// Обробка натискань на кнопки нагадувань
bot.action(/task_action:(complete|stop|keep):(\d+)/, async (ctx) => {
  try {
    const action = ctx.match[1];
    const idx = parseInt(ctx.match[2], 10);
    const userId = ctx.from.id;
    const user = await loadUserTasks(userId);
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
      await saveUserTasks(userId);
      await ctx.editMessageReplyMarkup();
      await ctx.reply(withFooter('Позначив завдання як виконане.'));
      await sendTaskList(userId, ctx);
      await ctx.answerCbQuery('Завдання позначено як виконане');
    } else if (action === 'stop') {
      if (taskObj) {
        clearTaskReminder(taskObj);
      }
      await saveUserTasks(userId);
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
bot.command("list", async (ctx) => {
  const userId = ctx.from.id;
  await sendTaskList(userId, ctx);
});

// Команда /start
bot.start((ctx) => {
  ctx.reply("Привіт 👋 Я твій планувальник! Напиши мені завдання.");
  ctx.reply("Давай спершу встановимо таймер як часто ти хочеш отримувати нагадування про виконання завдань?\nОбери команду /timer");
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
bot.command("timer", async (ctx) => {
  const userId = ctx.from.id;
  // Reset any pending task states to avoid conflicts
  const user = await loadUserTasks(userId);
  user.waitingForTask = false;
  user.waitingForUrgency = false;
  user.waitingForTaskTimer = false;
  user.waitingForRemove = false;
  user.waitingForEditIndex = false;
  user.waitingForEditText = false;
  user.waitingForComplete = false;
  delete user.pendingTaskIndex;
  delete user.editIndex;
  delete user.pendingHourForTask;
  await saveUserTasks(userId);
  let msg = "⏰ Обери частоту нагадувань:\n";
  timerOptions.forEach((opt, i) => {
    msg += `${i + 1}. ${opt.label}\n`;
  });
  msg += "\nАбо введіть власний час, наприклад '16:45' для щоденного, або 'через 30 хвилин' для інтервалу.";
  ctx.reply(msg);
  const ut = await loadUserTimers(userId);
  ut.waitingForTimer = true;
  await saveUserTimers(userId);
});

// Команда /add
bot.command("add", async (ctx) => {
  const userId = ctx.from.id;
  const user = await loadUserTasks(userId);
  user.waitingForTask = true;
  await saveUserTasks(userId);
  ctx.reply("Напиши текст завдання одним повідомленням.");
});

// Команда /remove
bot.command("remove", async (ctx) => {
  const userId = ctx.from.id;
  const user = await loadUserTasks(userId);
  if (!user || user.tasks.length === 0) {
    ctx.reply("Список завдань пустий. \nЩоб додати нове завдання, введіть команду /add і напишіть свої завдання.");
    return;
  }
  const tasksList = user.tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
  ctx.reply(`Введіть номер завдання, яке потрібно видалити:\n${tasksList}`);
  user.waitingForRemove = true;
  await saveUserTasks(userId);
});

// Команда /edit
bot.command("edit", async (ctx) => {
  const userId = ctx.from.id;
  const user = await loadUserTasks(userId);
  if (!user || user.tasks.length === 0) {
    ctx.reply("Список завдань пустий. \nЩоб додати нове завдання, введіть команду /add і напишіть свої завдання.");
    return;
  }
  const tasksList = user.tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
  ctx.reply(`Введіть номер завдання, яке потрібно змінити:\n${tasksList}`);
  user.waitingForEditIndex = true;
  await saveUserTasks(userId);
});

// Команда /complete
bot.command("complete", async (ctx) => {
  const userId = ctx.from.id;
  const user = await loadUserTasks(userId);
  if (!user || user.tasks.length === 0) {
    ctx.reply("Список завдань пустий. \nЩоб додати нове завдання, введіть команду /add і напишіть свої завдання.");
    return;
  }
  // Перевіряємо, чи є невиконані завдання
  const uncompletedIndexes = user.tasks
    .map((_, i) => i)
    .filter(i => !(user.completed && user.completed[i]));
  if (uncompletedIndexes.length === 0) {
    ctx.reply("Всі завдання виконані! Додайте нові через /add.");
    return;
  }
  const tasksList = user.tasks.map((t, i) => {
    const done = user.completed && user.completed[i];
    return formatTaskInfo(t, i, done, true);
  }).join("\n");
  ctx.reply(`✅ Введіть номер завдання, яке виконано:\n${tasksList}`, { parse_mode: "MarkdownV2" });
  user.waitingForComplete = true;
  await saveUserTasks(userId);
});

// Обробка тексту для видалення завдання
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  // Додавання завдання (чекаємо тексту)
  if (userTasks[userId] && userTasks[userId].waitingForTask) {
    const text = ctx.message.text;
    const user = await loadUserTasks(userId);
    // зберігаємо як об'єкт
    const idx = user.tasks.push({ text, urgent: false, reminderId: null, reminderInterval: null }) - 1;
    user.waitingForTask = false;
    user.pendingTaskIndex = idx;
    user.waitingForUrgency = true;
    await saveUserTasks(userId);
    ctx.reply("Чи важливе це завдання?\n1. Так\n2. Ні (якщо ні, завдання буде під загальним таймером)");
    return;
  }

  // Обробка відповіді на питання про терміновість
  if (userTasks[userId] && userTasks[userId].waitingForUrgency) {
    const ans = ctx.message.text.trim();
    const user = await loadUserTasks(userId);
    const idx = user.pendingTaskIndex;
    if (ans === '1' || /^так$/i.test(ans)) {
      // важливе — пропонуємо таймер для цієї задачі
      user.tasks[idx].urgent = true;
      user.waitingForUrgency = false;
      user.waitingForTaskTimer = true;
      await saveUserTasks(userId);
      // показуємо опції таймера
      let msg = "Оберіть таймер для цього завдання:\n";
      timerOptions.forEach((opt, i) => { msg += `${i + 1}. ${opt.label}\n`; });
      msg += "\nАбо введіть власний час, наприклад '16:45' для щоденного, або 'через 30 хвилин' для інтервалу.";
      ctx.reply(msg);
      return;
    }
    // не термінове
    user.waitingForUrgency = false;
    const tasksList = user.tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
    let msg = `Завдання збережено. Ось ваші задачі:\n${tasksList}\nДодайте нові через /add`;
    const ut = await loadUserTimers(userId);
    if (ut && ut.enabled && ut.label) {
      msg += `\n\nГлобальний таймер - ${ut.label};`;
    }
    ctx.reply(withFooter(msg));
    delete user.pendingTaskIndex;
    await saveUserTasks(userId);
    return;
  }

  // Обробка вибору таймера для конкретної задачі
  if (userTasks[userId] && userTasks[userId].waitingForTaskTimer) {
    const num = parseInt(ctx.message.text);
    const user = await loadUserTasks(userId);
    const idx = user.pendingTaskIndex;
    if (!isNaN(num) && num >= 1 && num <= timerOptions.length) {
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
        await saveUserTasks(userId);
      } else {
        setTaskReminder(userId, idx, ms, ctx, label);
        user.waitingForTaskTimer = false;
        await saveUserTasks(userId);
        const tasksList = user.tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
        ctx.reply(withFooter(`${EMOJI.reminder} Таймер для задачі встановлено: ${timerOptions[num - 1].label}\nОсь ваші задачі:\n${tasksList}`));
        delete user.pendingTaskIndex;
      }
    } else {
      const parsed = parseCustomTime(ctx.message.text);
      if (parsed) {
        if (parsed.type === 'daily') {
          const task = user.tasks[idx];
          clearTaskReminder(task);
          const now = new Date();
          const next = new Date(now);
          next.setHours(parsed.hour, parsed.minute || 0, 0, 0);
          if (next <= now) next.setDate(next.getDate() + 1);
          task.reminderLabel = `${parsed.hour.toString().padStart(2, '0')}:${(parsed.minute || 0).toString().padStart(2, '0')} (щодня)`;
          task.reminderSchedule = { type: 'daily_hour', hour: parsed.hour, minute: parsed.minute || 0 };
          task.nextReminder = next.getTime();
          await saveUserTasks(userId);
          user.waitingForTaskTimer = false;
          const tasksList = user.tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
          ctx.reply(withFooter(`${EMOJI.reminder} Таймер для задачі встановлено: ${task.reminderLabel}\nОсь ваші задачі:\n${tasksList}`));
          delete user.pendingTaskIndex;
        } else if (parsed.type === 'interval') {
          const label = humanizeInterval(parsed.ms);
          setTaskReminder(userId, idx, parsed.ms, ctx, label);
          user.waitingForTaskTimer = false;
          await saveUserTasks(userId);
          const tasksList = user.tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
          ctx.reply(withFooter(`${EMOJI.reminder} Таймер для задачі встановлено: ${label}\nОсь ваші задачі:\n${tasksList}`));
          delete user.pendingTaskIndex;
        }
      } else {
        ctx.reply("Введіть коректний номер таймера або власний час.");
      }
    }
    return;
  }
  // Видалення завдання
  if (userTasks[userId] && userTasks[userId].waitingForRemove) {
    const num = parseInt(ctx.message.text);
    const user = await loadUserTasks(userId);
    if (isNaN(num) || num < 1 || num > user.tasks.length) {
      ctx.reply(withFooter("Введіть коректний номер завдання для видалення."));
      return;
    }
    const removed = user.tasks.splice(num - 1, 1)[0];
    // очистити нагадування для видаленого завдання, якщо воно було об'єктом з reminderId
    if (removed && typeof removed === 'object') {
      clearTaskReminder(removed);
    }
    user.waitingForRemove = false;
    await saveUserTasks(userId);
    if (user.tasks.length === 0) {
      ctx.reply(withFooter("Завдання було видалено. Список завдань пустий. Щоб додати нове завдання, введіть команду /add і напишіть свої завдання."));
    } else {
  const tasksList = user.tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
  ctx.reply(withFooter(`Оновлений список:\n${tasksList}`));
    }
    return;
  }
  // Позначення виконаного завдання
  if (userTasks[userId] && userTasks[userId].waitingForComplete) {
    const num = parseInt(ctx.message.text);
    const user = await loadUserTasks(userId);
    if (isNaN(num) || num < 1 || num > user.tasks.length) {
      ctx.reply("Введіть коректний номер завдання для виконання.");
      return;
    }
    if (!user.completed) user.completed = {};
    if (user.completed[num - 1]) {
      ctx.reply(withFooter("Це завдання вже виконане. Оберіть інше."));
      return;
    }
    // clear reminder for completed task if present
    const taskObj = user.tasks[num - 1];
    if (taskObj && typeof taskObj === 'object') {
      clearTaskReminder(taskObj);
    }
    user.completed[num - 1] = true;
    user.waitingForComplete = false;
    await saveUserTasks(userId);
    const tasksList = user.tasks.map((t, i) => {
      const done = user.completed && user.completed[i];
      return formatTaskInfo(t, i, done, true);
    }).join("\n");
  const headerEsc = escapeMarkdownV2("Завдання виконано! Ось ваш оновлений список:");
  const footerEsc = escapeMarkdownV2("\n\nБільше функцій — /help");
  ctx.reply(`${headerEsc}\n${tasksList}${footerEsc}`, { parse_mode: 'MarkdownV2' });
    return;
  }
  // Початок редагування завдання
  if (userTasks[userId] && userTasks[userId].waitingForEditIndex) {
    const num = parseInt(ctx.message.text);
    const user = await loadUserTasks(userId);
    if (isNaN(num) || num < 1 || num > user.tasks.length) {
      ctx.reply("Введіть коректний номер завдання для редагування.");
      return;
    }
    user.editIndex = num - 1;
    user.waitingForEditIndex = false;
    user.waitingForEditText = true;
    await saveUserTasks(userId);
    ctx.reply("Введіть новий текст для цього завдання:");
    return;
  }
  // Завершення редагування завдання
  if (userTasks[userId] && userTasks[userId].waitingForEditText) {
    const user = await loadUserTasks(userId);
    user.tasks[user.editIndex] = ctx.message.text;
    user.waitingForEditText = false;
    delete user.editIndex;
    await saveUserTasks(userId);
  const tasksList = user.tasks.map((t, i) => formatTaskInfo(t, i, false)).join("\n");
  ctx.reply(withFooter(`Зміни збережено! Ось ваш оновлений список:\n${tasksList}`));
    return;
  }
  // Вибір таймера
  if (userTimers[userId] && userTimers[userId].waitingForTimer) {
    const num = parseInt(ctx.message.text);
    const ut = await loadUserTimers(userId);
    if (!isNaN(num) && num >= 1 && num <= timerOptions.length) {
      const choice = timerOptions[num - 1].value;
      ut.waitingForTimer = false;
      await saveUserTimers(userId);
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
    } else {
      const parsed = parseCustomTime(ctx.message.text);
      if (parsed) {
        ut.waitingForTimer = false;
        if (parsed.type === 'daily') {
          // clear existing global schedule
          if (ut.timeoutId) { try { clearTimeout(ut.timeoutId); } catch (e) {} ut.timeoutId = null; }
          if (ut.intervalId) { try { clearInterval(ut.intervalId); } catch (e) {} ut.intervalId = null; }
          // compute next occurrence
          const now = new Date();
          const next = new Date(now);
          next.setHours(parsed.hour, parsed.minute || 0, 0, 0);
          if (next <= now) next.setDate(next.getDate() + 1);
          ut.schedule = { type: 'daily_hour', hour: parsed.hour, minute: parsed.minute || 0 };
          ut.label = `${parsed.hour.toString().padStart(2,'0')}:${(parsed.minute || 0).toString().padStart(2, '0')} (щодня)`;
          ut.enabled = true;
          ut.nextGlobalReminder = next.getTime();
          await saveUserTimers(userId);
          ctx.reply(withFooter(`Глобальний таймер щоденно о ${ut.label} встановлено.`));
        } else if (parsed.type === 'interval') {
          setUserReminder(userId, parsed.ms, ctx);
          ctx.reply(withFooter(`Таймер встановлено: ${humanizeInterval(parsed.ms)}`));
        }
      } else {
        ctx.reply("Введіть коректний номер таймера або власний час.");
        ut.waitingForTimer = true;
        await saveUserTimers(userId);
      }
    }
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
    const ut = await loadUserTimers(userId);
    // clear existing global schedule
    if (ut.timeoutId) { try { clearTimeout(ut.timeoutId); } catch (e) {} ut.timeoutId = null; }
    if (ut.intervalId) { try { clearInterval(ut.intervalId); } catch (e) {} ut.intervalId = null; }
    // compute next occurrence
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    ut.schedule = { type: 'daily_hour', hour };
    ut.label = `${hour.toString().padStart(2,'0')}:00 (щодня)`;
    ut.enabled = true;
    ut.nextGlobalReminder = next.getTime();
    await saveUserTimers(userId);
    await ctx.editMessageReplyMarkup();
    await ctx.reply(withFooter(`Глобальний таймер щоденно о ${hour.toString().padStart(2,'0')}:00 встановлено.`));
    await ctx.answerCbQuery('Година встановлена');
  } catch (err) {
    console.error('pick_global_hour handler err', err);
  }
});

// Обробка вибору таймера
async function setUserReminder(userId, intervalMs, ctx) {
  const ut = await loadUserTimers(userId);
  // clear existing
  if (ut.intervalId) {
    try { clearInterval(ut.intervalId); } catch (e) {}
    ut.intervalId = null;
  }
  if (ut.timeoutId) {
    try { clearTimeout(ut.timeoutId); } catch (e) {}
    ut.timeoutId = null;
  }
  ut.intervalMs = intervalMs;
  ut.enabled = true;
  ut.label = humanizeInterval(intervalMs) || 'custom';
  ut.nextGlobalReminder = Date.now() + intervalMs;
  await saveUserTimers(userId);
}

// Обробка вибору години для щоденного таймера
bot.action(/pick_hour:(\d+):(\d+)/, async (ctx) => {
  try {
    const taskIdx = parseInt(ctx.match[1], 10);
    const hour = parseInt(ctx.match[2], 10);
    const userId = ctx.from.id;
    const user = await loadUserTasks(userId);
    if (!user || !user.tasks || !user.tasks[taskIdx]) {
      await ctx.answerCbQuery('Задача не знайдена');
      return;
    }
    const task = user.tasks[taskIdx];
    // clear existing
    clearTaskReminder(task);
    // compute next occurrence
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    task.reminderLabel = `${hour.toString().padStart(2, '0')}:00 (щодня)`;
    task.reminderSchedule = { type: 'daily_hour', hour };
    task.nextReminder = next.getTime();
    await saveUserTasks(userId);
    await ctx.editMessageReplyMarkup();
    await ctx.reply(withFooter(`Таймер щоденно о ${hour.toString().padStart(2, '0')}:00 встановлено.`));
    await ctx.answerCbQuery('Година встановлена');
  } catch (err) {
    console.error('pick_hour handler err', err);
  }
});

module.exports = {
  bot,
  userTasks,
  userTimers,
  setUserReminder,
  sendTaskList,
  sendUncompletedListPlain,
  clearTaskReminder,
  setTaskReminder
};
