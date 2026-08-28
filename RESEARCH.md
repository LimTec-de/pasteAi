# RESEARCH

## OpenAI realtime transcription — 2026-08-27
- Hold-to-talk = committed-turn Realtime transcription, model `gpt-transcribe` (high-accuracy). `gpt-live-transcribe` is low-latency live captions, not best WER. `gpt-4o-transcribe` / `whisper-1` are not the current recommended starting models. Docs: https://developers.openai.com/api/docs/guides/transcription https://developers.openai.com/api/docs/guides/realtime-transcription#transcribe-a-committed-turn https://developers.openai.com/api/docs/models/gpt-transcribe https://developers.openai.com/cookbook/examples/migrating_from_whisper_to_gpt_transcribe
- Model card lists `v1/realtime/transcription_sessions` (legacy mint; example still `gpt-4o-transcribe` + `server_vad`). Current mint: `POST /v1/realtime/client_secrets` `session.type=transcription`. Same WS — switching the mint URL does not make `gpt-transcribe` caption while you speak. Cookbook: transcription per committed chunk, not continuous live captioning; deltas only after `input_audio_buffer.commit` (may rewrite within that chunk). Sentence revision as context grows = later turns using earlier completed turns, or post-commit streaming — not live rewrite of the uncommitted buffer.
- Mint `ek_` via `POST /v1/realtime/client_secrets`; WS `wss://api.openai.com/v1/realtime?intent=transcription` subprotocols `realtime` + `openai-insecure-api-key.<ek_>` (browser WS cannot set Auth headers)
- PCM 24kHz 16-bit mono LE, base64 in `input_audio_buffer.append`; `languages` ISO-639-1 array (not `language`); pasteAI sends active `dictateLanguages` (default `["de","en"]`). `keywords` = literal terms that may appear in the audio (`<` `>` CR/LF reject the whole session/update). Omit `keywords` when empty. `turn_detection: null`; do not send `delay`. Hold-to-talk: one buffer, one commit on release (flush remainder → `input_audio_buffer.commit` → wait `.completed`). Periodic preview commits fragment sentences (each chunk ends with `.`/`,` and earlier chunks never rewrite). Overlay has no transcript box; hide on release, paste after `.completed`.
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

## Apple Foundation Models (on-device LLM) — 2026-08-27
- Swift `FoundationModels`: `SystemLanguageModel.default` + `LanguageModelSession`; same ~3B Apple Intelligence model, Neural Engine, no API key, offline. macOS/iOS/iPadOS 26+, Apple Intelligence on, Apple silicon only (Intel Macs no). Check `availability` (`.available` / `.deviceNotEligible` / `.modelNotReady`). https://developer.apple.com/documentation/foundationmodels https://www.apple.com/newsroom/2025/09/apples-foundation-models-framework-unlocks-new-intelligent-app-experiences/
- Context 4096 tokens (instructions+prompt+output). Suited to rewrite/summarize/extract; not GPT-4-class reasoning. PCC `PrivateCloudComputeLanguageModel` = larger context/reasoning, still no OpenAI key, data to Apple PCC. German supported with Apple Intelligence langs (macOS 26.1+). English `Instructions` + other-language prompt may translate; `You MUST respond in X` turns rewrite into chat. pasteAI: saved prompt + `NLLanguageRecognizer` + `Locale(en).localizedString(forLanguageCode:)` (`de`→`German`) → `You MUST write the edited text in German.` Clipboard stays `respond(to:)`. https://developer.apple.com/documentation/naturallanguage/nllanguagerecognizer
- Tauri: Swift C-ABI object + `build.rs`. TBD `libswift_Concurrency` uses `$ld$previous$@rpath` for minOS 10.9–12.0 and 13.1–15.0. Rust default minos 11.0 → dyld `Library not loaded: @rpath/libswift_Concurrency.dylib`. Fix: `MACOSX_DEPLOYMENT_TARGET=13.0` (gap between those ranges) so install-name stays `/usr/lib/swift/libswift_Concurrency.dylib`; also `-Wl,-rpath,/usr/lib/swift`. https://github.com/Brendonovich/swift-rs/issues/69

