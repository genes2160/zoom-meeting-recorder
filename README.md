# 📘 Zoom Recorder — README

*A Chrome Extension for Automatic Recording + Transcription*

---

## 🧩 Problem

Zoom does **not** provide:

* Automatic meeting recording
* Automatic caption extraction
* Combined mic + system audio recording
* Local JSON transcript export
* Local meeting recovery if the page reloads
* Hidden caption mode so the UI stays clean
* Auto-start recording when you join

As a result, users must manually record, manually save captions, and manually manage files — often missing content or losing conversations when Meet reloads.

---

## 🚀 Solution

This Chrome extension automates the **entire workflow**:

1. Detects when you join a meeting
2. Prompts you to choose Audio Only or Video + Audio mode
3. Starts full recording with mixed mic + system audio
4. Enables captions and continuously **hides** them from the UI
5. Collects speaker → text caption blocks live via two parallel systems
6. Safely persists transcripts to `localStorage`
7. Recovers the meeting transcript after reload
8. Exports everything (recording + transcript) at the end
9. Downloads final `.json` and `.webm` files automatically

Everything works **inside the browser**, securely and privately.

---

## ⭐ Features

### 🎛 1. Mode Selection Modal

On joining a meeting, a modal appears asking you to choose:

* **🎙 Audio Only** — records mic only as `.webm` audio, no screen capture required
* **🎥 Video + Audio** — records screen + mixed mic and system audio as `.webm` video

The modal re-appears if you try to start a new recording after stopping.

---

### 🎥 2. Video + Audio Recording

* Records the entire meeting using **getDisplayMedia**
* Mixes **system audio + microphone audio** via a Web Audio API graph
* Detects if mic is already included in system audio to avoid duplication
* Saves the full meeting as `.webm` video
* Streams chunks to background script every 5 seconds via `CHUNK_READY` messages

---

### 🎙 3. Audio Only Recording

* Records microphone only — no screen capture prompt
* Routes mic through a gain node → AudioContext destination stream
* Saves as `.webm` audio file on stop
* Supports pause/resume — all chunks assembled into a single file on stop
* Cleans up mic tracks and AudioContext automatically after download

---

### 🎚 4. Live Audio Controls (during recording)

A floating panel provides real-time controls:

* **🎙 Mic toggle** — mutes/unmutes mic gain node (0 ↔ 1.0) without stopping recording
* **🔊 System toggle** — mutes/unmutes system audio gain node (video mode only)
* Both buttons are **disabled until recording starts** to prevent errors
* System toggle is not applicable in Audio Only mode (`sysGainNode = null`)

---

### 📊 5. Mic Level Visualizer

* Live animated bar showing microphone input volume
* Powered by `AnalyserNode` + `requestAnimationFrame` loop
* Computes RMS (root mean square) of the audio waveform
* Runs on a separate AudioContext from the recording chain
* Resets and stops cleanly when recording ends

---

### ⏱ 6. Recording Timer + Status

The panel header shows:

* **Blinking red dot** — visible only while actively recording
* **Live timer** — counts up from `00:00`, freezes on pause, resumes on resume
* **Status label** — `⚪ Idle` / `🟢 Ready` / `🔴 Recording...` / `⏸ Paused`

---

### ⏸ 7. Pause / Resume Recording

* Pause freezes the timer and stops chunk collection without ending the session
* Resume continues from exactly where the timer left off
* All chunks collected before and after pause are merged into one file on stop
* The Pause button label switches between `⏸ Pause` / `▶️ Resume` / `▶️ Start` contextually

---

### 🖱 8. Draggable Recorder Panel

* The floating recorder UI panel can be dragged anywhere on screen
* Drag handle is the panel header
* Position is free after first drag (detaches from bottom anchor)

---

### ⌨️ 9. Keyboard Shortcut

* **Shift + R** — starts Video + Audio recording and caption detector instantly
* Works at any point while in a meeting
* Shows a notification if recording is already running or not in a meeting

---

### 🧏 10. Automated Captions Collection (Caption Detector)

* Turns ON Zoom captions automatically
* Continuously hides Zoom's caption panel every 300ms:

```js
setInterval(() => {
  document.querySelectorAll('.vNKgIf, .nMcdL, .ygicle, .DtJ7e, .iOzk7')
    .forEach(el => el.style.display = 'none');
}, 300);
```

* Scrapes `speaker → text` blocks every second from `.nMcdL` DOM nodes
* Stores transcript array in memory
* Exports clean JSON when `detector.stop()` is called

---

### 🗣 11. Speech Recognition Transcript (Parallel System)

A second transcription pipeline runs independently via the Web Speech API:

* `continuous = true`, `interimResults = true`
* Shows live interim text in a floating transcript overlay (bottom-right)
* Final results saved with `{ text, timestamp, confidence, speaker }` per entry
* Detects current speaker from DOM speaking indicators
* Persists every entry to `localStorage` immediately after capture
* Sends `TRANSCRIPT_UPDATE` messages to the background script

