# RESEARCH

## OpenAI realtime transcription — 2026-08-27
- Hold-to-talk = committed-turn Realtime transcription, model `gpt-transcribe` (high-accuracy). `gpt-live-transcribe` is low-latency live captions, not best WER. `gpt-4o-transcribe` / `whisper-1` are not the current recommended starting models. Docs: https://developers.openai.com/api/docs/guides/transcription https://developers.openai.com/api/docs/guides/realtime-transcription#transcribe-a-committed-turn https://developers.openai.com/api/docs/models/gpt-transcribe https://developers.openai.com/cookbook/examples/migrating_from_whisper_to_gpt_transcribe
- Model card lists `v1/realtime/transcription_sessions` (legacy mint; example still `gpt-4o-transcribe` + `server_vad`). Current mint: `POST /v1/realtime/client_secrets` `session.type=transcription`. Same WS — switching the mint URL does not make `gpt-transcribe` caption while you speak. Cookbook: transcription per committed chunk, not continuous live captioning; deltas only after `input_audio_buffer.commit` (may rewrite within that chunk). Sentence revision as context grows = later turns using earlier completed turns, or post-commit streaming — not live rewrite of the uncommitted buffer.
- Mint `ek_` via `POST /v1/realtime/client_secrets`; WS `wss://api.openai.com/v1/realtime?intent=transcription` subprotocols `realtime` + `openai-insecure-api-key.<ek_>` (browser WS cannot set Auth headers)
- PCM 24kHz 16-bit mono LE, base64 in `input_audio_buffer.append`; `languages: ["de","en"]` (not `language`); `turn_detection: null`; do not send `delay`. Hold-to-talk: one buffer, one commit on release (flush remainder → `input_audio_buffer.commit` → wait `.completed`). Periodic preview commits fragment sentences (each chunk ends with `.`/`,` and earlier chunks never rewrite). Overlay has no transcript box; hide on release, paste after `.completed`.
- Dedicated transcription sessions billed by audio duration (`gpt-transcribe` $0.0045/min vs `gpt-live-transcribe` $0.017/min). https://developers.openai.com/api/docs/pricing#transcription-and-speech https://developers.openai.com/api/docs/guides/realtime-costs — `append` each PCM once; `commit` finalizes that buffer only (does not resend).
- Beta Realtime interface removed 2026-05-12; do not send `openai-beta`

## tauri-plugin-global-shortcut 2.3.2 — 2026-08-27
- Handler `ShortcutEvent.state` is `Pressed` | `Released` (hold-to-talk). Docs: https://v2.tauri.app/plugin/global-shortcut/ https://v2.tauri.app/reference/javascript/global-shortcut/
- Capabilities: `global-shortcut:allow-is-registered`, `allow-register`, `allow-unregister`. Register consumes the key (unlike passthrough Copy observer)

## macOS Accessibility for paste — 2026-08-27
- Cmd+V via `CGEvent` + `kCGHIDEventTap` needs Accessibility (post events), not Input Monitoring
- Accessory policy hides TCC dialogs; prompt on main thread after `Regular` + `NSApplication.activate`
- Tahoe Settings URL: `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility` (https://github.com/paralevel/macos-settings-urls)
