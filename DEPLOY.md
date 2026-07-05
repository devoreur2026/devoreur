# Deploying UMBRA

This walks you through putting UMBRA online so anyone can play it at a public
URL. It assumes you've never deployed anything. Every command and click is
spelled out.

Two stages:
1. **Put the code on GitHub** (a public home for your code).
2. **Deploy it to a host** that runs the server 24/7 and gives you a URL.

---

## Which host? (read this first)

UMBRA is a **WebSocket** game — the browser holds an always-open connection to
the server. Pick a host that keeps a Node process running and supports
WebSockets. Good options:

| Host | Cost | WebSockets | Catch |
|------|------|-----------|-------|
| **Render** | **Free** | Yes | Free instances **sleep after ~15 min idle**; first visit then takes ~30–60s to wake. Fine for sharing/demos. |
| **Railway** | ~$5/mo (small free trial credit first) | Yes | No sleeping, always-on. Best play experience. Not truly free anymore. |
| Fly.io | Small free allowance | Yes | More command-line setup. |

**Recommendation:**
- Want it **free** and don't mind a slow first wake-up → **Render** (Part 3).
- Want it **always-on** and can spend ~$5/mo → **Railway** (Part 2).

Both use the exact same GitHub repo from Part 1. Do Part 1, then pick Part 2 **or** Part 3.

---

## Part 1 — Put the code on GitHub

You already have `git` and the GitHub CLI (`gh`) installed, and your git
identity is set. You just need a (free) GitHub account and to log in.

### 1.1 Make a GitHub account
Open <https://github.com/signup> and create an account (skip if you have one).

### 1.2 Log the CLI into GitHub
In your terminal, from the project folder, run:

```bash
gh auth login
```

Answer the prompts:
- **What account do you want to log into?** → `GitHub.com`
- **What is your preferred protocol for Git operations?** → `HTTPS`
- **Authenticate Git with your GitHub credentials?** → `Yes`
- **How would you like to authenticate?** → `Login with a web browser`

It shows a one-time code and opens your browser. Paste the code, click
**Authorize**. Done.

### 1.3 Create the repo and push (one command)
From the project folder (`/Users/benjaminkashamuka/umbra`):

```bash
gh repo create umbra --public --source=. --remote=origin --push
```

This creates a public repo named `umbra` on your account and uploads everything.
When it finishes it prints your repo URL, e.g. `https://github.com/YOURNAME/umbra`.

> Prefer clicking instead of the CLI? Go to <https://github.com/new>, set
> **Repository name** = `umbra`, choose **Public**, leave every "Initialize"
> box **unchecked**, click **Create repository**, then run:
> ```bash
> git remote add origin https://github.com/YOURNAME/umbra.git
> git push -u origin master
> ```

Your code is now on GitHub. Continue to Part 2 **or** Part 3.

---

## Part 2 — Deploy on Railway (always-on, ~$5/mo)

1. Go to <https://railway.com> and click **Login** → **Login with GitHub**.
   Authorize Railway when GitHub asks.
2. On the dashboard click **New Project**.
3. Choose **Deploy from GitHub repo**.
   - If prompted, click **Configure GitHub App** and give Railway access to
     your `umbra` repo (choose "Only select repositories" → pick `umbra` →
     **Install**).
4. Pick the **umbra** repo from the list. Railway starts building immediately.
   It auto-detects Node, runs `npm install`, then `npm start`. Wait for the
   build log to say it's running (~1–2 min).
5. Give it a public URL: open the service (the box named `umbra`) →
   **Settings** tab → **Networking** section → **Generate Domain**.
   - If it asks for a **port**, enter `8080` (Railway also injects a `PORT`
     env var and our server reads it automatically — you don't set anything).
6. Railway shows a URL like `https://umbra-production-xxxx.up.railway.app`.
   Click it. UMBRA loads. 🎉

That's it — jump to **Part 4** to test it.

> Cost note: Railway gives a small trial credit, then requires the **Hobby**
> plan (~$5/month, which includes usage). A tiny game like this uses very
> little. If you'd rather not pay, use Render below instead.

---

## Part 3 — Deploy on Render (free)

1. Go to <https://render.com> and click **Get Started** → **GitHub**. Authorize
   Render.
2. On the dashboard click **New +** (top right) → **Web Service**.
3. **Connect your repo**: find `umbra` in the list and click **Connect**. (If
   you don't see it, click **Configure account / Configure GitHub App**, grant
   access to the `umbra` repo, then come back.)
4. Fill in the settings (most auto-fill correctly):
   - **Name**: `umbra` (this becomes part of your URL)
   - **Region**: pick the one closest to you
   - **Branch**: `master`
   - **Runtime / Language**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
5. Click **Create Web Service** (or **Deploy Web Service**). Watch the log; when
   it prints `UMBRA server (game + web) running...` it's live (~2–3 min).
6. Your URL is at the top, like `https://umbra-xxxx.onrender.com`. Click it.
   UMBRA loads. 🎉

> Free-tier note: after ~15 minutes with no visitors the app sleeps. The next
> visit takes ~30–60 seconds to wake up, then it's normal speed. You don't lose
> anything — a fresh maze just starts.

---

## Part 4 — Test it's really multiplayer

1. Open your deployed URL. Type a name, click **Enter the maze**.
2. Open the **same URL in a second tab** (or send it to a friend). Type a
   different name, enter.
3. You should see each other moving in the same maze, with name tags, and a
   "Hunters in the maze" list on the right. First to the treasure wins the
   round; a new maze starts after the 10-second countdown.

If WebSockets are working (they are on both hosts above), the two tabs stay in
sync. The little padlock/`https` in the address bar means the game
automatically uses the secure `wss://` connection — no config needed.

---

## Part 5 — Push updates (redeploy)

Both hosts **auto-redeploy every time you push to GitHub**. To ship a change:

```bash
git add -A
git commit -m "describe your change"
git push
```

Wait ~1–3 minutes and refresh your URL. That's the whole loop.

---

## Troubleshooting

- **Build fails / "no start command"** — make sure `package.json` has
  `"start": "node server/index.js"` (it does) and that Node version is ≥18
  (set via the `engines` field — already included).
- **Page loads but players don't see each other** — that's WebSockets not
  connecting. On Render/Railway they work out of the box. If you moved to
  another host, confirm it supports WebSockets and doesn't strip the
  `Upgrade`/`Connection` headers on `/ws`.
- **"Application failed to respond" on Railway** — you skipped the **Generate
  Domain** step, or entered the wrong port. Our server listens on the injected
  `PORT`; just generate the domain (port `8080` if asked).
- **Render app is slow the first time** — it was asleep (free tier). Give it a
  minute; subsequent loads are fast until it idles again.
