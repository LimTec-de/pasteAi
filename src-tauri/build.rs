use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    tauri_build::build();

    if env::var("CARGO_CFG_TARGET_OS").ok().as_deref() == Some("macos") {
        compile_macos_swift();
    }
}

fn compile_macos_swift() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let source = manifest_dir.join("macos/PasteAIApple.swift");
    println!("cargo:rerun-if-changed={}", source.display());

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let obj_path = out_dir.join("PasteAIApple.o");
    let lib_path = out_dir.join("libpasteai_apple.a");

    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_else(|_| "aarch64".into());
    let swift_arch = if arch == "x86_64" { "x86_64" } else { "arm64" };
    let target = format!("{swift_arch}-apple-macosx13.0");

    let sdk = xcrun_output(&["--sdk", "macosx", "--show-sdk-path"]);
    let status = Command::new("xcrun")
        .args([
            "swiftc",
            "-sdk",
            &sdk,
            "-target",
            &target,
            "-parse-as-library",
            "-module-name",
            "PasteAIApple",
            "-emit-object",
            "-O",
            "-o",
            obj_path.to_str().expect("utf8 path"),
            source.to_str().expect("utf8 path"),
        ])
        .status()
        .expect("failed to invoke swiftc");

    if !status.success() {
        panic!("swiftc failed to compile macos/PasteAIApple.swift");
    }

    let ar_status = Command::new("ar")
        .args(["crus", lib_path.to_str().expect("utf8 path"), obj_path.to_str().expect("utf8 path")])
        .status()
        .expect("failed to invoke ar");
    if !ar_status.success() {
        panic!("ar failed to archive Swift object");
    }

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=pasteai_apple");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=CoreAudio");
    println!("cargo:rustc-link-lib=framework=AudioToolbox");
    println!("cargo:rustc-link-arg=-Wl,-weak_framework,FoundationModels");
    println!("cargo:rustc-link-arg=-Wl,-weak_framework,Speech");

    link_swift_runtime(&target);
}

fn link_swift_runtime(target: &str) {
    let info = Command::new("xcrun")
        .args(["swift", "-target", target, "-print-target-info"])
        .output()
        .expect("failed to invoke swift -print-target-info");
    if !info.status.success() {
        panic!(
            "swift -print-target-info failed: {}",
            String::from_utf8_lossy(&info.stderr)
        );
    }

    let parsed: serde_json::Value =
        serde_json::from_slice(&info.stdout).expect("swift -print-target-info JSON");
    if let Some(paths) = parsed["paths"]["runtimeLibraryPaths"].as_array() {
        for path in paths {
            if let Some(path) = path.as_str() {
                println!("cargo:rustc-link-search=native={path}");
            }
        }
    }

    // Link-search is not LC_RPATH. Swift dylibs use @rpath; macOS ships them in /usr/lib/swift.
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    for lib in [
        "swiftCore",
        "swiftFoundation",
        "swiftDispatch",
        "swiftObjectiveC",
        "swift_Concurrency",
        "swiftObservation",
    ] {
        println!("cargo:rustc-link-lib=dylib={lib}");
    }
}

fn xcrun_output(args: &[&str]) -> String {
    let output = Command::new("xcrun")
        .args(args)
        .output()
        .unwrap_or_else(|error| panic!("failed to invoke xcrun {args:?}: {error}"));
    if !output.status.success() {
        panic!(
            "xcrun {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    String::from_utf8(output.stdout)
        .expect("xcrun utf8")
        .trim()
        .to_string()
}
