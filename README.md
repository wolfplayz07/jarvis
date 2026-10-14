# Jarvis Phone

A free, installable web app for iPhone that greets you like Jarvis when you clap twice.

Tap **Start**, clap twice, and the phone plays an arc-reactor HUD, says
"Good evening, sir. Welcome home." in the best British voice it has, and shows
one-tap buttons for your apps (Spotify, YouTube, Chrome, Safari, or anything with a link).

- Plain HTML, CSS and JavaScript. No build step, no dependencies.
- Works offline once installed (service worker).
- No accounts, no API keys, no analytics, no tracking. Audio never leaves the phone.
- Free forever. MIT licensed.

**Live:** https://wolfplayz07.github.io/jarvis-phone/

## Install on iPhone (iOS 17+)

1. Open the live link in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open **Jarvis** from the Home Screen, tap **Start** and allow the microphone.
4. Clap twice. Adjust **Sensitivity** if it misses claps or reacts to other sounds.

## Features

- **Double-clap detection**: two sharp sound peaks 150–600 ms apart. The threshold adapts to
  room noise; the slider sets how sensitive it is. A live level meter shows the threshold line.
- **Greeting**: time-of-day greeting with an editable template (`{greeting}, sir. Welcome home.`),
  voice picker, rate, pitch and a Test Voice button. It prefers a British male voice
  (Daniel, then Arthur, then Oliver, then any en-GB voice, then the default).
- **Quick launch**: editable list of app links saved on the phone. iOS only opens apps on a tap,
  so every launch is one tap.
- **iOS Shortcut**: a button that runs a Shortcut (default name `Jarvis`) so one tap can open
  several apps. Step-by-step help is inside the app.
- **"Hey Jarvis"** (optional): uses the browser's speech recognition when available, otherwise
  the app stays clap-only.

## Limits on iPhone

- The mic only runs while the app is open on screen. Locking the phone or switching apps pauses it.
- Apps open on a tap, never automatically.
- Speech recognition support in Safari varies; clapping always works.

## Development

```
node --test tests/                 # clap detector unit tests
python3 -m http.server 8000        # then open http://localhost:8000/
python3 tests/browser_check.py     # headless Chromium check (needs playwright)
```

`clap.js` is a pure function module: feed it `(level, timeMs)` frames and it reports claps and
double claps, so it is tested in node without a browser. `test/double-clap.wav` is a synthetic
double clap used to drive the real microphone path in headless Chromium.

## Credit

Inspired by the idea of clap-to-start "Jarvis" desktop scripts, such as
https://github.com/hectorg2211/jarvis. No code was copied; this app was written from scratch for the phone.

## Voice wake ("Jarvis" / "Hey Jarvis")
On by default after Start (toggle in the "Jarvis" voice wake panel). Uses Safari's built-in speech recognition (`webkitSpeechRecognition`, continuous + interim results), matched by `wake.js` (`matchWake`), with a 3 s debounce. It auto-restarts with backoff on `end`/`no-speech`/`aborted`/`network`, stops on `not-allowed`/`service-not-allowed`, pauses while Jarvis is speaking and while the app is hidden. Only works while the app is open on screen. If the phone won't run voice wake and clap detection together, voice wake takes priority and clapping stays the fallback whenever speech recognition is unavailable.
