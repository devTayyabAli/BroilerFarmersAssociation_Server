# BFA Backend Server

Node.js / Express API server for the BFA website.

## What it does

| Route | Description |
|---|---|
| `GET /api/rates/commodity-history?product=BROILER&city=lahore&days=1` | Proxies PoultryBaba API (CORS fix for production) |
| `POST /api/members` | Save BFA membership application to MongoDB |
| `GET /api/members` | List members (admin) |
| `POST /api/contact` | Save contact form message to MongoDB |
| `GET /api/contact` | List messages (admin) |
| `GET /api/health` | Health check |

## Setup

### 1. Install dependencies
```bash
cd server
npm install
```

### 2. Create `.env` from template
```bash
copy .env.example .env
```

Then fill in your real values:
```
PORT=5000
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/bfa_db
CORS_ORIGIN=https://your-site.netlify.app
```

### 3. Run locally
```bash
npm run dev        # uses nodemon for auto-reload
```

The Vite frontend also needs to run at the same time:
```bash
# In the root folder (separate terminal)
npm run dev
```
Vite proxies all `/api/*` requests to `http://localhost:5000` automatically.

## Deploy to Render (free tier)

1. Push the `server/` folder to GitHub (or the whole repo)
2. Create a new **Web Service** on [render.com](https://render.com)
3. Set **Root Directory** to `server`
4. Set **Build Command**: `npm install`
5. Set **Start Command**: `npm start`
6. Add environment variables:
   - `MONGODB_URI` — your MongoDB Atlas connection string
   - `CORS_ORIGIN` — your Netlify URL e.g. `https://bfa-org.netlify.app`
7. Copy the Render URL (e.g. `https://bfa-server.onrender.com`)

## Configure Netlify frontend

In Netlify → Site settings → Environment variables, add:
```
VITE_API_URL=https://bfa-server.onrender.com
```

Redeploy the Netlify site. Done — live rates and forms will work in production.
