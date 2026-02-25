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
└── .env.example
```

## Requirements

- Python 3.9+
- Anthropic API key (https://console.anthropic.com)
