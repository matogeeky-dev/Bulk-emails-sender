# Dispatch — Bulk Email Draft Creator

Creates personalized email drafts across up to 60 connected mailboxes at
once — all accounts working in parallel, ready within minutes regardless of
total recipient count — rotating between up to 5 email copies. Everything
lands in each account's own **Drafts** folder for you to review and send
yourself.

## Why drafts instead of sending directly

Most free hosting platforms (Render, Railway, and others) block outbound
SMTP — the protocol normally used to send email — to prevent spam abuse.
This app sidesteps that entirely by using **IMAP** instead, which is a
different protocol used for reading/managing a mailbox, not sending. IMAP
isn't a spam vector, so it isn't blocked the same way. The app writes a
fully personalized message straight into your Drafts folder; you open your
own mail app and tap send on each one whenever you're ready. This also means
every send is a real manual action, which is both safer for account
reputation and unaffected by any platform's SMTP policy. Since nothing is
actually sent by the app, there's no reason to pace or space out draft
creation the way you'd have to pace real sending — everything gets queued
up as fast as each mail server allows.

## How it works

1. **Connect accounts** — add each Gmail / Yahoo / Outlook / custom-domain
   mailbox with its app password. Each account can hold up to 100 drafts
   per campaign.
2. **New campaign**
   - Upload a `name,email` CSV of recipients, and/or paste recipients manually.
   - Write or paste up to 5 email copies. Use `{{name}}` anywhere you want
     the recipient's name inserted. Each copy can have its own image/file
     attachments (8MB max per file) — shared by everyone who gets that copy.
   - Pick which accounts take part and how many drafts each one creates.
   - Optionally schedule a future start time, or start immediately.
3. **Create drafts.** The app assigns each recipient copy 1, 2, 3… (wrapping
   back to 1) in order, then all connected accounts create their drafts at
   the same time, in parallel, over a single reused IMAP connection per
   account — so 2,000 recipients spread across many accounts finishes in
   minutes, not hours. There's a small pause between individual drafts on
   the same connection (configurable in `.env.example`) just to stay
   friendly to each provider's server, not to throttle sending.
4. **Campaigns** view shows live per-account progress and lets you pause,
   resume, or cancel a run.
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
  30-50 seconds to wake back up on the next visit. This mainly matters if
  you scheduled a future start time for a campaign — it won't fire until
  something wakes the service up again. If you want a scheduled campaign to
  start close to on-time even when you're not actively watching the
  dashboard, use a free uptime pinger like
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

## Attachments

Each email copy can have images or files attached (max 8MB per file) — a
photo, a PDF brochure, a spec sheet, whatever fits the outreach. A couple of
things worth knowing:

- **Videos aren't supported as attachments, on purpose.** Most mail
  providers reject or strip large attachments outright, and video files
  bloat message size in a way that tanks deliverability. If you want to
  share a video, link to a hosted version (YouTube, Google Drive, etc.) in
  the email body text instead — that's standard practice for outreach email
  anyway.
- Attachments are stored separately from your accounts/campaigns data (their
  own MongoDB collection, or their own local files if you're not using
  Atlas) rather than embedded in the same document — this keeps the app
  stable regardless of how many campaigns pile up, since MongoDB caps any
  single document at 16MB.
- An attachment you upload is shared by every recipient who gets that
  specific copy (copy 1's files go out with copy 1, copy 2's with copy 2,
  etc.) — not per-recipient.

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
- If the app restarts mid-run, already-created drafts are marked
  `drafted` and won't be duplicated — the scheduler picks up wherever it
  left off on the next tick.
- "Resume" on a paused campaign immediately drafts anything still pending
  for every connected account.
- The Drafts folder is auto-detected per account using the IMAP
  "special-use" flag most providers set; if a provider doesn't set that
  flag, it falls back to looking for a folder with "draft" in the name.
