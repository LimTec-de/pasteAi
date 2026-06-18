use std::process::exit;
use std::sync::Mutex;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_store::StoreExt;

#[derive(Default)]
struct PreviousApp(Mutex<Option<i32>>);

#[cfg(target_os = "macos")]
fn macos_frontmost_pid() -> Option<i32> {
    use objc2_app_kit::NSWorkspace;

    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    Some(app.processIdentifier() as i32)
}

#[cfg(target_os = "macos")]
fn macos_activate_pid(pid: i32) {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};

    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
    }
}

#[tauri::command]
fn remember_frontmost_app(state: tauri::State<'_, PreviousApp>) {
    #[cfg(target_os = "macos")]
    {
        *state.0.lock().unwrap() = macos_frontmost_pid();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
    }
}

#[tauri::command]
fn restore_frontmost_app(app: tauri::AppHandle, state: tauri::State<'_, PreviousApp>) {
    #[cfg(target_os = "macos")]
    {
        let pid = *state.0.lock().unwrap();
        if let Some(pid) = pid {
            let _ = app.run_on_main_thread(move || macos_activate_pid(pid));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PreviousApp::default())
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
            remember_frontmost_app,
            restore_frontmost_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
