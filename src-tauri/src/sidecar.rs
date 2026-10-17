//! Node yan sürecini (sidecar/index.mjs) başlatır, ona satır satır JSON yazar
//! ve gelen her satırı ön yüze `sidecar` olayı olarak iletir.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter};

pub struct Sidecar {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    error: Option<String>,
}

/// Geliştirme sırasında proje kökü. Paketlenmiş sürümde (Faz 6) yan süreç uygulamayla birlikte dağıtılacak.
fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

impl Sidecar {
    pub fn spawn(app: &AppHandle) -> Self {
        match Self::try_spawn(app) {
            Ok(sidecar) => sidecar,
            Err(err) => Sidecar {
                stdin: Mutex::new(None),
                child: Mutex::new(None),
                error: Some(format!("Yan süreç başlatılamadı (Node.js kurulu mu?): {err}")),
            },
        }
    }

    fn try_spawn(app: &AppHandle) -> std::io::Result<Self> {
        let root = project_root();
        let mut cmd = Command::new("node");
        cmd.arg(root.join("sidecar").join("index.mjs"))
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn()?;

        let stdout = child.stdout.take().expect("stdout piped");
        let emitter = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = emitter.emit("sidecar", line);
            }
            let _ = emitter.emit("sidecar", r#"{"type":"sidecar_exit"}"#.to_string());
        });

        let stderr = child.stderr.take().expect("stderr piped");
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[sidecar] {line}");
            }
        });

        Ok(Sidecar {
            stdin: Mutex::new(child.stdin.take()),
            child: Mutex::new(Some(child)),
            error: None,
        })
    }

    pub fn send(&self, line: &str) -> Result<(), String> {
        if let Some(err) = &self.error {
            return Err(err.clone());
        }
        let mut guard = self.stdin.lock().unwrap();
        let stdin = guard.as_mut().ok_or("Yan süreç kapalı.")?;
        writeln!(stdin, "{line}")
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("Yan sürece yazılamadı: {e}"))
    }

    pub fn shutdown(&self) {
        // stdin'i kapatmak yan sürece oturumu kapatıp çıkmasını söyler.
        self.stdin.lock().unwrap().take();
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}
