# Dispatch — Bulk Email Sender

Sends personalized email campaigns across up to 60 connected mailboxes at once,
in batches of 10, spaced hours apart, rotating between up to 5 email copies.

## How it works

1. **Connect accounts** — add each Gmail / Yahoo / Outlook / custom-domain
   mailbox with its app password. Each account can send up to 100 messages
   per campaign.
2. **New campaign**
   - Upload a `name,email` CSV of recipients.
   - Write or paste up to 5 email copies. Use `{{name}}` anywhere you want
     the recipient's name inserted.
   - Pick which accounts take part and how many messages each one sends.
   - Set the gap between batches (e.g. 1.5 hours) and a start time.
3. **Launch.** The app splits each account's recipients into batches of 10,
   assigns copy 1, 2, 3… (wrapping back to 1) to each recipient in order, and
   fires all accounts' batch 1 at once, batch 2 one gap later, and so on — a
   background scheduler checks every minute for batches that are due.
   By default each batch sends one message per minute (so a batch of 10 takes
   10 minutes), then waits the full gap (default 1 hour) before the next
   batch. Both are configurable — see `.env.example` for the per-message
   delay and the "Gap between batches" field in the New Campaign form for
   the batch spacing.
4. **Campaigns** view shows live per-account progress (the batch "relay"
   strip) and lets you pause, resume, or cancel a run.

## Local setup

```bash
npm install
cp .env.example .env   # edit APP_USERNAME / APP_PASSWORD at minimum
npm start
```

Visit `http://localhost:3000` — the browser will prompt for the username and
password you set in `.env`. This basic-auth gate is the only thing standing
between the dashboard and the public internet, so **change the default
password before deploying**.

## Deploying to Railway (from GitHub)

1. Push this project to a new GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo**, select it.
3. Railway auto-detects Node (via `railway.json` / Nixpacks) and runs
   `npm install` + `npm start`.
4. Under **Variables**, set:
   - `APP_USERNAME`, `APP_PASSWORD` — dashboard login
   - `SEND_DELAY_MS` — pause between individual sends in a batch (default 4000ms)
   - `SCHEDULER_INTERVAL_SECONDS` — how often it checks for due batches (default 60)
5. **Important — attach a Volume.** This app stores accounts and campaigns in
   `data/db.json` on local disk. Railway containers are ephemeral, so without
   a Volume your data disappears on every redeploy. In the service settings,
   add a Volume mounted at `/app/data`.
6. Deploy. Open the generated Railway URL and log in.

## Connecting mailboxes

- **Gmail / Yahoo / Outlook**: these require an **app password**, not your
  normal login password (they need 2-factor authentication turned on first).
  - Gmail: Google Account → Security → 2-Step Verification → App passwords.
  - Yahoo: Account Security → Generate app password.
- **Custom domain mail**: use the SMTP host/port your host gives you
  (e.g. `mail.yourdomain.com`, port 587 with STARTTLS, or 465 with SSL).

## Sending limits & deliverability — read before a big send

- Gmail and Yahoo cap **external** sending around 400–500/day per account;
  sending 100 in one campaign is comfortably under that, but running several
  campaigns on the same day on the same account will stack.
- New or low-activity mailboxes get flagged faster by spam filters than
  warmed-up ones. Consider starting new accounts at lower counts (10–20)
  before ramping to 100.
- This tool does not add an unsubscribe link or physical address
  automatically. If these are marketing emails to people who haven't opted
  in, check your local email-marketing regulations (e.g. CAN-SPAM, GDPR,
  Nigeria's NDPA) before sending — you're responsible for what goes out
  through your connected accounts.
- Credentials are stored in plain text in `data/db.json` on the server disk.
  Treat that Railway volume as sensitive, and don't commit `data/db.json`
  to git (it's already in `.gitignore`).

## Notes on the current build

- CSV parsing is intentionally simple (comma-separated, quoted-comma
  support). Very unusual CSV dialects (embedded newlines, semicolon
  delimiters) aren't handled.
- If the app restarts mid-batch, already-sent messages are marked `sent` and
  won't be resent — the scheduler picks up wherever it left off on the next
  tick.
- "Resume" on a paused campaign sends any batches whose scheduled time has
  already passed immediately, then continues on the normal spacing from
  there.
