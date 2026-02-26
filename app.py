import os
import base64
import json
import io
import concurrent.futures
from flask import Flask, render_template, request, jsonify
import anthropic
import requests as http_requests
from dotenv import load_dotenv

from PIL import Image

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIF_SUPPORTED = True
except ImportError:
    HEIF_SUPPORTED = False

MAX_IMAGE_PX = 1024  # longest edge sent to the API

load_dotenv()

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB to support multiple files

_env_api_key = os.environ.get('ANTHROPIC_API_KEY')
# Global client used when no per-request key is provided
client = anthropic.Anthropic(api_key=_env_api_key)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_ext(filename):
    return filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''


def prepare_image(file):
    """Read, resize to MAX_IMAGE_PX on the longest edge, and base64-encode as JPEG."""
    ext = get_ext(file.filename)
    if ext in ('heic', 'heif') and not HEIF_SUPPORTED:
        raise ValueError(
            'HEIC/HEIF support requires pillow-heif. Run: pip install pillow-heif'
        )

    img = Image.open(io.BytesIO(file.read()))

    if max(img.size) > MAX_IMAGE_PX:
        img.thumbnail((MAX_IMAGE_PX, MAX_IMAGE_PX), Image.LANCZOS)

    buf = io.BytesIO()
    img.convert('RGB').save(buf, format='JPEG', quality=85)

    return base64.standard_b64encode(buf.getvalue()).decode('utf-8'), 'image/jpeg'


_BROWSER_UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/120.0.0.0 Safari/537.36'
)


def build_shopping_links(search_term, gender='unknown', category=''):
    """Build retailer search URLs filtered to the given gender ('male'/'female'/'unknown').

    Soleretriever is included only when category is 'shoes'.
    """
    ep  = search_term.replace(' ', '+')    # plus-encoded (Amazon, Nordstrom)
    pct = search_term.replace(' ', '%20')  # percent-encoded (most others)

    is_male   = gender == 'male'
    is_female = gender == 'female'

    # Amazon – Men's (node 1040658) or Women's (node 7141123011) clothing department
    amz_dept = '&rh=n%3A1040658' if is_male else ('&rh=n%3A7141123011' if is_female else '')

    # Nordstrom – department filter
    nord_dept = '&department=Mens' if is_male else ('&department=Womens' if is_female else '')

    # J.Crew – category filter
    jcrew_cat = '&c=mens' if is_male else ('&c=womens' if is_female else '')

    # Banana Republic – division filter
    br_div = '&division=mens' if is_male else ('&division=womens' if is_female else '')

    # Madewell – gender preference filter
    madewell_gender = '&prefn1=gender&prefv1=Men' if is_male else (
        '&prefn1=gender&prefv1=Women' if is_female else ''
    )

    # ASOS – gender lives in the URL path
    if is_male:
        asos_url = f'https://www.asos.com/men/search/?q={pct}'
    elif is_female:
        asos_url = f'https://www.asos.com/women/search/?q={pct}'
    else:
        asos_url = f'https://www.asos.com/search/?q={pct}'

    # Zara – section query param
    zara_section = '&section=man' if is_male else ('&section=woman' if is_female else '')

    # H&M – department filter
    hm_dept = '&department=Men' if is_male else ('&department=Ladies' if is_female else '')

    # Uniqlo – gender filter
    uniqlo_gender = '&gender=men' if is_male else ('&gender=women' if is_female else '')

    # Revolve – men's has a separate search path
    revolve_url = (
        f'https://www.revolve.com/mens-search/?q={pct}' if is_male
        else f'https://www.revolve.com/search/?q={pct}'
    )

    links = {
        'amazon':          f'https://www.amazon.com/s?k={ep}{amz_dept}&tag=mt0074-20',
        'nordstrom':       f'https://www.nordstrom.com/sr?origin=keywordsearch&keyword={ep}{nord_dept}',
        'j_crew':          f'https://www.jcrew.com/r/search?q={pct}{jcrew_cat}',
        'banana_republic': f'https://bananarepublic.gap.com/browse/search.do?searchText={pct}{br_div}',
        'madewell':        f'https://www.madewell.com/search?q={pct}{madewell_gender}',
        'asos':            asos_url,
        'zara':            f'https://www.zara.com/us/en/search?searchTerm={pct}{zara_section}',
        'hm':              f'https://www2.hm.com/en_us/search-results.html?q={pct}{hm_dept}',
        'uniqlo':          f'https://www.uniqlo.com/us/en/search?q={pct}{uniqlo_gender}',
        'revolve':         revolve_url,
    }

    # Soleretriever tracks sneaker release dates — only relevant for shoe suggestions
    if category.lower() == 'shoes':
        links['soleretriever'] = f'https://www.soleretriever.com/sneaker-release-dates?search={pct}'

    return links


