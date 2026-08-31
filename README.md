# Dispatch — Bulk Email Draft Creator

Creates personalized email drafts across up to 60 connected mailboxes at
once, in batches of 10, spaced hours apart, rotating between up to 5 email
copies — ready and waiting in each account's own **Drafts** folder for you
to review and send yourself.

## Why drafts instead of sending directly

Most free hosting platforms (Render, Railway, and others) block outbound
SMTP — the protocol normally used to send email — to prevent spam abuse.
This app sidesteps that entirely by using **IMAP** instead, which is a
different protocol used for reading/managing a mailbox, not sending. IMAP
isn't a spam vector, so it isn't blocked the same way. The app writes a
fully personalized message straight into your Drafts folder; you open your
own mail app and tap send on each one whenever you're ready. This also means
every send is a real manual action, which is both safer for account
reputation and unaffected by any platform's SMTP policy.

## How it works

1. **Connect accounts** — add each Gmail / Yahoo / Outlook / custom-domain
   mailbox with its app password. Each account can hold up to 100 drafts
   per campaign.
2. **New campaign**
   - Upload a `name,email` CSV of recipients, and/or paste recipients manually.
   - Write or paste up to 5 email copies. Use `{{name}}` anywhere you want
     the recipient's name inserted.
   - Pick which accounts take part and how many drafts each one creates.
   - Set the gap between batches (e.g. 1 hour) and a start time.
3. **Create drafts.** The app splits each account's recipients into batches
   of 10, assigns copy 1, 2, 3… (wrapping back to 1) to each recipient in
   order, and creates all accounts' batch 1 drafts at once, batch 2 one gap
   later, and so on — a background scheduler checks every minute for
   batches that are due. By default it creates one draft per minute within
   a batch (so a batch of 10 takes 10 minutes), then waits the full gap
   (default 1 hour) before the next batch. Both are configurable — see
   `.env.example` for the per-draft delay and the "Gap between batches"
   field in the New Campaign form for the batch spacing.
4. **Campaigns** view shows live per-account progress (the batch "relay"
   strip) and lets you pause, resume, or cancel a run.
5. **Sending is manual, on purpose.** Open each connected mailbox's own
   mail app (Gmail app, Yahoo app, Zoho, Outlook, etc.), go to Drafts, and
   send each one. This is the actual point of the draft-based approach —
   nothing about it is meant to be automated further.

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

## Data storage: MongoDB Atlas

This app stores accounts and campaigns in MongoDB instead of a local file, so
your data survives restarts and redeploys on any host — including free
tiers that don't offer persistent disks (like Render Free). Setting up a
free Atlas cluster takes about 5 minutes and is covered step by step below.

If you skip this and don't set `MONGODB_URI`, the app still runs locally
using a `data/db.json` file — useful for quick local testing, but **do not
rely on this in production**: it resets whenever the host restarts the
container, which happens often on free hosting.

## Full deployment walkthrough (Render + MongoDB Atlas — both free)

### Part 1 — Create a free MongoDB Atlas cluster

1. Go to [mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register) and sign up (no card required).
2. When prompted to create a cluster, choose **M0 Free** (512MB, permanently free).
3. Pick any cloud provider/region (closest to you is fine) and click **Create**.
4. **Create a database user**: you'll be prompted for a username and
   password — set these and **save them somewhere**, you'll need them in a
   moment. (If you're not prompted automatically, go to **Database Access**
   in the left sidebar → **Add New Database User**.)
5. **Allow network access**: go to **Network Access** in the left sidebar →
   **Add IP Address** → choose **Allow Access From Anywhere** (`0.0.0.0/0`).
   This is necessary because Render's servers don't have a fixed IP on the
   free plan.
6. Once the cluster finishes deploying (a minute or two), click **Connect**
   on your cluster → **Drivers** → choose **Node.js**. Copy the connection
   string shown — it looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
7. Replace `<username>` and `<password>` with the database user credentials
   from step 4. Also insert a database name before the `?` so your data has
   a clear home, e.g.:
   ```
   mongodb+srv://myuser:mypassword@cluster0.xxxxx.mongodb.net/bulk_email_sender?retryWrites=true&w=majority
   ```
   Keep this full string somewhere safe — this is your `MONGODB_URI`.

### Part 2 — Push the project to GitHub

(Skip this if you've already got the repo up from earlier — just make sure
the latest files are uploaded, especially `lib/imapDrafts.js` (new),
`routes/accounts.js`, `lib/scheduler.js`, `routes/campaigns.js`,
`public/index.html`, `public/app.js`, and `package.json`.)

