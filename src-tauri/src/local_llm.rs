use std::fs::{self, File};
use std::io::{Read, Write};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use encoding_rs::UTF_8;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaChatTemplate, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

const MODEL_FILE_NAME: &str = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
const MODEL_URL: &str = "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/d7f438a3f394c3cefaf521b22d4c581aa240a7e2/Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
const MODEL_SHA256: &str = "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597";
const MODEL_BYTES: u64 = 2_497_281_120;
const N_CTX: u32 = 4096;
const MAX_PREDICT: i32 = 1024;
const STATUS_EVENT: &str = "local-llm-status";
const NOT_INSTALLED: &str = "On-device rewrite model is not installed.";

pub struct LocalLlmState {
    model: Mutex<Option<LlamaModel>>,
    download: Mutex<DownloadProgress>,
}

impl Default for LocalLlmState {
    fn default() -> Self {
        Self {
            model: Mutex::new(None),
            download: Mutex::new(DownloadProgress::default()),
        }
    }
}

#[derive(Clone, Default)]
struct DownloadProgress {
    downloading: bool,
    phase: String,
    bytes: u64,
    total: u64,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmStatus {
    pub installed: bool,
    pub downloading: bool,
    pub phase: String,
    pub loaded: bool,
    pub bytes: u64,
    pub total: u64,
    pub message: String,
}

#[tauri::command]
pub async fn local_llm_status(app: AppHandle, state: State<'_, LocalLlmState>) -> Result<LocalLlmStatus, String> {
    Ok(snapshot(&app, &state)?)
}

#[tauri::command]
pub async fn local_llm_install(app: AppHandle) -> Result<(), String> {
    let state = app.state::<LocalLlmState>();
    {
        let download = state.download.lock().map_err(lock_error)?;
        if download.downloading {
            return Ok(());
        }
    }

    if model_installed(&app)? {
        local_llm_preload(app).await?;
        return Ok(());
    }

    {
        let mut download = state.download.lock().map_err(lock_error)?;
        download.downloading = true;
        download.phase = "download".to_string();
        download.bytes = 0;
        download.total = MODEL_BYTES;
        download.message = "Downloading rewrite model…".to_string();
    }
    emit_status(&app)?;

    let result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || run_install(app)
    })
    .await
    .map_err(|error| error.to_string())?;

    let state = app.state::<LocalLlmState>();
    {
        let mut download = state.download.lock().map_err(lock_error)?;
        download.downloading = false;
        download.phase = String::new();
        if let Err(error) = &result {
            download.message = error.clone();
        } else {
            download.message = String::new();
        }
    }
    emit_status(&app)?;
    result
}

#[tauri::command]
pub async fn local_llm_preload(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<LocalLlmState>();
        if state.model.lock().map_err(lock_error)?.is_some() {
            return Ok(());
        }
    }

    if !model_installed(&app)? {
        return Err(NOT_INSTALLED.to_string());
    }

    let path = model_path(&app)?;
    let model = tauri::async_runtime::spawn_blocking(move || load_model(&path))
        .await
        .map_err(|error| error.to_string())??;

    let state = app.state::<LocalLlmState>();
    *state.model.lock().map_err(lock_error)? = Some(model);
    emit_status(&app)?;
    Ok(())
}

#[tauri::command]
pub async fn local_llm_unload(app: AppHandle) -> Result<(), String> {
    let state = app.state::<LocalLlmState>();
    *state.model.lock().map_err(lock_error)? = None;
    emit_status(&app)?;
    Ok(())
}

