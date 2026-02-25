import os
import base64
import json
import io
from flask import Flask, render_template, request, jsonify
import anthropic
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


def build_shopping_links(search_term):
    encoded_plus = search_term.replace(' ', '+')
    encoded_pct = search_term.replace(' ', '%20')
    return {
        'amazon': f'https://www.amazon.com/s?k={encoded_plus}',
        'nordstrom': f'https://www.nordstrom.com/sr?origin=keywordsearch&keyword={encoded_plus}',
        'j_crew': f'https://www.jcrew.com/r/search?q={encoded_pct}',
        'banana_republic': f'https://bananarepublic.gap.com/browse/search.do?searchText={encoded_pct}',
        'madewell': f'https://www.madewell.com/search?q={encoded_pct}',
        'asos': f'https://www.asos.com/search/?q={encoded_pct}',
        'zara': f'https://www.zara.com/us/en/search?searchTerm={encoded_pct}',
        'hm': f'https://www2.hm.com/en_us/search-results.html?q={encoded_pct}',
        'uniqlo': f'https://www.uniqlo.com/us/en/search?q={encoded_pct}',
        'revolve': f'https://www.revolve.com/search/?q={encoded_pct}',
    }


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

Provide exactly 10 suggestions that would upgrade or complement this outfit. Name real brands such as: {BRAND_LIST}. Cover a range of categories. Return ONLY the JSON object, no markdown, no explanation."""

ANALYSIS_PROMPT_MULTI = f"""You are given multiple photos. Identify the ONE person who appears consistently across ALL of the photos (they may be wearing different outfits). Analyze their overall personal style.

Return ONLY valid JSON with this exact structure:
{{
  "person_description": "Brief description of how you identified the same person across photos (physical features, etc.)",
  "outfit_description": "Summary of the outfits/styles observed across the photos",
  "style": "Overall style label that captures their aesthetic (e.g. casual, smart-casual, streetwear, formal, bohemian)",
  "color_palette": "Dominant color palette seen across their outfits",
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

Provide exactly 10 suggestions tailored to the person's consistent style across all photos. Name real brands such as: {BRAND_LIST}. Cover a range of categories. Return ONLY the JSON object, no markdown, no explanation."""


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

    for suggestion in data.get('suggestions', []):
        term = suggestion.get('search_term') or suggestion.get('item', '')
        suggestion['links'] = build_shopping_links(term)

    return jsonify(data)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
