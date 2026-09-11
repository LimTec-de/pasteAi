# PROJECT

## Hold-to-dictate
- Dedicated `dictateShortcut` (default `CommandOrControl+Shift+Space`). Hold=listen, release=clipboard+paste (`dictateOutputMode=insert`) or copy only. Tap <450ms latches overlay with Done. Insert writes clipboard then Cmd/Ctrl+V. Second press finishes (before `isBusy`). Never Cmd/Ctrl+key without Shift/Alt. macOS `CommandOrControl` is ⌘, not ⌃. No preview-commit while holding.
- Overlay must not take focus (`showDictate` focus false + immediate `restore_frontmost_app`) or `Released` from tauri-plugin-global-shortcut 2.3.2 is unreliable. Size 380×360.
- Overlay on press before engine ready. OpenAI mic buffers PCM until WS open. Missing key / Apple unavailable / Parakeet missing → `providers`. No silent fallback.
- `frontmost.rs`: remember macOS pid / Windows HWND / Linux X11 `_NET_ACTIVE_WINDOW`; paste restores then Cmd/Ctrl+V. macOS AX prompt only when paste needs it. Prompt picker: remember, `activate_this_app`, hide, restore. Windows AttachThreadInput. Wayland remember/restore no-op.

## Dictation settings
- `dictateLanguages` (active ISO-639-1, default de+en) + `dictateDownloadedLanguages` (superset). Legacy `dictateLanguage` `auto`→both; `de`/`en`→that code. Last active cannot turn off. Cap `AssetInventory.maximumReservedLocales`. Empty `dictateMicrophoneId`=default. Apple mic: CoreAudio UID on input-only `AVAudioEngine`, never HAL default input.

## Post-dictation prompt
- `dictatePromptId` null=raw, default builtin `dictate-cleanup`. Missing id at speak → that builtin in memory, no store write. Ignore prompt `outputMode`; still `dictateOutputMode`. Improve before clipboard write.

## OpenAI rewrite
- `llmType=openai`: `POST /v1/chat/completions` via `tauri-plugin-http` (same stack as PasteAI and the transcription mint). `gpt-5.6-luna` + `reasoning_effort=none`. Do not use the JS SDK / WKWebView `fetch` from hidden `main` — first request can stall many seconds. STT stays `gpt-transcribe`.

## Improve toast
- Retry after 4s. `STATUS_ACTION` cancel/retry; generation guard drops late LLM result. Clipboard cancel: original stays. Dictation cancel/error after STT: write raw+replacements then paste. Overlay cancel during listen writes nothing. Retry re-runs same prompt/input.

## Dictation dictionary
- Pipeline: STT (OpenAI keywords/prompt) → optional improve (suffix from vocab/rules, do not mutate stored `dictate-cleanup`) → `applyReplacements` → clipboard. Apple/Parakeet: replace + cleanup suffix only. Learn-from-copy: 5min arm; similar copy does not increment `copyCount`.

## Mac on-device AI
- `llmType=apple`: Swift C-ABI. Same stored prompt + `NLLanguageRecognizer` suffix `You MUST write the edited text in <English language name>.` No locale pin. Speech: no auto-install on probe; packs via Plus or start `ensureInstalled`. `de`→`de_DE`, `en`→`en_US`; picker is language codes. No silent OpenAI fallback. Finish: `finalizeAndFinishThroughEndOfInput` then read transcript. `MACOSX_DEPLOYMENT_TARGET`/`minimumSystemVersion` 13.0 or dyld misses `libswift_Concurrency`. Also `-Wl,-rpath,/usr/lib/swift`.

## Local Parakeet
- sherpa-onnx `OfflineRecognizer` `provider=cpu`. Not in installer. Windows crate `/MT` vs llama `/MD` → CI `scripts/windows-sherpa-md.ps1`. No silent fallback.

## Local rewrite
- Qwen3-4B-Instruct-2507 Q4_K_M via llama-cpp-2, `n_ctx=4096`. Keep loaded while `llmType=local`+installed (preload + `warmup`); unload on switch away. GPU offload when `supports_gpu_offload()`. `LlamaBackend::void_logs()`. File size must be `2497281120`. Missing → `"On-device rewrite model is not installed."` + dashboard `providers`. Migrate `ollama`→`local`. Default `llmType` stays `pasteai`. No auto-download.

## Prompt picker
- `askEveryTime` independent of `defaultPromptId`. Full list: click/arrows select only; Enter or Continue confirms (click must not submit). Always prewarm prompt window. Extra via `composeImprovePrompt`. Dictation / `pasteai:` prefix unchanged.

## Deps / CI
- `typescript` `^6.0.3`. `overrides.valibot: 1.4.2`. Windows crate `0.62`. CI: `pnpm/setup@v2` node 24, `tauri-action@v1` `uploadUpdaterJson`, Windows `LIBCLANG_PATH` + sherpa-md script.
