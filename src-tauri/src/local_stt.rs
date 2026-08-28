use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use bzip2::read::BzDecoder;
use serde::Serialize;
use sherpa_onnx::{
    LinearResampler, OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig,
};
use tar::Archive;
use tauri::{AppHandle, Emitter, Manager, State};

const MODEL_DIR_NAME: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
const MODEL_ARCHIVE: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";
const MODEL_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";
const TARGET_SAMPLE_RATE: i32 = 16_000;
const STATUS_EVENT: &str = "local-stt-status";

pub struct LocalSttState {
    recognizer: Mutex<Option<OfflineRecognizer>>,
    download: Mutex<DownloadProgress>,
}

impl Default for LocalSttState {
    fn default() -> Self {
        Self {
            recognizer: Mutex::new(None),
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
pub struct LocalSttStatus {
    pub installed: bool,
    pub downloading: bool,
    pub phase: String,
    pub loaded: bool,
    pub bytes: u64,
    pub total: u64,
    pub message: String,
}

#[tauri::command]
pub async fn local_stt_status(app: AppHandle, state: State<'_, LocalSttState>) -> Result<LocalSttStatus, String> {
    Ok(snapshot(&app, &state)?)
}

#[tauri::command]
pub async fn local_stt_install(app: AppHandle) -> Result<(), String> {
    let state = app.state::<LocalSttState>();
    {
        let download = state.download.lock().map_err(lock_error)?;
        if download.downloading {
            return Ok(());
        }
    }

    if model_installed(&app)? {
        return Ok(());
    }

    {
        let mut download = state.download.lock().map_err(lock_error)?;
        download.downloading = true;
        download.phase = "download".to_string();
        download.bytes = 0;
        download.total = 0;
        download.message = "Downloading speech model…".to_string();
    }
    emit_status(&app)?;

    let result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || run_install(app)
    })
    .await
    .map_err(|error| error.to_string())?;

    let state = app.state::<LocalSttState>();
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
pub async fn local_stt_preload(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<LocalSttState>();
        if state.recognizer.lock().map_err(lock_error)?.is_some() {
            return Ok(());
        }
    }

    if !model_installed(&app)? {
        return Err("On-device speech model is not installed.".to_string());
    }

    let dir = model_dir(&app)?;
    let recognizer = tauri::async_runtime::spawn_blocking(move || create_recognizer(&dir))
        .await
        .map_err(|error| error.to_string())??;

    let state = app.state::<LocalSttState>();
    *state.recognizer.lock().map_err(lock_error)? = Some(recognizer);
    Ok(())
}

#[tauri::command]
pub async fn local_stt_transcribe(
    app: AppHandle,
    pcm: Vec<u8>,
    sample_rate: u32,
) -> Result<String, String> {
    if pcm.is_empty() {
        return Ok(String::new());
    }

    local_stt_preload(app.clone()).await?;
    let samples = pcm16le_to_f32(&pcm)?;
    let rate = i32::try_from(sample_rate).map_err(|_| "Invalid sample rate".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LocalSttState>();
        let recognizer = state.recognizer.lock().map_err(lock_error)?;
        let recognizer = recognizer
            .as_ref()
            .ok_or_else(|| "On-device speech model is not loaded.".to_string())?;
        decode(recognizer, &samples, rate)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn run_install(app: AppHandle) -> Result<(), String> {
    let models_dir = models_root(&app)?;
    fs::create_dir_all(&models_dir).map_err(|error| error.to_string())?;
    let archive_path = models_dir.join(MODEL_ARCHIVE);
    let archive_part = archive_part_path(&models_dir);
    let staging = staging_dir(&models_dir);

    let _ = fs::remove_file(&archive_part);
    let _ = fs::remove_dir_all(&staging);

    if archive_path.is_file() {
        set_phase(&app, "extract", "Extracting speech model…")?;
    } else {
        download_archive(&app, &archive_path, &archive_part)?;
        set_phase(&app, "extract", "Extracting speech model…")?;
    }

    extract_archive(&archive_path, &models_dir, &staging)?;
    if !model_files_present(&model_dir(&app)?) {
        let _ = fs::remove_dir_all(model_dir(&app)?);
        return Err("Speech model archive was missing required files.".to_string());
    }

    let _ = fs::remove_file(&archive_path);
    let _ = fs::remove_file(&archive_part);
    let _ = fs::remove_dir_all(&staging);

    set_phase(&app, "load", "Loading speech model…")?;
    let dir = model_dir(&app)?;
    let recognizer = create_recognizer(&dir)?;
    let state = app.state::<LocalSttState>();
    *state.recognizer.lock().map_err(lock_error)? = Some(recognizer);
    Ok(())
}

fn extract_archive(archive_path: &Path, models_dir: &Path, staging: &Path) -> Result<(), String> {
    let dest = models_dir.join(MODEL_DIR_NAME);
    let _ = fs::remove_dir_all(staging);
    fs::create_dir_all(staging).map_err(|error| error.to_string())?;

    let result = (|| {
        let file = File::open(archive_path).map_err(|error| error.to_string())?;
        let decoder = BzDecoder::new(file);
        let mut archive = Archive::new(decoder);
        archive.unpack(staging).map_err(|error| error.to_string())?;

        let unpacked = staging.join(MODEL_DIR_NAME);
        if !unpacked.is_dir() || !model_files_present(&unpacked) {
            return Err("Speech model archive was missing required files.".to_string());
        }

        let _ = fs::remove_dir_all(&dest);
        fs::rename(&unpacked, &dest).map_err(|error| error.to_string())?;
        Ok(())
    })();

    let _ = fs::remove_dir_all(staging);
    result
}

fn download_archive(app: &AppHandle, dest: &Path, part: &Path) -> Result<(), String> {
    let _ = fs::remove_file(part);

    let response = ureq::get(MODEL_URL)
        .call()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Could not download speech model ({})", response.status()));
    }

    let total = response
        .headers()
        .get("content-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);

    {
        let state = app.state::<LocalSttState>();
        let mut download = state.download.lock().map_err(lock_error)?;
        download.phase = "download".to_string();
        download.total = total;
        download.bytes = 0;
        download.message = "Downloading speech model…".to_string();
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
                let state = app.state::<LocalSttState>();
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
        let state = app.state::<LocalSttState>();
        let mut download = state.download.lock().map_err(lock_error)?;
        download.bytes = bytes;
        download.total = if total > 0 { total } else { bytes };
    }
    emit_status(app)?;
    Ok(())
}

fn create_recognizer(dir: &Path) -> Result<OfflineRecognizer, String> {
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer = OfflineTransducerModelConfig {
        encoder: Some(path_string(dir.join("encoder.int8.onnx"))),
        decoder: Some(path_string(dir.join("decoder.int8.onnx"))),
        joiner: Some(path_string(dir.join("joiner.int8.onnx"))),
    };
    config.model_config.tokens = Some(path_string(dir.join("tokens.txt")));
    config.model_config.model_type = Some("nemo_transducer".into());
    config.model_config.provider = Some("cpu".into());
    config.decoding_method = Some("greedy_search".into());
    config.model_config.num_threads = std::thread::available_parallelism()
        .map(|value| value.get().min(4) as i32)
        .unwrap_or(2);

    OfflineRecognizer::create(&config).ok_or_else(|| {
        "Could not load the on-device speech model.".to_string()
    })
}

fn decode(recognizer: &OfflineRecognizer, samples: &[f32], sample_rate: i32) -> Result<String, String> {
    let resampled = if sample_rate == TARGET_SAMPLE_RATE {
        samples.to_vec()
    } else {
        let resampler = LinearResampler::create(sample_rate, TARGET_SAMPLE_RATE)
            .ok_or_else(|| "Could not resample microphone audio.".to_string())?;
        resampler.resample(samples, true)
    };

    if resampled.is_empty() {
        return Ok(String::new());
    }

    let stream = recognizer.create_stream();
    stream.accept_waveform(TARGET_SAMPLE_RATE, &resampled);
    recognizer.decode(&stream);
    Ok(stream
        .get_result()
        .map(|result| result.text.trim().to_string())
        .unwrap_or_default())
}

fn pcm16le_to_f32(pcm: &[u8]) -> Result<Vec<f32>, String> {
    if pcm.len() % 2 != 0 {
        return Err("Audio buffer is truncated.".to_string());
    }

    let mut samples = Vec::with_capacity(pcm.len() / 2);
    for chunk in pcm.chunks_exact(2) {
        let value = i16::from_le_bytes([chunk[0], chunk[1]]);
        samples.push(value as f32 / 32768.0);
    }
    Ok(samples)
}

fn snapshot(app: &AppHandle, state: &LocalSttState) -> Result<LocalSttStatus, String> {
    let download = state.download.lock().map_err(lock_error)?.clone();
    let loaded = state.recognizer.lock().map_err(lock_error)?.is_some();
    let installed = model_installed(app)?;
    let message = if !download.message.is_empty() {
        download.message
    } else if !installed {
        "Download NVIDIA Parakeet TDT v3 (~660 MB) to dictate offline.".to_string()
    } else {
        String::new()
    };

    Ok(LocalSttStatus {
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
    let state = app.state::<LocalSttState>();
    let status = snapshot(app, &state)?;
    app.emit(STATUS_EVENT, status).map_err(|error| error.to_string())
}

fn set_phase(app: &AppHandle, phase: &str, message: &str) -> Result<(), String> {
    {
        let state = app.state::<LocalSttState>();
        let mut download = state.download.lock().map_err(lock_error)?;
        download.phase = phase.to_string();
        download.message = message.to_string();
    }
    emit_status(app)
}

fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(models_root(app)?.join(MODEL_DIR_NAME))
}

fn models_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("models"))
}

fn archive_part_path(models_dir: &Path) -> PathBuf {
    models_dir.join(format!("{MODEL_ARCHIVE}.part"))
}

fn staging_dir(models_dir: &Path) -> PathBuf {
    models_dir.join(format!("{MODEL_DIR_NAME}.partial"))
}

fn model_installed(app: &AppHandle) -> Result<bool, String> {
    let models_dir = models_root(app)?;
    Ok(model_files_present(&models_dir.join(MODEL_DIR_NAME))
        && !models_dir.join(MODEL_ARCHIVE).is_file()
        && !archive_part_path(&models_dir).is_file()
        && !staging_dir(&models_dir).is_dir())
}

fn model_files_present(dir: &Path) -> bool {
    dir.join("encoder.int8.onnx").is_file()
        && dir.join("decoder.int8.onnx").is_file()
        && dir.join("joiner.int8.onnx").is_file()
        && dir.join("tokens.txt").is_file()
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "Local speech engine lock poisoned".to_string()
}
