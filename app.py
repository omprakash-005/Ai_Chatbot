"""
Multilingual Voice + Text + Image AI Chatbot powered by Google Gemini
======================================================================
Features
--------
1. Text & voice chat (voice capture/playback happens in the browser via
   the Web Speech API; this backend handles the "brains" - talking to Gemini).
2. Image analysis - upload/attach an image and ask Gemini questions about it.
3. Image generation - ask Gemini to generate an image from a text prompt.
4. Multi-language support: English, Hindi (हिन्दी), Odia (ଓଡ଼ିଆ).
   The user picks a language in the UI; Gemini is instructed to always
   reply in that language, and the browser's speech recognition /
   speech synthesis is switched to the matching locale.

Setup
-----
1. pip install -r requirements.txt
2. Get a Gemini API key: https://aistudio.google.com/apikey
3. Set it as an environment variable:
       export GEMINI_API_KEY="your_api_key_here"      (Linux/Mac)
       setx GEMINI_API_KEY "your_api_key_here"         (Windows)
   OR create a .env file (see .env.example) - this app auto-loads it.
4. Run:  python app.py
5. Open: http://127.0.0.1:5000
"""

import os
import io
import base64
import traceback

from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
load_dotenv()  # loads GEMINI_API_KEY from a local .env file if present

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("WARNING: GEMINI_API_KEY is not set. Set it in your environment or .env file.")

client = genai.Client(api_key=API_KEY)

# Text / vision chat model
CHAT_MODEL = "gemini-2.5-flash"
# Image generation model (Gemini's native image-out model)
IMAGE_GEN_MODEL = "gemini-2.5-flash-image"

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Language handling
# ---------------------------------------------------------------------------
# Maps the language code the frontend sends -> (human name, speech locale)
LANGUAGES = {
    "en": {"name": "English", "speech_locale": "en-IN"},
    "hi": {"name": "Hindi (हिन्दी)", "speech_locale": "hi-IN"},
    "or": {"name": "Odia (ଓଡ଼ିଆ)", "speech_locale": "or-IN"},
}


def language_instruction(lang_code: str) -> str:
    """Builds a system instruction that forces Gemini to reply in the chosen language."""
    lang = LANGUAGES.get(lang_code, LANGUAGES["en"])
    return (
        f"You are a warm, helpful multilingual voice assistant. "
        f"Always reply ONLY in {lang['name']}, written in its native script "
        f"(Devanagari for Hindi, Odia script for Odia). "
        f"Keep answers reasonably short and conversational since they will "
        f"often be read aloud by a text-to-speech engine. "
        f"If the user writes in a different language, still reply in {lang['name']} "
        f"unless they explicitly ask you to switch languages."
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html", languages=LANGUAGES)


@app.route("/api/chat", methods=["POST"])
def chat():
    """
    Plain text/voice-transcribed chat.
    Expects JSON: { "message": str, "language": "en"|"hi"|"or", "history": [ {role, text}, ... ] }
    """
    try:
        data = request.get_json(force=True)
        message = (data.get("message") or "").strip()
        lang_code = data.get("language", "en")
        history = data.get("history", [])  # list of {role: "user"|"model", text: str}

        if not message:
            return jsonify({"error": "Empty message"}), 400

        # Rebuild conversation for Gemini's chat history format
        gemini_history = []
        for turn in history:
            role = "user" if turn.get("role") == "user" else "model"
            gemini_history.append(
                types.Content(role=role, parts=[types.Part.from_text(text=turn.get("text", ""))])
            )

        chat_session = client.chats.create(
            model=CHAT_MODEL,
            history=gemini_history,
            config=types.GenerateContentConfig(
                system_instruction=language_instruction(lang_code),
            ),
        )

        response = chat_session.send_message(message)
        reply_text = response.text or ""

        return jsonify({"reply": reply_text})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/analyze-image", methods=["POST"])
def analyze_image():
    """
    Image analysis. Expects multipart/form-data:
      - image: the file
      - question: text prompt about the image (optional)
      - language: en | hi | or
    """
    try:
        if "image" not in request.files:
            return jsonify({"error": "No image uploaded"}), 400

        image_file = request.files["image"]
        question = (request.form.get("question") or "Describe this image in detail.").strip()
        lang_code = request.form.get("language", "en")

        image_bytes = image_file.read()
        mime_type = image_file.mimetype or "image/jpeg"

        response = client.models.generate_content(
            model=CHAT_MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                        types.Part.from_text(text=question),
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                system_instruction=language_instruction(lang_code),
            ),
        )

        return jsonify({"reply": response.text or ""})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/generate-image", methods=["POST"])
def generate_image():
    """
    Image generation. Expects JSON: { "prompt": str, "language": "en"|"hi"|"or" }
    Returns a base64-encoded PNG the frontend can render directly.
    """
    try:
        data = request.get_json(force=True)
        prompt = (data.get("prompt") or "").strip()
        lang_code = data.get("language", "en")

        if not prompt:
            return jsonify({"error": "Empty prompt"}), 400

        response = client.models.generate_content(
            model=IMAGE_GEN_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )

        image_b64 = None
        caption_text = ""

        for part in response.candidates[0].content.parts:
            if getattr(part, "text", None):
                caption_text += part.text
            elif getattr(part, "inline_data", None) is not None:
                image_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")

        if not image_b64:
            return jsonify({"error": "Model did not return an image. Try rephrasing the prompt."}), 502

        # Optional: translate/caption in the requested language via a quick follow-up
        if lang_code != "en" and not caption_text:
            cap_resp = client.models.generate_content(
                model=CHAT_MODEL,
                contents=f"Write one short caption (in {LANGUAGES[lang_code]['name']}) for an image generated from this prompt: {prompt}",
            )
            caption_text = cap_resp.text or ""

        return jsonify({"image_base64": image_b64, "caption": caption_text})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