# How many bytes to read per response when scanning for "no results" text.
# 100 KB captures the initial rendered HTML on server-side-rendered retailer
# pages (Amazon, Nordstrom, J.Crew, Banana Republic, Madewell, H&M) without
# downloading full pages.
_READ_LIMIT = 100_000

# Lowercase byte patterns that indicate a retailer search returned zero results.
# Matched against the first _READ_LIMIT bytes of the response body (lowercased).
_NO_RESULTS_PATTERNS = (
    b'no results for',
    b'no results found',
    b'0 results found',
    b'0 results for',
    b'no products found',
    b'did not match any products',   # Amazon
    b'no items found',
    b'search returned no results',
    b'your search returned 0',
    b"we couldn't find anything",    # ASOS
    b'no matches found',
    b'showing 0 results',
    b'found 0 products',
    b'"search-no-results"',          # common CSS hook used by many retailers
    b"'search-no-results'",
    b'class="no-results"',
    b'class="noresults"',
    b'id="no-results"',
    b'id="noresults"',
)


def _check_url(pair):
    """Return (retailer_key, has_results).

    Makes a streaming GET request, reads the first _READ_LIMIT bytes of the
    response body, and returns False if:
      - the HTTP status is 4xx / 5xx, or
      - the body contains a recognised "no results" indicator.

    Some retailers (e.g. Amazon) block server-side requests with CAPTCHAs or
    redirects, making validation unreliable.  These are skipped and assumed to
    always have results.
    """
    key, url = pair
    _SKIP_VALIDATION = {'amazon'}
    if key in _SKIP_VALIDATION:
        return key, True
    headers = {
        'User-Agent': _BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
    }
    try:
        r = http_requests.get(
            url, headers=headers, allow_redirects=True, timeout=4, stream=True
        )
        if r.status_code >= 400:
            return key, False

        chunks = []
        total = 0
        for chunk in r.iter_content(chunk_size=8192):
            chunks.append(chunk)
            total += len(chunk)
            if total >= _READ_LIMIT:
                break
        r.close()

        body = b''.join(chunks).lower()
        for pattern in _NO_RESULTS_PATTERNS:
            if pattern in body:
                return key, False

        return key, True
    except Exception:
        return key, False


def validate_shopping_links(links):
    """Return a filtered dict of links that both respond successfully and show results.

    All links are checked concurrently. A link is dropped if it times out,
    returns a 4xx/5xx status, raises a network error, or its response body
    contains a recognised "no results" indicator.
    """
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(links)) as ex:
        results = dict(ex.map(_check_url, links.items()))
    return {k: v for k, v in links.items() if results.get(k, False)}


BRAND_LIST = (
    'J.Crew, Banana Republic, Madewell, Uniqlo, H&M, Zara, Revolve, Free People, '
    'Club Monaco, Ralph Lauren, Gap, Levi\'s, Nike, Adidas, New Balance, Vans, '
    'Converse, Dr. Martens, Coach, Kate Spade, Everlane, COS, & Other Stories, '
    'Anthropologie, Urban Outfitters, Topshop, Ted Baker, ASOS, Nordstrom'
)

ANALYSIS_PROMPT_SINGLE = f"""Analyze this outfit and provide fashion suggestions. Return ONLY valid JSON with this exact structure:
{{
  "outfit_description": "Brief description of what you see in the outfit",
  "style": "Overall style label (e.g. casual, smart-casual, streetwear, formal, bohemian)",
  "color_palette": "Description of the color palette being used",
  "gender": "male or female or unknown — inferred from the person's apparent gender presentation",
  "suggestions": [
    {{
      "item": "Specific item name including a real brand (e.g. 'J.Crew Slim-Fit Chino Pant' or 'Banana Republic Heritage Oxford Shirt')",
      "description": "1-2 sentences on why this complements the outfit",
      "search_term": "Exact search term to find this product online",
      "estimated_price_low": 30,
      "estimated_price_high": 90,
      "category": "one of: tops / bottoms / shoes / accessories / outerwear / bags"
    }}
  ]
}}

Provide exactly 10 suggestions that would upgrade or complement this outfit. All suggestions must be appropriate for the identified gender. Name real brands such as: {BRAND_LIST}. Cover a range of categories. Return ONLY the JSON object, no markdown, no explanation."""