#[tauri::command]
pub async fn local_llm_improve(
    app: AppHandle,
    system_prompt: String,
    text: String,
) -> Result<String, String> {
    local_llm_preload(app.clone()).await?;

    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LocalLlmState>();
        let model = state.model.lock().map_err(lock_error)?;
        let model = model
            .as_ref()
            .ok_or_else(|| "On-device rewrite model is not loaded.".to_string())?;
        generate(model, &system_prompt, &text)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn run_install(app: AppHandle) -> Result<(), String> {
    let models_dir = models_root(&app)?;
    fs::create_dir_all(&models_dir).map_err(|error| error.to_string())?;
    let dest = models_dir.join(MODEL_FILE_NAME);
    let part = part_path(&models_dir);

    let _ = fs::remove_file(&part);

    if dest.is_file() && file_looks_complete(&dest) {
        if let Err(error) = verify_sha256(&dest) {
            let _ = fs::remove_file(&dest);
            return Err(error);
        }
    } else {
        download_model(&app, &dest, &part)?;
        set_phase(&app, "verify", "Checking rewrite model…")?;
        if let Err(error) = verify_sha256(&dest) {
            let _ = fs::remove_file(&dest);
            return Err(error);
        }
    }

    set_phase(&app, "load", "Loading rewrite model…")?;
    let model = load_model(&dest)?;
    let state = app.state::<LocalLlmState>();
    *state.model.lock().map_err(lock_error)? = Some(model);
    Ok(())
}

fn download_model(app: &AppHandle, dest: &Path, part: &Path) -> Result<(), String> {
    let _ = fs::remove_file(part);

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(60 * 60)))
        .build()
        .into();

    let response = agent
        .get(MODEL_URL)
        .header("User-Agent", "pasteAI")
        .call()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Could not download rewrite model ({})", response.status()));
    }

    let total = response
        .headers()
        .get("content-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(MODEL_BYTES);

    {
        let state = app.state::<LocalLlmState>();
        let mut download = state.download.lock().map_err(lock_error)?;
        download.phase = "download".to_string();
        download.total = total;
        download.bytes = 0;
        download.message = "Downloading rewrite model…".to_string();
    }
    emit_status(app)?;

    let mut reader = response.into_body().into_reader();
    let mut file = File::create(part).map_err(|error| error.to_string())?;
    let mut buffer = [0u8; 64 * 1024];
    let mut bytes = 0u64;
    let mut last_emit = 0u64;

    loop {
        let read = reader.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|error| error.to_string())?;
        bytes += read as u64;

        if bytes - last_emit >= 8 * 1024 * 1024 || bytes == total {
            {
                let state = app.state::<LocalLlmState>();
                let mut download = state.download.lock().map_err(lock_error)?;
                download.bytes = bytes;
                download.total = total;
            }
            emit_status(app)?;
            last_emit = bytes;
        }
    }

    file.sync_all().map_err(|error| {
        let _ = fs::remove_file(part);
        error.to_string()
    })?;
    drop(file);
    if let Err(error) = fs::rename(part, dest) {
        let _ = fs::remove_file(part);
        return Err(error.to_string());
    }

    {
        let state = app.state::<LocalLlmState>();
        let mut download = state.download.lock().map_err(lock_error)?;
        download.bytes = bytes;
        download.total = if total > 0 { total } else { bytes };
    }
    emit_status(app)?;
    Ok(())
}

fn load_model(path: &Path) -> Result<LlamaModel, String> {
    let backend = llama_backend()?;
    let mut params = LlamaModelParams::default();
    if !backend.supports_gpu_offload() {
        params = params.with_n_gpu_layers(0);
    }
    LlamaModel::load_from_file(backend, path, &params)
        .map_err(|error| format!("Could not load the on-device rewrite model: {error}"))
}

