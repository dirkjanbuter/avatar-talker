# Avatar Talker (v1.0.0)

**Avatar Talker** is a WebGL-powered 3D talking avatar **WordPress plugin** driven entirely by x.ai. It listens to user voice input, processes conversations through Grok, and speaks back with real-time, procedurally generated lip-syncing.

Built with **Three.js** on the frontend and secured with a **PHP server-side proxy**, it ensures your x.ai API keys remain 100% safe from the browser environment.

---

## ✨ Features

* 🔌 **WordPress Native:** Easy shortcode deployment and a clean backend admin settings page.
* 🤖 **Grok-Powered Intellect:** Persistent conversation history, custom models, and fully configurable system prompts.
* 🎙️ **Voice-to-Voice Loop:** Hold-to-speak voice input (via x.ai STT) $\rightarrow$ Grok processing $\rightarrow$ Voice output (via x.ai TTS).
* 👄 **Real-Time Lip-Sync:** Web Audio API decodes audio on the fly. Amplitude (RMS) + text-to-phoneme estimation dynamically drive **15 ARKit viseme morph targets** (e.g., `jawOpen`, `mouthOpen`, `viseme_aa`, `viseme_PP`). No external phoneme mapping service required!
* 🌐 **Immersive 3D Rendering:** Renders any standard `avatar.glb` file in WebGL via Three.js with natural lifelike behaviors (auto-blink, idle breathing, micro-eye movements).
* 🔒 **Secure PHP Proxy:** ALL x.ai API requests are routed through a server-side proxy. Your API key is never exposed to the client.
* 💬 **Hybrid Input:** Full text-chat fallback for users who prefer typing over speaking.
* 🛠️ **Robust Admin Panel:** Easily manage keys, models, voices, language settings, custom system prompts, and conversation memory depth.

---

## 🚀 Shortcode Usage

Deploy the avatar anywhere on your WordPress site using simple shortcodes:

```wordpress
[avatar_talker]
[avatar_talker height="700px"]

```

---

## 🛠️ WordPress Admin Setup

1. Install and activate the plugin in your WordPress dashboard.
2. Navigate to **Avatar Talker** $\rightarrow$ **Settings**.
3. Enter your x.ai API key (generated via [console.x.ai](https://console.x.ai)).
4. Define your custom **System Prompt** (use the `{name}` placeholder to dynamically insert the avatar's name).
5. Select your preferred Grok model, voice profile, and language.
6. Save changes and paste the `[avatar_talker]` shortcode onto any page, post, or widget area.

---

## 💡 System Prompt Examples

Tailor your avatar's personality with targeted system instructions:

> 🛒 **Product Assistant**
> "You are {name}, a friendly product expert for AcmeCorp. Help users find the right product. Keep answers to 2-3 sentences. Be warm and professional."

> 🇳🇱 **Language Tutor**
> "You are {name}, a Dutch language tutor. Respond in both Dutch and English. Correct mistakes gently and give short lessons."

> 🎯 **Personal Coach**
> "You are {name}, a motivational life coach. Ask one question at a time. Be empathetic, brief, and action-oriented."

---

## 🧬 Technical Deep Dive

### x.ai API Endpoints Used

* `POST https://api.x.ai/v1/stt` — Speech-to-Text transcription
* `POST https://api.x.ai/v1/chat/completions` — Grok AI chat orchestration
* `POST https://api.x.ai/v1/tts` — Text-to-Speech audio generation

### Viseme Lip-Sync Mapping

The frontend utilizes the Web Audio API's `AnalyserNode` to sample playback.

* **Volume/Presence:** Amplitude (RMS) directly manipulates the `jawOpen` and `mouthOpen` morphs.
* **Phonemes:** A lightweight, client-side text-to-phoneme character map sequences the 15 supported ARKit visemes in perfect tandem with the audio:
`viseme_aa`, `viseme_E`, `viseme_I`, `viseme_O`, `viseme_U`, `viseme_PP`, `viseme_FF`, `viseme_SS`, `viseme_CH`, `viseme_DD`, `viseme_kk`, `viseme_nn`, `viseme_RR`, `viseme_TH`, `sil`.

---

## 📄 License & Asset Attribution

### Codebase

This software is licensed under **The Unlicense** — meaning the source code is completely dedicated to the public domain. You can copy, modify, publish, use, compile, sell, or distribute this code in any form, for any purpose, commercial or non-commercial, without restriction.

### 3D Avatar Model

The default `avatar.glb` included with this plugin was generated via **Avaturn**.

* **License:** Free for non-commercial personal use.
* **Commercial Use:** If you intend to use this plugin for commercial purposes, you must acquire a commercial license from [Avaturn.me](https://www.google.com/search?q=https%3A%2F%2Favaturn.me), or swap out the default file with your own custom, commercially-licensed `.glb` asset.