## Apple SpeechAnalyzer — 2026-08-27
- macOS 26 Speech: `SpeechAnalyzer` (actor) + `SpeechTranscriber` (long-form) / `DictationTranscriber` (short utterances). `supportedLocale(equivalentTo:)` is async; `de`/`en` map to `de_DE`/`en_US`; other ISO-639-1 via equivalent locale — no region options in picker (`de_AT` collapses). Dedupe `supportedLocales` to `language.languageCode`. `AssetInventory.maximumReservedLocales` caps parallel reserved packs (often 2). `cancelAndFinishNow()` needs await. Finish live input with `inputBuilder.finish()` then `finalizeAndFinishThroughEndOfInput()` — finishing the stream alone does not end the session. `.transcription` finals often arrive only then; collect results after that await. `prepareToAnalyze(in:)` or first audio is dropped (kills hold-to-talk). Assets: `AssetInventory.status` `.unsupported|.downloading|.supported|.installed`; `assetInstallationRequest` nil iff `.installed`. `downloadAndInstall` returns on first attempt success/fail. Compare locales with `identifier(.bcp47)` (`en_US` vs `en-US`). Hold-to-talk paragraphs → SpeechTranscriber preset `.transcription`. Mic tap format must match hardware; convert to `bestAvailableAudioFormat` (`primeMethod.none`). https://developer.apple.com/documentation/speech/assetinventory https://developer.apple.com/documentation/speech/assetinventory/maximumreservedlocales https://developer.apple.com/documentation/speech/speechanalyzer
- Input-only `AVAudioEngine`: `AudioUnitSetProperty(inputNode.audioUnit, kAudioOutputUnitProperty_CurrentDevice, …)` with CoreAudio UID via `kAudioHardwarePropertyTranslateUIDToDevice`. Do not set `kAudioHardwarePropertyDefaultInputDevice` (system-wide). List inputs: `kAudioHardwarePropertyDevices` + `kAudioDevicePropertyStreamConfiguration` input scope. https://developer.apple.com/documentation/coreaudio/kaudiooutputunitproperty_currentdevice
- `SpeechTranscriber` has no custom vocabulary. `AnalysisContext.contextualStrings` is `DictationTranscriber` only (≤100 phrases). Do not switch transcriber for lexicon.

## STT dictionary (SuperWhisper / Wispr) — 2026-08-28
- SuperWhisper Vocabulary tab: words = STT hints; replacements = case-insensitive post-STT swap. Emails = replacements (`my work email` → address), not a command grammar. Docs: https://superwhisper.com/docs/get-started/interface-vocabulary
- OpenAI `gpt-transcribe` `keywords` = spoken terms only, not replacement output (don’t send emails). https://developers.openai.com/api/docs/guides/transcription#improve-transcription-quality
- Wispr auto-learn is desktop field-edit via Accessibility (before/selected/after cursor); undo toast, no confirm. Copy-diff is the clipboard analogue. https://docs.wisprflow.ai/articles/4052411709-teach-flow-your-words-with-the-dictionary https://docs.wisprflow.ai/articles/4678293671-feature-context-awareness

## Windows on-device LanguageModel (Phi Silica → Aion Instruct) — 2026-08-27
- WinAppSDK `Microsoft.Windows.AI.Text.LanguageModel` + skills `TextRewriter`/`TextSummarizer`. Copilot+ NPU preinstalled; GPU (RTX 30+/RX 9060+ 6GB, Dev Mode, Insider exp) on-demand GB download via `EnsureReadyAsync`. No CPU. Not China. Phi Silica is LAF (unlock token); Aion Instruct rolls Insiders Oct 2026 / retail Nov 2026, no LAF, then Phi Silica removed. Packaged MSIX + `systemAIModels`. https://learn.microsoft.com/en-us/windows/ai/apis/phi-silica https://learn.microsoft.com/en-us/windows/ai/apis/

## Windows AI SpeechRecognition — 2026-08-27
- `Microsoft.Windows.AI.Speech.SpeechRecognitionModel`: batch + streaming. NPU preinstalled on Copilot+; CPU on other Win11 24H2+ (on-demand download, no GPU). Streaming via `StreamingRecognition`. MSIX `systemAIModels`. https://learn.microsoft.com/en-us/windows/ai/apis/speech-recognition