ANALYSIS_PROMPT_MULTI = f"""You are given multiple photos. Identify the ONE person who appears consistently across ALL of the photos (they may be wearing different outfits). Analyze their overall personal style.

Return ONLY valid JSON with this exact structure:
{{
  "person_description": "Brief description of how you identified the same person across photos (physical features, etc.)",
  "outfit_description": "Summary of the outfits/styles observed across the photos",
  "style": "Overall style label that captures their aesthetic (e.g. casual, smart-casual, streetwear, formal, bohemian)",
  "color_palette": "Dominant color palette seen across their outfits",
  "gender": "male or female or unknown — inferred from the person's apparent gender presentation across the photos",
  "suggestions": [
    {{
      "item": "Specific item name including a real brand (e.g. 'J.Crew Slim-Fit Chino Pant' or 'Banana Republic Heritage Oxford Shirt')",
      "description": "1-2 sentences on why this suits their personal style based on all photos",
      "search_term": "Exact search term to find this product online",
      "estimated_price_low": 30,
      "estimated_price_high": 90,
      "category": "one of: tops / bottoms / shoes / accessories / outerwear / bags"
    }}
  ]
}}

Provide exactly 10 suggestions tailored to the person's consistent style across all photos. All suggestions must be appropriate for the identified gender. Name real brands such as: {BRAND_LIST}. Cover a range of categories. Return ONLY the JSON object, no markdown, no explanation."""


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/analyze', methods=['POST'])
def analyze_outfit():
    files = request.files.getlist('images')
    files = [f for f in files if f and f.filename]

    if not files:
        return jsonify({'error': 'No image provided'}), 400

    invalid = [f.filename for f in files if not allowed_file(f.filename)]
    if invalid:
        return jsonify({
            'error': f'Unsupported file type: {", ".join(invalid)}. Allowed: JPG, PNG, GIF, WebP, HEIC.'
        }), 400

    request_api_key = request.form.get('api_key', '').strip()
    active_client = anthropic.Anthropic(api_key=request_api_key) if request_api_key else client
    if not request_api_key and not _env_api_key:
        return jsonify({
            'error': 'No API key configured. Add your Anthropic API key via the settings (⚙) button.'
        }), 401

    try:
        image_contents = []
        for f in files:
            b64, media_type = prepare_image(f)
            image_contents.append({
                'type': 'image',
                'source': {
                    'type': 'base64',
                    'media_type': media_type,
                    'data': b64,
                },
            })
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    prompt_text = ANALYSIS_PROMPT_MULTI if len(files) > 1 else ANALYSIS_PROMPT_SINGLE
    image_contents.append({'type': 'text', 'text': prompt_text})

    request_api_key = request.form.get('api_key', '').strip()
    active_client = anthropic.Anthropic(api_key=request_api_key) if request_api_key else client
    if not request_api_key and not _env_api_key:
        return jsonify({'error': 'No API key configured. Add your Anthropic API key via the settings (⚙) button.'}), 401

    try:
        response = active_client.messages.create(
            model='claude-opus-4-6',
            max_tokens=4096,
            messages=[{'role': 'user', 'content': image_contents}],
        )
    except anthropic.APIError as e:
        return jsonify({'error': f'API error: {str(e)}'}), 502

    raw = response.content[0].text.strip()

    # Strip optional markdown code fences
    if raw.startswith('```'):
        raw = raw.split('\n', 1)[-1]
        if raw.endswith('```'):
            raw = raw[: raw.rfind('```')]

    try:
        start = raw.find('{')
        end = raw.rfind('}') + 1
        data = json.loads(raw[start:end])
    except (json.JSONDecodeError, ValueError):
        return jsonify({'error': 'Could not parse suggestions from the model response.'}), 500

    gender      = data.get('gender', 'unknown')
    suggestions = data.get('suggestions', [])

    # Build all raw link dicts up front.
    all_raw_links = [
        build_shopping_links(
            s.get('search_term') or s.get('item', ''),
            gender,
            s.get('category', ''),
        )
        for s in suggestions
    ]

    # Flatten every (suggestion_index, retailer_key, url) triple into one list
    # and check them all in a single thread pool instead of 10 serial pools.
    # This turns O(n_suggestions * max_retailer_latency) into O(max_retailer_latency).
    flat = [
        (idx, key, url)
        for idx, links in enumerate(all_raw_links)
        for key, url in links.items()
    ]

    def _check_flat(triple):
        idx, key, url = triple
        _, has_results = _check_url((key, url))
        return idx, key, has_results

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(flat))) as ex:
        flat_results = list(ex.map(_check_flat, flat))

    validated = [{} for _ in suggestions]
    for idx, key, has_results in flat_results:
        if has_results:
            validated[idx][key] = all_raw_links[idx][key]

    for suggestion, links in zip(suggestions, validated):
        suggestion['links'] = links

    return jsonify(data)


