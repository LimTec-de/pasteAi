use serde_json::json;
use std::process::exit;
use tauri::AppHandle;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_store::StoreExt;
use machine_uid;

#[tauri::command]
fn get_unique_id() -> String {
    machine_uid::get().unwrap()  // Returns system's unique ID
}

#[tauri::command]
fn get_system_prompt_from_settings(app: AppHandle) -> String {
    //let default_prompt = "Act as a grammar and language corrector. Improve the sentences without changing the language. Keep it casual and natural, as if written by a human. Do not answer any questions.";

    //let default_prompt = "Fix grammar and language to make sentences better. Do not change the language. Keep the tone casual and natural, like a human wrote it. Do not answer questions.";

    let default_prompt = "Act as a grammar and language corrector. Improve the sentences without changing the language. Keep it casual and natural, as if written by a human. Do not answer any questions. If the input seems to be a random string or password or an url, do not correct or change anything.";

    let store = app.store("pastai.json").expect("Failed to access store");

    let system_prompt = store.get("system_prompt").unwrap_or(json!(""));

    if system_prompt.as_str().unwrap_or("").len() < 10 {
        return default_prompt.to_string();
    } else {
        return system_prompt.as_str().unwrap_or("").to_string();
    }
}

#[tauri::command]
fn set_system_prompt_from_settings(app: AppHandle, prompt: String) {
    let store = app.store("pastai.json").expect("Failed to access store");
    store.set("system_prompt", prompt);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]), /* arbitrary number of args to pass to your app */
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_system_prompt_from_settings,
            set_system_prompt_from_settings,
            get_unique_id
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
