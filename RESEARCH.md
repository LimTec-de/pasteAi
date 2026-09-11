# RESEARCH

## OpenAI realtime transcription — 2026-08-27
- Hold-to-talk = committed-turn Realtime transcription, model `gpt-transcribe`. `gpt-live-transcribe` is live captions (worse WER). Mint: `POST /v1/realtime/client_secrets` `session.type=transcription`. WS `wss://api.openai.com/v1/realtime?intent=transcription` subprotocols `realtime` + `openai-insecure-api-key.<ek_>` (browser WS cannot set Auth headers). Docs: https://developers.openai.com/api/docs/guides/realtime-transcription#transcribe-a-committed-turn
- Switching the mint URL does not make `gpt-transcribe` caption while you speak. Deltas only after `input_audio_buffer.commit`. Do not send `openai-beta` (removed 2026-05-12).
- PCM 24kHz 16-bit mono LE. `languages` is ISO-639-1 array (not `language`). `keywords` = spoken terms only; `<` `>` CR/LF reject the session; omit when empty. `turn_detection: null`; do not send `delay`. One buffer, one commit on release.

## tauri-plugin-global-shortcut 2.3.2 — 2026-08-27
- `ShortcutEvent.state` is `Pressed` | `Released`. Register consumes the key. `CommandOrControl` → macOS `Modifiers::SUPER` (⌘), not ⌃. https://v2.tauri.app/plugin/global-shortcut/

## macOS Accessibility for paste — 2026-08-27
- Cmd+V via `CGEvent` + `kCGHIDEventTap` needs Accessibility, not Input Monitoring. Accessory policy hides TCC dialogs; prompt on main thread after `Regular` + `NSApplication.activate`. Tahoe: `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility`

## TypeScript 7 vs svelte-check — 2026-08-27
- svelte-check 4.7.6 crashes on TypeScript 7 (`typescript.default.sys` undefined). Stay on `^6.0.3`. https://github.com/sveltejs/language-tools/issues/3063

## pnpm 12 vs 11 — 2026-08-27
- pnpm 12 is stable but npm `latest` is still 11. Stay on 11.24.0. https://pnpm.io/installation

## Apple Foundation Models — 2026-08-27
- `SystemLanguageModel.default` + `LanguageModelSession`. First `respond` loads the model; `prewarm()` is the documented way to hide that. Context 4096. English `Instructions` + other-language prompt may translate; pasteAI uses `You MUST write the edited text in <English name>.` https://developer.apple.com/documentation/foundationmodels
- Tauri Swift C-ABI: Rust default minos 11.0 → dyld `Library not loaded: @rpath/libswift_Concurrency.dylib`. Fix `MACOSX_DEPLOYMENT_TARGET=13.0` + `-Wl,-rpath,/usr/lib/swift`. https://github.com/Brendonovich/swift-rs/issues/69

## Apple SpeechAnalyzer — 2026-08-27
- Finish live input with `inputBuilder.finish()` then `finalizeAndFinishThroughEndOfInput()` — finishing the stream alone does not end the session. Collect `.transcription` after that await. `prepareToAnalyze(in:)` or first audio is dropped. `supportedLocale(equivalentTo:)` maps `de`/`en` → `de_DE`/`en_US`. `SpeechTranscriber` has no custom vocabulary. https://developer.apple.com/documentation/speech/speechanalyzer
- Input-only `AVAudioEngine`: set `kAudioOutputUnitProperty_CurrentDevice` from CoreAudio UID. Do not set `kAudioHardwarePropertyDefaultInputDevice`.

## OpenAI STT dictionary — 2026-08-28
- `keywords` = spoken terms, not replacement output (don’t send emails). `prompt` = recording context, not a restatement of the task. https://developers.openai.com/api/docs/guides/transcription#improve-transcription-quality

## sherpa-onnx + Parakeet TDT v3 — 2026-08-28
- Crate 1.13.6 still links Static. Windows archive is `/MT`; llama-cpp-2 is `/MD` → `LNK2038`. Override with official `*-static-MD-Release-lib` via `SHERPA_ONNX_LIB_DIR`. https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.6
- Model: `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`. 16 kHz. `provider=Some("cpu")`. Leftover `.tar.bz2` = extract unfinished. Truncated encoder → uncaught `Ort::Exception`.

## llama-cpp-2 + Qwen3-4B GGUF — 2026-08-30
- 0.1.154 `features = ["common"]`. Default `n_gpu_layers=-1`; if `!supports_gpu_offload()` use `with_n_gpu_layers(0)`. `LlamaBackend::void_logs()` or every `new_context` dumps Metal INFO. Context not thread-safe → `spawn_blocking` + Mutex. `AddBos::Never`. https://docs.rs/llama-cpp-2/0.1.154/llama_cpp_2/
- File `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` 2497281120 bytes SHA256 `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`.

## OpenAI rewrite models — 2026-09-01
- `gpt-5.6-luna` default `reasoning.effort=medium`; for short rewrite set `reasoning_effort: "none"` or first token is much slower. https://developers.openai.com/api/docs/models/gpt-5.6-luna

## Focus restore other apps — 2026-09-02
- Linux X11: EWMH `_NET_ACTIVE_WINDOW` ClientMessage (`source=1`), then `ConnectionExt::sync()`. Do not `XSetInputFocus`. Wayland: skip remember when `WAYLAND_DISPLAY` set and `DISPLAY` unset.
- Windows: `AttachThreadInput` then `SetForegroundWindow`. `windows` 0.62: `AttachThreadInput` is `Win32::System::Threading`.
- macOS 14+: `NSApplicationActivateIgnoringOtherApps` is a no-op; still call `NSApp.activate` plus `NSRunningApplication.activateWithOptions`. Accessory policy stays.
