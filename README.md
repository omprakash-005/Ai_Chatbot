# Gemini Multilingual Voice + Image Chatbot

A Flask web app that uses the Google Gemini API for:
- Text & voice chat (English, Hindi, Odia)
- Image analysis (ask questions about an uploaded photo)
- Image generation (text prompt → generated image)

Voice capture and playback happen in the browser (Web Speech API), so no
extra audio libraries are needed on the server.

## 1. Install dependencies

```bash
pip install -r requirements.txt
```

## 2. Add your Gemini API key

Get a key from https://aistudio.google.com/apikey, then either:

```bash
export GEMINI_API_KEY="your_api_key_here"
```

or copy `.env.example` to `.env` and fill it in:

```bash
cp .env.example .env
# then edit .env
```

## 3. Run the app

```bash
python app.py
```

Open **http://127.0.0.1:5000** in **Google Chrome** (best Web Speech API support).

## How to use

- **Chat tab**: type or tap 🎤 to speak. Toggle "Speak replies" to hear
  Gemini's answers read aloud.
- **Analyze Image tab**: upload a photo, optionally type/speak a question
  ("What's in this image?", "इसमें क्या लिखा है?"), click Analyze.
- **Generate Image tab**: describe an image in the box (or speak it),
  click Generate.
- Use the **Language** dropdown at the top to switch between English,
  Hindi, and Odia at any time — it affects both Gemini's replies and the
  browser's speech recognition/synthesis locale.

## Notes & limitations

- **Odia voice support** depends entirely on the user's browser/OS speech
  engine. Chrome desktop generally handles Odia *recognition* reasonably
  well; *text-to-speech* voices for Odia are less commonly installed, so
  playback may silently fall back to a default voice/language on some
  machines. Text chat and image analysis in Odia (script + text) work
  regardless, since that part runs entirely through Gemini.
- Model names (`gemini-2.5-flash`, `gemini-2.5-flash-image`) are set as
  constants near the top of `app.py` — update them if Google renames or
  deprecates a model.
- This is a development server (`app.run(debug=True)`). For production,
  run it behind a proper WSGI server (gunicorn/uwsgi) and disable debug
  mode.
- Never commit your real API key — keep it in `.env` (already used via
  `python-dotenv`) and add `.env` to `.gitignore`.

## Project structure

```
gemini-chatbot/
├── app.py               # Flask backend + Gemini API calls
├── requirements.txt
├── .env.example
├── templates/
│   └── index.html       # UI markup
└── static/
    ├── style.css
    └── app.js            # Speech recognition/synthesis + fetch calls
```