fn generate(model: &LlamaModel, system_prompt: &str, text: &str) -> Result<String, String> {
    let backend = llama_backend()?;
    let threads = thread_count();
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(N_CTX))
        .with_n_batch(N_CTX)
        .with_n_threads(threads)
        .with_n_threads_batch(threads);
    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|error| format!("Could not start the on-device rewrite model: {error}"))?;

    let template = match model.chat_template(None) {
        Ok(template) => template,
        Err(_) => LlamaChatTemplate::new("chatml").map_err(|error| error.to_string())?,
    };
    let messages = vec![
        LlamaChatMessage::new("system".into(), system_prompt.to_string())
            .map_err(|error| error.to_string())?,
        LlamaChatMessage::new("user".into(), text.to_string()).map_err(|error| error.to_string())?,
    ];
    let prompt = model
        .apply_chat_template(&template, &messages, true)
        .map_err(|error| error.to_string())?;

    let tokens = model
        .str_to_token(&prompt, AddBos::Never)
        .map_err(|error| error.to_string())?;
    if tokens.is_empty() {
        return Ok(String::new());
    }

    let n_ctx = ctx.n_ctx() as i32;
    let prompt_len = i32::try_from(tokens.len()).map_err(|_| "Prompt is too long.".to_string())?;
    if prompt_len >= n_ctx - 1 {
        return Err("Text is too long for the on-device rewrite model.".to_string());
    }

    let mut batch = LlamaBatch::new(N_CTX as usize, 1);
    let last_index = prompt_len - 1;
    for (i, token) in (0_i32..).zip(tokens.into_iter()) {
        batch
            .add(token, i, &[0], i == last_index)
            .map_err(|error| error.to_string())?;
    }
    ctx.decode(&mut batch)
        .map_err(|error| format!("Could not run the on-device rewrite model: {error}"))?;

    let mut sampler = LlamaSampler::chain_simple([LlamaSampler::greedy()]);
    let mut decoder = UTF_8.new_decoder();
    let mut output = String::new();
    let mut n_cur = batch.n_tokens();
    let n_limit = (prompt_len + MAX_PREDICT).min(n_ctx);

    while n_cur < n_limit {
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);
        if model.is_eog_token(token) {
            break;
        }

        output.push_str(
            &model
                .token_to_piece(token, &mut decoder, true, None)
                .map_err(|error| error.to_string())?,
        );

        batch.clear();
        batch
            .add(token, n_cur, &[0], true)
            .map_err(|error| error.to_string())?;
        ctx.decode(&mut batch)
            .map_err(|error| format!("Could not run the on-device rewrite model: {error}"))?;
        n_cur += 1;
    }

    Ok(output.trim().to_string())
}

fn llama_backend() -> Result<&'static LlamaBackend, String> {
    static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();
    if let Some(backend) = BACKEND.get() {
        return Ok(backend);
    }

    let mut backend = LlamaBackend::init().map_err(|error| error.to_string())?;
    backend.void_logs();
    match BACKEND.set(backend) {
        Ok(()) => BACKEND
            .get()
            .ok_or_else(|| "Could not initialize the on-device rewrite engine.".to_string()),
        Err(_) => BACKEND
            .get()
            .ok_or_else(|| "Could not initialize the on-device rewrite engine.".to_string()),
    }
}

fn thread_count() -> i32 {
    std::thread::available_parallelism()
        .map(|value| value.get().min(4) as i32)
        .unwrap_or(2)
}

fn verify_sha256(path: &Path) -> Result<(), String> {
    let digest = sha256_file(path)?;
    if digest != MODEL_SHA256 {
        return Err("Rewrite model download was corrupted. Try downloading again.".to_string());
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn snapshot(app: &AppHandle, state: &LocalLlmState) -> Result<LocalLlmStatus, String> {
    let download = state.download.lock().map_err(lock_error)?.clone();
    let loaded = state.model.lock().map_err(lock_error)?.is_some();
    let installed = model_installed(app)?;
    let message = if !download.message.is_empty() {
        download.message
    } else if !installed {
        "Download Qwen3-4B Instruct (~2.5 GB) to rewrite offline.".to_string()
    } else {
        String::new()
    };

    Ok(LocalLlmStatus {
        installed,
        downloading: download.downloading,
        phase: download.phase,
        loaded,
        bytes: download.bytes,
        total: download.total,
        message,
    })
}

fn emit_status(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<LocalLlmState>();
    let status = snapshot(app, &state)?;
    app.emit(STATUS_EVENT, status).map_err(|error| error.to_string())
}

fn set_phase(app: &AppHandle, phase: &str, message: &str) -> Result<(), String> {
    {
        let state = app.state::<LocalLlmState>();
        let mut download = state.download.lock().map_err(lock_error)?;
        download.phase = phase.to_string();
        download.message = message.to_string();
    }
    emit_status(app)
}

fn models_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("models"))
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(models_root(app)?.join(MODEL_FILE_NAME))
}

fn part_path(models_dir: &Path) -> PathBuf {
    models_dir.join(format!("{MODEL_FILE_NAME}.part"))
}

fn model_installed(app: &AppHandle) -> Result<bool, String> {
    let models_dir = models_root(app)?;
    let dest = models_dir.join(MODEL_FILE_NAME);
    Ok(file_looks_complete(&dest) && !part_path(&models_dir).is_file())
}

fn file_looks_complete(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| path.is_file() && meta.len() == MODEL_BYTES)
        .unwrap_or(false)
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "Local rewrite engine lock poisoned".to_string()
}
