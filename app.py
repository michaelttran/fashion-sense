import os
import base64
import json
from flask import Flask, render_template, request, jsonify
import anthropic
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max

client = anthropic.Anthropic(api_key=os.environ.get('ANTHROPIC_API_KEY'))

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MEDIA_TYPE_MAP = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_media_type(filename, fallback_content_type):
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    return MEDIA_TYPE_MAP.get(ext, fallback_content_type or 'image/jpeg')


def build_shopping_links(search_term):
    encoded_plus = search_term.replace(' ', '+')
    encoded_pct = search_term.replace(' ', '%20')
    return {
        'amazon': f'https://www.amazon.com/s?k={encoded_plus}',
        'asos': f'https://www.asos.com/search/?q={encoded_pct}',
        'nordstrom': f'https://www.nordstrom.com/sr?origin=keywordsearch&keyword={encoded_plus}',
        'zara': f'https://www.zara.com/us/en/search?searchTerm={encoded_pct}',
    }


ANALYSIS_PROMPT = """Analyze this outfit and provide fashion suggestions. Return ONLY valid JSON with this exact structure:
{
  "outfit_description": "Brief description of what you see in the outfit",
  "style": "Overall style label (e.g. casual, smart-casual, streetwear, formal, bohemian)",
  "color_palette": "Description of the color palette being used",
  "suggestions": [
    {
      "item": "Specific item name (e.g. 'Slim-fit chino trousers')",
      "description": "1-2 sentences on why this complements the outfit",
      "search_term": "Exact search term to find this product online",
      "estimated_price_low": 30,
      "estimated_price_high": 90,
      "category": "one of: tops / bottoms / shoes / accessories / outerwear / bags"
    }
  ]
}

Provide exactly 6 suggestions that would upgrade or complement this outfit. Be specific — name brands or style terms where helpful. Return ONLY the JSON object, no markdown, no explanation."""


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/analyze', methods=['POST'])
def analyze_outfit():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    file = request.files['image']
    if not file or file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Please upload a JPG, PNG, GIF, or WebP image.'}), 400

    image_data = file.read()
    image_b64 = base64.standard_b64encode(image_data).decode('utf-8')
    media_type = get_media_type(file.filename, file.content_type)

    try:
        response = client.messages.create(
            model='claude-opus-4-6',
            max_tokens=2048,
            messages=[
                {
                    'role': 'user',
                    'content': [
                        {
                            'type': 'image',
                            'source': {
                                'type': 'base64',
                                'media_type': media_type,
                                'data': image_b64,
                            },
                        },
                        {'type': 'text', 'text': ANALYSIS_PROMPT},
                    ],
                }
            ],
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
