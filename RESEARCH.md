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

## TypeScript 7 vs svelte-check — 2026-08-27
- npm `latest` = 7.0.2; no stable programmatic API. svelte-check 4.7.6 peers `typescript ^5 || ^6`; crashes on 7 (`typescript.default.sys` undefined). Last 6.x = 6.0.3. `--tsgo` needs both 6+7. Stay on ^6.0.3. https://github.com/sveltejs/language-tools/issues/3063 https://www.npmjs.com/package/svelte-check

## openai 7 — 2026-08-27
- 7.0.0 breaking: Node.js 22+ only (20 EOL). `chat.completions.create` + `dangerouslyAllowBrowser` unchanged through 7.7.0. CI node 24 OK. https://github.com/openai/openai-node/releases/tag/v7.0.0

## pnpm 12 vs 11 — 2026-08-27
- 12.0.0 stable 2026-08-26 (Rust rewrite) but npm `latest` still 11.24.0; install via `next-12`. Stay on 11.24.0. https://pnpm.io/installation https://pnpm.io/blog/whats-different-in-pnpm-12

## GitHub Actions runners — 2026-08-27
- `ubuntu-22.04` deprecation 2026-09-17, unsupported 2027-04-17. `ubuntu-latest`=`ubuntu-24.04`; `ubuntu-26.04` public preview only. `macos-latest`=`macos-26`; `windows-latest`=`windows-2025`. https://github.com/actions/runner-images/issues/14254 https://github.com/actions/runner-images/issues/14226 https://github.com/actions/runner-images

## tauri-action v1 — 2026-08-27
- Latest `action-v1.0.0`. Drops Tauri v1. `includeUpdaterJson`→`uploadUpdaterJson`; drop `includeDebug` (`args: --debug`). `.app.tar.gz` names include version. Official pipeline example still shows `ubuntu-22.04`. https://github.com/tauri-apps/tauri-action/releases/tag/action-v1.0.0 https://v2.tauri.app/distribute/pipelines/github/

## pnpm/setup v2 — 2026-08-27
- Successor to `pnpm/action-setup` for pnpm 11+. Replaces `actions/setup-node` via `runtime: node@24`. Reads `packageManager`. pnpm 11 has no darwin-x64 binary (ARM `macos-latest` OK). https://github.com/pnpm/setup
