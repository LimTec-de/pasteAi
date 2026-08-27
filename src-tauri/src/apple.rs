use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleAvailability {
    pub available: bool,
    pub reason_code: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct AppleDictateLevel {
    pub level: f32,
}

#[cfg(not(target_os = "macos"))]
fn not_mac() -> AppleAvailability {
    AppleAvailability {
        available: false,
        reason_code: "notMac".to_string(),
        message: "Only available on Mac.".to_string(),
    }
}

#[tauri::command]
pub async fn apple_text_availability() -> AppleAvailability {
    #[cfg(target_os = "macos")]
    {
        return blocking(macos::text_availability)
            .await
            .unwrap_or_else(join_error);
    }

    #[cfg(not(target_os = "macos"))]
    not_mac()
}

#[tauri::command]
pub async fn apple_speech_availability() -> AppleAvailability {
    #[cfg(target_os = "macos")]
    {
        return blocking(macos::speech_availability)
            .await
            .unwrap_or_else(join_error);
    }

    #[cfg(not(target_os = "macos"))]
    not_mac()
}

#[tauri::command]
pub async fn apple_improve(system_prompt: String, text: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        return blocking(move || macos::improve(&system_prompt, &text)).await?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (system_prompt, text);
        Err("Only available on Mac.".to_string())
    }
}

#[tauri::command]
pub async fn apple_dictation_start(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return blocking(move || macos::dictation_start(app)).await?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Only available on Mac.".to_string())
    }
}

#[tauri::command]
pub async fn apple_dictation_stop() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        return blocking(macos::dictation_stop).await?;
    }

    #[cfg(not(target_os = "macos"))]
    Err("Only available on Mac.".to_string())
}

#[tauri::command]
pub async fn apple_dictation_cancel() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        blocking(macos::dictation_cancel).await?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    Ok(())
}

#[cfg(target_os = "macos")]
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn join_error(error: String) -> AppleAvailability {
    AppleAvailability {
        available: false,
        reason_code: "error".to_string(),
        message: error,
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{AppleAvailability, AppleDictateLevel};
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_float, c_int, c_void};
    use tauri::{AppHandle, Emitter};

    extern "C" {
        fn pasteai_apple_string_free(ptr: *mut c_char);
        fn pasteai_apple_text_availability(
            out_available: *mut c_int,
            out_reason: *mut *mut c_char,
            out_message: *mut *mut c_char,
        );
        fn pasteai_apple_speech_availability(
            out_available: *mut c_int,
            out_reason: *mut *mut c_char,
            out_message: *mut *mut c_char,
        );
        fn pasteai_apple_improve(
            system_prompt: *const c_char,
            text: *const c_char,
            out_text: *mut *mut c_char,
            out_error: *mut *mut c_char,
        ) -> c_int;
        fn pasteai_apple_dictation_start(
            level_cb: Option<unsafe extern "C" fn(c_float, *mut c_void)>,
            ctx: *mut c_void,
            out_error: *mut *mut c_char,
        ) -> c_int;
        fn pasteai_apple_dictation_stop(
            out_text: *mut *mut c_char,
            out_error: *mut *mut c_char,
        ) -> c_int;
        fn pasteai_apple_dictation_cancel();
    }

    pub fn text_availability() -> AppleAvailability {
        read_availability(|available, reason, message| unsafe {
            pasteai_apple_text_availability(available, reason, message);
        })
    }

    pub fn speech_availability() -> AppleAvailability {
        read_availability(|available, reason, message| unsafe {
            pasteai_apple_speech_availability(available, reason, message);
        })
    }

    pub fn improve(system_prompt: &str, text: &str) -> Result<String, String> {
        let system = CString::new(system_prompt).map_err(|error| error.to_string())?;
        let prompt = CString::new(text).map_err(|error| error.to_string())?;
        let mut out_text: *mut c_char = std::ptr::null_mut();
        let mut out_error: *mut c_char = std::ptr::null_mut();
        let status = unsafe {
            pasteai_apple_improve(system.as_ptr(), prompt.as_ptr(), &mut out_text, &mut out_error)
        };
        let error = take_string(out_error);
        let result = take_string(out_text);
        if status == 0 {
            Ok(result)
        } else {
            Err(if error.is_empty() {
                "Apple Intelligence request failed".to_string()
            } else {
                error
            })
        }
    }

    pub fn dictation_start(app: AppHandle) -> Result<(), String> {
        *LEVEL_APP.lock().unwrap() = Some(app);
        let mut out_error: *mut c_char = std::ptr::null_mut();
        let status = unsafe {
            pasteai_apple_dictation_start(Some(on_level), std::ptr::null_mut(), &mut out_error)
        };
        let error = take_string(out_error);
        if status == 0 {
            Ok(())
        } else {
            Err(if error.is_empty() {
                "Could not start on-device dictation".to_string()
            } else {
                error
            })
        }
    }

    pub fn dictation_stop() -> Result<String, String> {
        let mut out_text: *mut c_char = std::ptr::null_mut();
        let mut out_error: *mut c_char = std::ptr::null_mut();
        let status = unsafe { pasteai_apple_dictation_stop(&mut out_text, &mut out_error) };
        let error = take_string(out_error);
        let result = take_string(out_text);
        if status == 0 {
            Ok(result)
        } else {
            Err(if error.is_empty() {
                "Could not finish on-device dictation".to_string()
            } else {
                error
            })
        }
    }

    pub fn dictation_cancel() {
        unsafe { pasteai_apple_dictation_cancel() };
        *LEVEL_APP.lock().unwrap() = None;
    }

    fn read_availability(
        call: impl FnOnce(*mut c_int, *mut *mut c_char, *mut *mut c_char),
    ) -> AppleAvailability {
        let mut available: c_int = 0;
        let mut reason: *mut c_char = std::ptr::null_mut();
        let mut message: *mut c_char = std::ptr::null_mut();
        call(&mut available, &mut reason, &mut message);
        AppleAvailability {
            available: available != 0,
            reason_code: take_string(reason),
            message: take_string(message),
        }
    }

    fn take_string(ptr: *mut c_char) -> String {
        if ptr.is_null() {
            return String::new();
        }

        let value = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { pasteai_apple_string_free(ptr) };
        value
    }

    static LEVEL_APP: std::sync::Mutex<Option<AppHandle>> = std::sync::Mutex::new(None);

    unsafe extern "C" fn on_level(level: c_float, _ctx: *mut c_void) {
        if let Ok(guard) = LEVEL_APP.lock() {
            if let Some(app) = guard.as_ref() {
                let _ = app.emit(
                    "apple-dictate-level",
                    AppleDictateLevel {
                        level: level.clamp(0.0, 1.0),
                    },
                );
            }
        }
    }
}
