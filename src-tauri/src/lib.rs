#[tauri::command]
fn get_platform() -> String {
    if cfg!(target_os = "android") {
        "android".to_string()
    } else if cfg!(target_os = "ios") {
        "ios".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else if cfg!(target_os = "macos") {
        "macos".to_string()
    } else {
        "linux".to_string()
    }
}

#[tauri::command]
fn is_native() -> bool {
    true
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn save_to_notoz_downloads(filename: String, base64_data: String) -> Result<String, String> {
    use base64::Engine;
    use std::fs;
    use std::path::PathBuf;

    // Strip data URL scheme prefix if present
    let clean_base64 = if let Some(idx) = base64_data.find(";base64,") {
        &base64_data[idx + 8..]
    } else if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(clean_base64.trim())
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    // Candidate directories for Downloads/Notoz
    let candidates: Vec<PathBuf> = if cfg!(target_os = "android") {
        vec![
            PathBuf::from("/storage/emulated/0/Download/Notoz"),
            PathBuf::from("/sdcard/Download/Notoz"),
            PathBuf::from("/storage/self/primary/Download/Notoz"),
        ]
    } else {
        let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".to_string());
        vec![
            PathBuf::from(home).join("Downloads").join("Notoz"),
            PathBuf::from("./Downloads/Notoz"),
        ]
    };

    let mut last_err = String::new();
    for dir in candidates {
        if let Err(e) = fs::create_dir_all(&dir) {
            last_err = format!("Failed to create directory {:?}: {}", dir, e);
            continue;
        }
        let target_path = dir.join(&filename);
        match fs::write(&target_path, &bytes) {
            Ok(_) => return Ok(target_path.to_string_lossy().to_string()),
            Err(e) => {
                last_err = format!("Failed to write to {:?}: {}", target_path, e);
            }
        }
    }

    Err(format!("Could not save note to Downloads/Notoz: {}", last_err))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_platform,
            is_native,
            app_version,
            save_to_notoz_downloads
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
