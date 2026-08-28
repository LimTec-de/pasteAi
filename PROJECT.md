# PROJECT

## Hold-to-dictate shortcut — 2026-08-27
- Dedicated global shortcut (`dictateShortcut`, default `CommandOrControl+Shift+Space`). Hold = listen, release = clipboard + paste (`dictateOutputMode=insert` default) or copy only (`clipboard`). Short tap (<450ms) keeps overlay open with Done. Both insert flows write clipboard then Cmd/Ctrl+V. Second shortcut press also finishes (must run before `isBusy`). Never register Copy/C. Do not preview-commit while holding.
- Overlay must not take focus (`showDictate` focus false + immediate `restore_frontmost_app`) or `Released` from tauri-plugin-global-shortcut 2.3.2 is unreliable
- `frontmost.rs`: remember macOS pid / Windows HWND; `paste_into_frontmost` restores then Cmd/Ctrl+V. macOS AX prompt only when paste needs it
- Triple-empty-copy / `copy_observer.rs` removed. Dictation uses `dictationProvider` (`openai` default, `apple` on-device SpeechAnalyzer). Rewrite `llmType` can be `apple` (Foundation Models). No silent fallback; unavailable options are disabled in Settings.
- Mic: `src-tauri/Info.plist` `NSMicrophoneUsageDescription` + `Entitlements.plist` `audio-input`/`microphone`

## Dictation settings tab — 2026-08-27
- Dashboard section `dictation` (tray `Dictate shortcut…`). Engine cards stay on `providers`. Keys: `dictateLanguage` `auto|de|en` (OpenAI auto=`["de","en"]`; Apple auto=de+en transcribers, prefer `preferredLanguages` then pick by confidence + `NLLanguageRecognizer`; `de`→`de_DE` `en`→`en_US`; no silent `en_US` fallback), `dictateMicrophoneId` empty=default (OpenAI Chromium `deviceId`, Apple CoreAudio UID + `kAudioOutputUnitProperty_CurrentDevice` on input-only `AVAudioEngine`, never HAL default input), `dictateOutputMode` `insert|clipboard`. Command `apple_list_input_devices`. Missing API key / Apple unavailable still open `providers`.

## Mac on-device AI — 2026-08-27
- Rewrite `llmType=apple`: Foundation Models via Swift C-ABI `src-tauri/macos/PasteAIApple.swift`. Same stored prompt as other providers + one suffix from clipboard `NLLanguageRecognizer`; English label via `Locale(en)` (`de`→`German`): `You MUST write the edited text in German.` No locale pin, no wrap. Dictation `dictationProvider=apple`: SpeechAnalyzer + SpeechTranscriber, native AVAudioEngine (overlay does not getUserMedia). Speech ready = `AssetInventory.status==.installed` or `installedLocales` BCP-47 or completed `downloadAndInstall` — not `assetInstallationRequest != nil`. Shared installer task (no `try?` fire-and-forget). Card selectable while assets download (`assetsNotReady`); dashboard polls 2s. Settings cards disabled with reason; no silent OpenAI fallback. `DictationSession.finish` reads transcript after `finalizeAndFinishThroughEndOfInput` + results stream. `prepareToAnalyze`; mic `inputFormat` after `prepare`. Converter `primeMethod.none`. Weak-link FoundationModels/Speech. `MACOSX_DEPLOYMENT_TARGET`/`minimumSystemVersion` 13.0 — Rust default 11.0 makes ld emit `@rpath/libswift_Concurrency.dylib` (TBD `$ld$previous`). Also `-Wl,-rpath,/usr/lib/swift`. Commands `allow-apple-system`. Plist `NSSpeechRecognitionUsageDescription`.

## Deps pins — 2026-08-27
- `typescript` held at `^6.0.3` (svelte-check). `pnpm-workspace.yaml` `overrides.valibot: 1.4.2`; `minimumReleaseAgeExclude: openai@7.7.0`. Windows crate `0.62` (`frontmost.rs` HWND/SendInput).

## CI publish workflow — 2026-08-27
- `.github/workflows/build.yml` runners: `macos-latest`, `ubuntu-latest`, `windows-latest`. `pnpm/setup@v2` (`runtime: node@24`, `packageManager` 11.24.0). `tauri-apps/tauri-action@v1` (`uploadUpdaterJson`). Linux glibc follows whatever `ubuntu-latest` is (currently 24.04).
