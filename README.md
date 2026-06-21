# Understand

> Listen to any document in your own language.

**Understand** is a free, open-source Progressive Web App (PWA) that helps people who receive documents in a language that isn't their native tongue. Take a photo of the document, choose your language, and the app reads it to you aloud — translated into your language.

---

## Features

- 📷 **Take a photo** or upload an image of any document
- 🌐 **Supports 70+ languages** — searchable grid with flag icons
- 🔍 **OCR** — extracts text from the image using Tesseract.js (works fully in the browser)
- 🌍 **Translation** — translates text via MyMemory API (free, no API key needed)
- 🔊 **Audio** — reads the translated text aloud using the browser's built-in Text-to-Speech
- ⚡ **Speed control** — 0.6×, 0.8×, 1.0×, 1.2×, 1.5×
- 📋 **Copy translated text** to clipboard
- 📱 **PWA** — installable on iPhone/Android as a native-like app, works offline (app shell)
- 🆓 **100% free** — no accounts, no API keys, no data sent to any server except the translation API

---

## Getting started locally

### 1. Install Node.js

Download and install Node.js from https://nodejs.org (choose the LTS version).

### 2. Install dependencies

```bash
npm install
```

### 3. Run the dev server

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

---

## Deploy to GitHub Pages (free hosting)

### 1. Create a GitHub repository

1. Go to https://github.com and create a new **public** repository named `understand`
2. Push this code to the `main` branch:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/understand.git
git push -u origin main
```

### 2. Enable GitHub Pages

1. Go to your repository → **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**
3. The workflow at `.github/workflows/deploy.yml` will automatically build and deploy on every push to `main`

Your app will be live at: `https://YOUR_USERNAME.github.io/understand/`

---

## How it works

```
User uploads photo
        ↓
  Tesseract.js OCR          ← runs entirely in the browser
        ↓
  Text extracted
        ↓
  MyMemory Translation API  ← free public API, no key needed
        ↓
  Translated text
        ↓
  Web Speech API TTS        ← browser built-in, free
        ↓
  Audio played to user
```

---

## Tips for best OCR results

- Make sure the document is **flat** (no folds)
- **Good lighting** — avoid shadows
- Text must be **clearly visible** and not blurry
- Printed text works best; handwriting is not supported

---

## Tech stack

| Layer | Tool |
|---|---|
| Framework | React 18 + Vite |
| Styling | Tailwind CSS |
| OCR | Tesseract.js |
| Translation | MyMemory API (free) |
| Text-to-Speech | Web Speech API |
| PWA | vite-plugin-pwa |
| Hosting | GitHub Pages |

---

## License

MIT — free to use, modify, and deploy.