**Reconnect logic:**

* On `network` error → exponential backoff retry (`2^n` seconds, up to 5 attempts)
* On `no-speech` → restarts after 1 second
* On `aborted` → silently returns, no retry
* After max attempts → shows warning notification, stops retrying
* Counter resets to 0 on each successful `onstart`

---

### 📡 12. Automatic Meeting Detection

Detects meeting state via MutationObserver + 5-second polling:

* Checks for mic/camera controls, participant panel, Leave button
* Checks URL path for room ID
* Detects "Join Now" button to avoid false positives in the lobby
* Triggers `startMeeting()` automatically on entry
* Triggers `endMeeting()` automatically on exit or page unload

---

### 👥 13. Attendee Tracking

Every 5 seconds:

* Queries participant grid tiles, people panel, data attributes
* Extracts names via text content, `aria-label`, `data-name`, `title`
* Validates names (length 2–100, contains letters, not "You" or UI keywords)
* Stores unique names in a `Set`
* Persists attendee list to `localStorage` on every update

---

### 📝 14. Realtime Transcript + localStorage Recovery

* Every transcript entry is saved to `localStorage` immediately
* Key is derived from the meeting URL via `btoa(cleanUrl)`
* On rejoin: loads existing transcript, attendees, and start time automatically
* Shows notification: `"Restored N previous transcript entries"`
* On manual leave: exports and clears localStorage
* On unexpected unload: saves for recovery next session

---

### 🛑 15. One-Click Stop + Auto Export

On clicking Stop or leaving the meeting:

* Recording stops and file downloads automatically
* Caption detector stops and its JSON downloads
* Speech recognition aborts cleanly
* Transcript JSON exports with full metadata
* localStorage cleared on manual leave
* Recorder panel removed from DOM

---

### 🔔 16. Notification System

Colour-coded toast notifications (top-right, 4 second auto-dismiss):

* 🟢 `success` — recording started, meeting joined, export complete
* 🔵 `info` — mode selection, restore notice
* 🟠 `warning` — network issues, empty transcript
* 🔴 `error` — recording failed, speech recognition unavailable

---

## 🧱 Architecture

### **content.js**

Runs inside Meet, drives:

* Meeting detection and lifecycle
* Mode selection modal
* Floating recorder UI panel
* Audio-only and video+audio recording
* Web Audio API mixing and gain control
* Mic visualizer
* Pause/resume/timer logic
* Caption detector (DOM scraping)
* Speech recognition transcript pipeline
* Attendee tracking
* localStorage persistence and recovery
* Export logic (recording + JSON)

### **background.js**

Handles:

* Tab capture permissions
* Chunk streaming via `CHUNK_READY` messages
* Messaging between popup + content script

### **popup.html**

User UI for start/stop triggers (sends `START_CAPTURE` / `STOP_CAPTURE` messages to content script).

### **manifest.json**

Declares:

* Permissions (`tabCapture`, `activeTab`, `scripting`)
* Host access (Zoom only)
* Background service worker
* Content scripts

---

## 💾 Output Files

After each meeting you get:

### 🎥 Video Recording (Video mode)

```
meet-recording-<title>-<timestamp>.webm
```

### 🎙 Audio Recording (Audio Only mode)

```
meet-audio-<timestamp>.webm
```

### 📝 Caption Detector Transcript

```
meet_transcript_<timestamp>.json
```

### 📝 Speech Recognition Transcript

```
meet-transcript-<title>-<timestamp>.json
```

The speech recognition JSON includes:

```json
{
  "metadata": {
    "meetingUrl": "...",
    "startTime": "...",
    "endTime": "...",
    "duration": 123000,
    "attendees": ["John Doe", "Jane Smith"],
    "attendeeCount": 2,
    "version": "1.0"
  },
  "transcripts": [
    {
      "id": 1,
      "text": "Hello everyone...",
      "timestamp": 173000000,
      "relativeTime": 4200,
      "speaker": "John Doe",
      "confidence": 0.91,
      "isFinal": true,
      "wordCount": 2
    }
  ],
  "summary": {
    "totalWords": 800,
    "averageConfidence": 0.87,
    "fullText": "...",
    "speakerStats": {
      "John Doe": {
        "wordCount": 420,
        "transcriptCount": 12,
        "averageConfidence": 0.89
      }
    }
  }
}
```

---

## 🔐 Privacy

All processing happens **locally**:

* No cloud calls
* No external APIs
* No data sent anywhere
* Everything saved on your machine

---

## 📌 Final Notes

This extension is built for:

* Researchers
* Students
* Meeting-heavy teams
* Anyone who wants offline recordings + clean transcripts
* Anyone who wants Meet automation without Chrome DevTools open

Use responsibly and respect privacy laws when recording meetings.