@app.route('/roast', methods=['POST'])
def roast_outfit():
    body = request.get_json(force=True) or {}

    request_api_key = body.get('api_key', '').strip()
    active_client = anthropic.Anthropic(api_key=request_api_key) if request_api_key else client
    if not request_api_key and not _env_api_key:
        return jsonify({'error': 'No API key configured. Add your Anthropic API key via the settings (⚙) button.'}), 401

    outfit_description = body.get('outfit_description', '')
    style              = body.get('style', '')
    color_palette      = body.get('color_palette', '')
    suggestions        = body.get('suggestions', [])
    items = ', '.join(s.get('item', '') for s in suggestions[:6] if s.get('item'))

    persona_key = body.get('personality', 'anna_wintour')
    persona_instructions = {
        'anna_wintour': (
            "You are roasting this person's fashion in the style of Anna Wintour: glacially "
            "composed, devastatingly precise, and utterly imperious. No exclamation marks, no "
            "warmth. Deliver each observation as cold fact from someone who has already "
            "decided. One raised eyebrow's worth of disdain per sentence — understated, "
            "final, and twice as lethal for it."
        ),
        'trevor_wallace': (
            "You are roasting this person's fashion in the style of Trevor Wallace: loud, "
            "hyper-enthusiastic character comedy. Play an exaggerated version of someone "
            "who takes fashion WAY too seriously — use hyperbole, rhetorical questions, "
            "and mock-disbelief. Think 'guy who just got into fashion' energy cranked to 11."
        ),
        'chris_rock': (
            "You are roasting this person's fashion in the style of Chris Rock: rapid-fire, "
            "incredulous, building to an absurd punchline. Short declarative sentences. "
            "Lean into the 'I love fashion, but...' tension. Loud energy on the page."
        ),
        'trevor_noah': (
            "You are roasting this person's fashion in the style of Trevor Noah: charming and "
            "measured on the surface, devastating underneath. Build observations with witty "
            "analogies and cross-cultural comparisons before landing the punchline. "
            "Sound delightful even while being ruthless."
        ),
        'james_joyce': (
            "You are roasting this person's fashion in the dense literary style of James Joyce. "
            "Write in stream-of-consciousness with run-on clauses, unexpected word coinages, "
            "classical allusions, and interior monologue. Think Ulysses crashing a fashion week. "
            "Flowery, labyrinthine, and utterly savage."
        ),
    }.get(persona_key, '')

    prompt = f"""{persona_instructions}

Roast the outfit described below in 3-4 sentences. Be specific, reference the actual details, and deliver the roast directly — no preamble, no "here's your roast".

Outfit: {outfit_description}
Style: {style}
Color palette: {color_palette}
Items they apparently need: {items}"""

    try:
        response = active_client.messages.create(
            model='claude-opus-4-6',
            max_tokens=512,
            messages=[{'role': 'user', 'content': prompt}],
        )
        return jsonify({'roast': response.content[0].text.strip()})
    except anthropic.APIError as e:
        return jsonify({'error': f'API error: {str(e)}'}), 502


if __name__ == '__main__':
    app.run(debug=True, port=5000)
