Local testing instructions

1) Prerequisites
- Node.js installed (v16+ recommended)
- A Telegram bot `BOT_TOKEN` (set in `.env` for local testing)
- Optional: `ngrok` if you want to test webhooks locally

2) Run the bot locally (polling)
- Create a `.env` file in the project root with:

```bash
BOT_TOKEN=123456:ABC-DEF...
RUN_LOCAL=true
NODE_ENV=development
```

- Start the bot in polling mode:

```bash
node index.js
```

- Interact with the bot in Telegram (send `/start`, `/add`, set reminders). Polling mode will keep timers alive in your local process.

3) Force-run reminders (simulate scheduler)
- Use the helper to run the same logic the serverless endpoint uses. This does not require webhook or polling; it will call `processDueReminders()` directly.

```bash
node local-run-reminders.js
```

This is useful to trigger missed reminders immediately after you adjust `userTasks` or set timers.

4) Testing webhook locally (optional)
- If you want to test the webhook handler (`api/telegram.js`) locally, run a local server (e.g., `vercel dev` or another server) and expose it via `ngrok`:

```bash
# using vercel CLI
vercel dev
# in another terminal
grok http 3000
```

- Then set webhook to your ngrok URL and forward Telegram updates.

5) Testing the scheduled endpoint locally
- You can POST to the `api/run-reminders` endpoint locally by running a small express wrapper or calling the exported function directly (recommended).
- Example: `node local-run-reminders.js` will call `processDueReminders()`.

6) Notes & caveats
- On local polling, in-memory timers run reliably while the process is alive.
- In serverless deployments you still need an external scheduler to POST to `/api/run-reminders` regularly.
- State is in-memory only — restart will clear tasks. For longer tests, add a simple persistence layer.

If you want, I can add a minimal script to pre-populate a test task and set a 1-minute reminder so you can observe the behavior end-to-end. Tell me and I'll add it.