# PROJECT

## Hold-to-dictate shortcut — 2026-08-27
- Dedicated global shortcut (`dictateShortcut`, default `CommandOrControl+Shift+Space`). Hold = listen, release = clipboard + paste. Short tap (<450ms) keeps overlay open (already recording) with Done → restore remembered app + paste. Both flows write the clipboard then Cmd/Ctrl+V. Second shortcut press also finishes (must run before `isBusy`, because dictation sets runState `dictating`). Overlay/settings/welcome mention insert and copy. Never register Copy/C. Do not preview-commit while holding.
- Overlay must not take focus (`showDictate` focus false + immediate `restore_frontmost_app`) or `Released` from tauri-plugin-global-shortcut 2.3.2 is unreliable
- `frontmost.rs`: remember macOS pid / Windows HWND; `paste_into_frontmost` restores then Cmd/Ctrl+V. macOS AX prompt only when paste needs it
- Triple-empty-copy / `copy_observer.rs` removed. Dictation still uses stored `openaiApiKey` regardless of `llmType`
- Mic: `src-tauri/Info.plist` `NSMicrophoneUsageDescription` + `Entitlements.plist` `audio-input`/`microphone`
