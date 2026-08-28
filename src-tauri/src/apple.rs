use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioInputDevice {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeechLanguage {
    pub code: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechLanguageCatalog {
    pub languages: Vec<SpeechLanguage>,
    pub max_active_languages: i32,
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
pub async fn apple_dictation_start(
    app: AppHandle,
    languages: Vec<String>,
    device_uid: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let language = languages.join(",");
        let device_uid = device_uid.unwrap_or_default();
        return blocking(move || macos::dictation_start(app, &language, &device_uid)).await?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, languages, device_uid);
        Err("Only available on Mac.".to_string())
    }
}

#[tauri::command]
pub async fn apple_list_input_devices() -> Result<Vec<AudioInputDevice>, String> {
    #[cfg(target_os = "macos")]
    {
        return blocking(macos::list_input_devices).await?;
    }

    #[cfg(not(target_os = "macos"))]
    Ok(Vec::new())
}

#[tauri::command]
pub async fn apple_list_speech_languages() -> Result<SpeechLanguageCatalog, String> {
    #[cfg(target_os = "macos")]
    {
        return blocking(macos::list_speech_languages).await?;
    }

    #[cfg(not(target_os = "macos"))]
    Ok(fallback_speech_catalog())
}

#[tauri::command]
pub async fn apple_install_speech_language(code: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return blocking(move || macos::install_speech_language(&code)).await?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = code;
        Err("Only available on Mac.".to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn fallback_speech_catalog() -> SpeechLanguageCatalog {
    const CODES: &[(&str, &str)] = &[
        ("ar", "Arabic"),
        ("da", "Danish"),
        ("de", "German"),
        ("en", "English"),
        ("es", "Spanish"),
        ("fi", "Finnish"),
        ("fr", "French"),
        ("he", "Hebrew"),
        ("it", "Italian"),
        ("ja", "Japanese"),
        ("ko", "Korean"),
        ("ms", "Malay"),
        ("nb", "Norwegian Bokmål"),
        ("nl", "Dutch"),
        ("pt", "Portuguese"),
        ("ru", "Russian"),
        ("sv", "Swedish"),
        ("th", "Thai"),
        ("tr", "Turkish"),
        ("vi", "Vietnamese"),
        ("yue", "Cantonese"),
        ("zh", "Chinese"),
    ];
    SpeechLanguageCatalog {
        languages: CODES
            .iter()
            .map(|(code, label)| SpeechLanguage {
                code: (*code).to_string(),
                label: (*label).to_string(),
            })
            .collect(),
        max_active_languages: 2,
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
    use super::{AppleAvailability, AppleDictateLevel, AudioInputDevice};
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
            language: *const c_char,
            device_uid: *const c_char,
            out_error: *mut *mut c_char,
        ) -> c_int;
        fn pasteai_apple_list_input_devices(
            out_json: *mut *mut c_char,
            out_error: *mut *mut c_char,
        ) -> c_int;
        fn pasteai_apple_list_speech_languages(
            out_json: *mut *mut c_char,
            out_error: *mut *mut c_char,
        ) -> c_int;
        fn pasteai_apple_install_speech_language(
            code: *const c_char,
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

    pub fn dictation_start(app: AppHandle, language: &str, device_uid: &str) -> Result<(), String> {
        *LEVEL_APP.lock().unwrap() = Some(app);
        let language = CString::new(language).map_err(|error| error.to_string())?;
        let device_uid = CString::new(device_uid).map_err(|error| error.to_string())?;
        let mut out_error: *mut c_char = std::ptr::null_mut();
        let status = unsafe {
            pasteai_apple_dictation_start(
                Some(on_level),
                std::ptr::null_mut(),
                language.as_ptr(),
                device_uid.as_ptr(),
                &mut out_error,
            )
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

    pub fn list_speech_languages() -> Result<super::SpeechLanguageCatalog, String> {
        let mut out_json: *mut c_char = std::ptr::null_mut();
        let mut out_error: *mut c_char = std::ptr::null_mut();
        let status = unsafe { pasteai_apple_list_speech_languages(&mut out_json, &mut out_error) };
        let error = take_string(out_error);
        let json = take_string(out_json);
        if status != 0 {
            return Err(if error.is_empty() {
                "Could not list speech languages".to_string()
            } else {
                error
            });
        }

        serde_json::from_str(&json).map_err(|error| error.to_string())
    }

    pub fn install_speech_language(code: &str) -> Result<(), String> {
        let code = CString::new(code).map_err(|error| error.to_string())?;
        let mut out_error: *mut c_char = std::ptr::null_mut();
        let status = unsafe { pasteai_apple_install_speech_language(code.as_ptr(), &mut out_error) };
        let error = take_string(out_error);
        if status == 0 {
            Ok(())
        } else {
            Err(if error.is_empty() {
                "Could not install speech language".to_string()
            } else {
                error
            })
        }
    }

    pub fn list_input_devices() -> Result<Vec<AudioInputDevice>, String> {
        let mut out_json: *mut c_char = std::ptr::null_mut();
        let mut out_error: *mut c_char = std::ptr::null_mut();
        let status = unsafe { pasteai_apple_list_input_devices(&mut out_json, &mut out_error) };
        let error = take_string(out_error);
        let json = take_string(out_json);
        if status != 0 {
            return Err(if error.is_empty() {
                "Could not list microphones".to_string()
            } else {
                error
            });
        }

        serde_json::from_str(&json).map_err(|error| error.to_string())
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
