mod apple;
mod frontmost;
mod local_llm;
mod local_stt;

use std::process::exit;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(frontmost::PreviousApp::default())
        .manage(local_stt::LocalSttState::default())
        .manage(local_llm::LocalLlmState::default())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]), /* arbitrary number of args to pass to your app */
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let store = app.store("pastai.json")?;
            Ok(())
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // Handle second instance here
            exit(0);
        }))
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("tauri_plugin_updater", log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            frontmost::remember_frontmost_app,
            frontmost::restore_frontmost_app,
            frontmost::paste_into_frontmost,
            frontmost::open_accessibility_settings,
            apple::apple_text_availability,
            apple::apple_speech_availability,
            apple::apple_improve,
            apple::apple_dictation_start,
            apple::apple_dictation_stop,
            apple::apple_dictation_cancel,
            apple::apple_list_input_devices,
            apple::apple_list_speech_languages,
            apple::apple_install_speech_language,
            local_stt::local_stt_status,
            local_stt::local_stt_install,
            local_stt::local_stt_preload,
            local_stt::local_stt_transcribe,
            local_llm::local_llm_status,
            local_llm::local_llm_install,
            local_llm::local_llm_preload,
            local_llm::local_llm_unload,
            local_llm::local_llm_improve
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