1. Create a new repo on GitHub (or reuse your existing one).
2. Upload every file from this project, preserving folder structure
   (`lib/`, `routes/`, `public/`, plus the root files). Remember
   `data/.gitkeep` needs to be added as its own file — GitHub can't upload
   empty folders directly.

### Part 3 — Deploy on Render

1. Go to [render.com](https://render.com), sign up (no card required for
   the Free plan).
2. **New → Web Service** → connect your GitHub account → select the repo.
3. Render should detect `render.yaml` and pre-fill the build command
   (`npm install`), start command (`npm start`), and plan (`free`). If it
   doesn't auto-detect, set those three manually — make sure the build
   command is `npm install`, not `yarn install`.
4. Under **Environment**, add three variables:
   - `APP_USERNAME` — whatever you want your dashboard login username to be
   - `APP_PASSWORD` — whatever you want your dashboard login password to be
   - `MONGODB_URI` — the full connection string from Part 1, step 7
5. Click **Create Web Service**. Render will build and deploy — takes a
   couple of minutes on first deploy.
6. Once it's live, open the Render-provided URL, log in with the
   `APP_USERNAME`/`APP_PASSWORD` you set, and reconnect your sending
   accounts (Gmail, Yahoo, custom domains).
7. Click **Create test draft** on an account, then check that account's
   actual Drafts folder (in Gmail, Zoho, etc.) to confirm it showed up.

### What to expect on the Free plan

- **IMAP works** — this is the whole reason the app was rebuilt around
  drafts instead of direct sending.
- **Your data persists** — accounts and campaigns are in Atlas now, not on
  local disk, so they survive restarts and redeploys.
- **The service sleeps after ~15 minutes of no HTTP traffic**, and takes
  30-50 seconds to wake back up on the next visit. This mainly matters for
  the background scheduler: a batch scheduled to be drafted at, say, 3am
  won't happen until something wakes the service up again. If you want
  batches created close to on-time even when you're not actively watching
  the dashboard, use a free uptime pinger like
  [cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com)
  to hit your Render URL every 10 minutes — keeps the service awake and the
  scheduler ticking on schedule, at no extra cost.

## Connecting mailboxes

- **Gmail / Yahoo / Outlook**: these require an **app password**, not your
  normal login password (they need 2-factor authentication turned on
  first), and **IMAP access must be enabled** on the account:
  - Gmail: Google Account → Security → 2-Step Verification → App passwords.
    IMAP is on by default for Gmail.
  - Yahoo: Account Security → Generate app password. Confirm IMAP is
    allowed under Account Security settings.
  - Outlook: similar app-password flow under Microsoft account security.
- **Custom domain mail**: you only need the **IMAP host** (e.g.
  `imappro.zoho.com` for Zoho's paid tier, `imap.zoho.com` for free Zoho) —
  no port or SSL setting needed, the app always uses port 993 with SSL,
  which is the near-universal standard for IMAP. Confirm IMAP access is
  turned on for the mailbox in your provider's settings (Zoho, cPanel
  email, etc. often have this off by default for business plans).

## Sending limits & deliverability — read before a big send

Since sending itself is manual now, these are things to keep in mind as you
personally click send on the drafts, not something the app enforces:

- Gmail and Yahoo cap **external** sending around 400–500/day per account.
- New or low-activity mailboxes get flagged faster by spam filters than
  warmed-up ones. Consider sending fewer per day from a brand-new mailbox
  and ramping up over 1-2 weeks.
- This tool does not add an unsubscribe link or physical address
  automatically. If these are marketing emails to people who haven't opted
  in, check your local email-marketing regulations (e.g. CAN-SPAM, GDPR,
  Nigeria's NDPA) before sending — you're responsible for what goes out
  through your connected accounts.
- Credentials are stored in plain text in your MongoDB Atlas database (or
  local `data/db.json` if you're not using Atlas). Treat that database as
  sensitive — anyone with the connection string can read every account's
  password.

## Notes on the current build

- CSV parsing is intentionally simple (comma-separated, quoted-comma
  support). Very unusual CSV dialects (embedded newlines, semicolon
  delimiters) aren't handled.
- If the app restarts mid-batch, already-created drafts are marked
  `drafted` and won't be duplicated — the scheduler picks up wherever it
  left off on the next tick.
- "Resume" on a paused campaign creates any batches whose scheduled time
  has already passed immediately, then continues on the normal spacing from
  there.
- The Drafts folder is auto-detected per account using the IMAP
  "special-use" flag most providers set; if a provider doesn't set that
  flag, it falls back to looking for a folder with "draft" in the name.
