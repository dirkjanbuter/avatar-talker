=== Avatar Talker ===
Version: 1.0.0
License: The Unlicense

Talking 3D avatar powered by x.ai — speaks, listens, and lip-syncs in real-time.

== Features ==

* Realistic 3D avatar (avatar.glb) rendered in WebGL via Three.js
* Hold-to-speak voice input → x.ai Speech-to-Text transcription
* Grok AI response (your system prompt, your model, persistent conversation history)
* x.ai Text-to-Speech → MP3 → decoded in browser via Web Audio API
* Real-time lip-sync: amplitude + phoneme estimation drives 15 ARKit viseme morphs
  (jawOpen, mouthOpen, viseme_aa/E/I/O/U/PP/FF/SS/CH/DD/kk/nn/RR/TH/sil)
* Auto-blink, idle breathing, eye movement
* Text chat fallback (type instead of speaking)
* Conversation memory (configurable history depth)
* ALL x.ai API calls go through PHP server-side proxy — API key never sent to browser
* Admin panel: API key, model, voice, language, system prompt, avatar name, history length

== Shortcode ==

  [avatar_talker]
  [avatar_talker height="700px"]

== Admin Setup ==

1. Go to Avatar Talker → Settings
2. Enter your x.ai API key (from console.x.ai)
3. Set your system prompt (use {name} for the avatar name)
4. Choose model, voice, language
5. Save and add [avatar_talker] to any page

== System Prompt Examples ==

Product assistant:
  You are {name}, a friendly product expert for AcmeCorp. Help users find the right product.
  Keep answers to 2-3 sentences. Be warm and professional.

Language tutor:
  You are {name}, a Dutch language tutor. Respond in both Dutch and English.
  Correct mistakes gently and give short lessons.

Personal coach:
  You are {name}, a motivational life coach. Ask one question at a time.
  Be empathetic, brief, and action-oriented.

== x.ai API Endpoints Used ==

* POST https://api.x.ai/v1/stt   (Speech to Text)
* POST https://api.x.ai/v1/chat/completions   (Grok chat)
* POST https://api.x.ai/v1/tts   (Text to Speech)

== Viseme Lip-Sync ==

Audio is decoded by the Web Audio API's AnalyserNode.
Amplitude (RMS) drives jawOpen + mouthOpen morphs in real-time.
A text-to-phoneme character map drives the 15 ARKit viseme morphs
(viseme_aa, viseme_E, viseme_I, viseme_O, viseme_U, viseme_PP, etc.)
in sync with the audio playback — no external phoneme service needed.
