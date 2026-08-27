use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;

#[derive(Default)]
pub struct PreviousApp(Mutex<Option<FrontmostTarget>>);

#[derive(Clone, Copy)]
enum FrontmostTarget {
    #[cfg(target_os = "macos")]
    MacosPid(i32),
    #[cfg(target_os = "windows")]
    WindowsHwnd(isize),
}

#[tauri::command]
pub fn remember_frontmost_app(state: tauri::State<'_, PreviousApp>) {
    *state.0.lock().unwrap() = current_frontmost();
}

#[tauri::command]
pub fn restore_frontmost_app(app: AppHandle, state: tauri::State<'_, PreviousApp>) {
    let target = *state.0.lock().unwrap();
    restore_target(&app, target);
}

#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility")
            .status()
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn paste_into_frontmost(app: AppHandle, state: tauri::State<'_, PreviousApp>) -> Result<(), String> {
    let target = *state.0.lock().unwrap();
    tauri::async_runtime::spawn_blocking(move || paste_into_frontmost_sync(&app, target))
        .await
        .map_err(|error| error.to_string())?
}

fn paste_into_frontmost_sync(app: &AppHandle, target: Option<FrontmostTarget>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::ensure_accessibility(app)?;
    }

    restore_target(app, target);
    std::thread::sleep(Duration::from_millis(80));
    post_paste()
}

fn current_frontmost() -> Option<FrontmostTarget> {
    #[cfg(target_os = "macos")]
    {
        return macos::frontmost_pid().map(FrontmostTarget::MacosPid);
    }

    #[cfg(target_os = "windows")]
    {
        return windows_front::foreground_hwnd().map(FrontmostTarget::WindowsHwnd);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

fn restore_target(app: &AppHandle, target: Option<FrontmostTarget>) {
    match target {
        #[cfg(target_os = "macos")]
        Some(FrontmostTarget::MacosPid(pid)) => {
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            let _ = app.run_on_main_thread(move || {
                macos::activate_pid(pid);
                let _ = tx.send(());
            });
            let _ = rx.recv();
        }
        #[cfg(target_os = "windows")]
        Some(FrontmostTarget::WindowsHwnd(hwnd)) => {
            windows_front::set_foreground(hwnd);
        }
        _ => {}
    }
}

fn post_paste() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return macos::post_paste();
    }

    #[cfg(target_os = "windows")]
    {
        return windows_front::post_paste();
    }

    #[cfg(target_os = "linux")]
    {
        return linux_front::post_paste();
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Paste into the frontmost app is not supported on this platform".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::{CFString, CFStringRef};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
    use objc2_core_graphics::{CGEvent, CGEventFlags, CGEventTapLocation};
    use std::sync::mpsc;
    use tauri::ActivationPolicy;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    const KEY_V: u16 = 9;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(
            options: core_foundation::dictionary::CFDictionaryRef,
        ) -> bool;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    struct RestoreAccessory(AppHandle);

    impl Drop for RestoreAccessory {
        fn drop(&mut self) {
            let _ = self.0.set_activation_policy(ActivationPolicy::Accessory);
        }
    }

    pub fn frontmost_pid() -> Option<i32> {
        let workspace = NSWorkspace::sharedWorkspace();
        let app = workspace.frontmostApplication()?;
        Some(app.processIdentifier() as i32)
    }

    pub fn activate_pid(pid: i32) {
        if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
            app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
        }
    }

    pub fn ensure_accessibility(app: &AppHandle) -> Result<(), String> {
        if is_trusted() {
            return Ok(());
        }

        let _restore = RestoreAccessory(app.clone());
        let _ = app.set_activation_policy(ActivationPolicy::Regular);
        run_on_main(app, || {
            if let Some(mtm) = MainThreadMarker::new() {
                NSApplication::sharedApplication(mtm).activate();
            }
        });

        let open_settings = app
            .dialog()
            .message(
                "pasteAI needs Accessibility to paste dictated text at the cursor.\n\nOpen System Settings, enable pasteAI, then try dictation again.",
            )
            .title("pasteAI")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Open System Settings".into(),
                "Later".into(),
            ))
            .blocking_show();

        if open_settings {
            run_on_main(app, || {
                if let Some(mtm) = MainThreadMarker::new() {
                    NSApplication::sharedApplication(mtm).activate();
                }
                let _ = prompt_accessibility();
            });
            let _ = super::open_accessibility_settings();
        }

        if is_trusted() {
            Ok(())
        } else {
            Err("Accessibility access is required to paste at the cursor".into())
        }
    }

    pub fn post_paste() -> Result<(), String> {
        let key_down = CGEvent::new_keyboard_event(None, KEY_V, true)
            .ok_or_else(|| "Could not create paste key down".to_string())?;
        CGEvent::set_flags(Some(&key_down), CGEventFlags::MaskCommand);
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&key_down));

        let key_up = CGEvent::new_keyboard_event(None, KEY_V, false)
            .ok_or_else(|| "Could not create paste key up".to_string())?;
        CGEvent::set_flags(Some(&key_up), CGEventFlags::MaskCommand);
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&key_up));
        Ok(())
    }

    fn is_trusted() -> bool {
        unsafe {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let dict = CFDictionary::<CFString, CFBoolean>::from_CFType_pairs(&[(
                key,
                CFBoolean::false_value(),
            )]);
            AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef())
        }
    }

    fn prompt_accessibility() -> bool {
        unsafe {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let dict = CFDictionary::<CFString, CFBoolean>::from_CFType_pairs(&[(
                key,
                CFBoolean::true_value(),
            )]);
            AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef())
        }
    }

    fn run_on_main(app: &AppHandle, work: impl FnOnce() + Send + 'static) {
        let (tx, rx) = mpsc::sync_channel(1);
        let _ = app.run_on_main_thread(move || {
            work();
            let _ = tx.send(());
        });
        let _ = rx.recv();
    }
}

#[cfg(target_os = "windows")]
mod windows_front {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_CONTROL,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

    const VK_V: VIRTUAL_KEY = VIRTUAL_KEY(0x56);

    pub fn foreground_hwnd() -> Option<isize> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            None
        } else {
            Some(hwnd.0 as isize)
        }
    }

    pub fn set_foreground(hwnd: isize) {
        let handle = HWND(hwnd as *mut core::ffi::c_void);
        let _ = unsafe { SetForegroundWindow(handle) };
    }

    pub fn post_paste() -> Result<(), String> {
        let inputs = [
            key_input(VK_CONTROL, false),
            key_input(VK_V, false),
            key_input(VK_V, true),
            key_input(VK_CONTROL, true),
        ];
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize == inputs.len() {
            Ok(())
        } else {
            Err("Could not send paste keystroke".into())
        }
    }

    fn key_input(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
}

#[cfg(target_os = "linux")]
mod linux_front {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    pub fn post_paste() -> Result<(), String> {
        let mut enigo = Enigo::new(&Settings::default()).map_err(|error| error.to_string())?;
        enigo
            .key(Key::Control, Direction::Press)
            .map_err(|error| error.to_string())?;
        enigo
            .key(Key::Unicode('v'), Direction::Click)
            .map_err(|error| error.to_string())?;
        enigo
            .key(Key::Control, Direction::Release)
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}
