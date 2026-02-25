# Fashion Sense — Outfit Advisor

Upload a photo of an outfit and get AI-powered suggestions for new clothing items, complete with estimated price ranges and shopping links.

## How it works

1. Upload any outfit photo (JPG, PNG, WebP, GIF)
2. Claude Vision analyzes the style, colors, and pieces
3. You receive 6 tailored clothing suggestions with:
   - Item description and why it complements your outfit
   - Estimated price range
   - Direct search links to Amazon, ASOS, Nordstrom, and Zara

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure your API key

```bash
cp .env.example .env
# Edit .env and add your Anthropic API key
```

### 3. Run the app

```bash
python app.py
```

Open http://localhost:5000 in your browser.

## Deploy to Vercel

### 1. Install the Vercel CLI

```bash
npm i -g vercel
```

### 2. Deploy

```bash
vercel
```

Follow the prompts. When asked about the framework, select **Other**.

### 3. Set your API key as an environment variable

In the Vercel dashboard → Project → Settings → Environment Variables, add:

```
ANTHROPIC_API_KEY = your_api_key_here
```

Or via the CLI:

```bash
vercel env add ANTHROPIC_API_KEY
```

Then redeploy to apply the variable:

```bash
vercel --prod
```

> **Vercel free-tier limits:** Serverless functions time out after 10 seconds and the request body is capped at 4.5 MB. For larger images or slower responses, upgrade to the Pro plan (60s timeout, up to 50 MB body).

---

## Project structure

```
fashion-sense/
├── app.py              # Flask backend + Claude API integration
├── templates/
│   └── index.html      # Single-page UI
├── static/
│   ├── css/style.css   # Dark-mode styling
│   └── js/app.js       # Drag-and-drop upload + results rendering
├── requirements.txt
├── vercel.json         # Vercel build + routing config
└── .env.example
```

## Requirements

- Python 3.9+
- Anthropic API key (https://console.anthropic.com)
