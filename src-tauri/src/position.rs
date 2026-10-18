//! Pencere konumunu hatırlar: sürüklenince kaydeder, açılışta geri yükler.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

const FILE_NAME: &str = "window.json";

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
struct Saved {
    x: i32,
    y: i32,
}

/// Son taşınma konumu ve zamanı. Sürükleme sırasında her harekette diske yazmamak için
/// konum burada tutulur, hareket durduktan sonra bir kez kaydedilir.
#[derive(Default)]
pub struct PendingMove(Mutex<Option<(PhysicalPosition<i32>, Instant)>>);

impl PendingMove {
    pub fn record(&self, pos: PhysicalPosition<i32>) {
        *self.0.lock().unwrap() = Some((pos, Instant::now()));
    }
}

fn file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE_NAME))
}

fn load(app: &AppHandle) -> Option<Saved> {
    let text = fs::read_to_string(file_path(app)?).ok()?;
    serde_json::from_str(&text).ok()
}

/// Saves right away (after a drag has settled).
pub fn save_now(app: &AppHandle, pos: PhysicalPosition<i32>) {
    save(app, pos);
}

fn save(app: &AppHandle, pos: PhysicalPosition<i32>) {
    let Some(path) = file_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let saved = Saved { x: pos.x, y: pos.y };
    if let Ok(text) = serde_json::to_string(&saved) {
        let _ = fs::write(path, text);
    }
}

fn forget(app: &AppHandle) {
    if let Some(path) = file_path(app) {
        let _ = fs::remove_file(path);
    }
}

/// Pencereyi bulunduğu monitörün çalışma alanının (görev çubuğu hariç) sağ alt köşesine koyar.
pub fn place_bottom_right(win: &WebviewWindow) -> tauri::Result<()> {
    let monitor = match win.current_monitor()? {
        Some(m) => Some(m),
        None => win.primary_monitor()?,
    };
    if let Some(m) = monitor {
        let area = m.work_area();
        let size = win.outer_size()?;
        let x = area.position.x + area.size.width as i32 - size.width as i32;
        let y = area.position.y + area.size.height as i32 - size.height as i32;
        win.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

/// Kayıtlı konum bir monitörün içinde kalıyorsa onu kullanır; yoksa sağ alta koyar.
/// Monitör çıkarıldıysa ya da çözünürlük değiştiyse pencere ekran dışında kaybolmaz.
pub fn restore(win: &WebviewWindow) -> tauri::Result<()> {
    let app = win.app_handle();
    if let Some(saved) = load(app) {
        let size = win.outer_size()?;
        // The office sits in the bottom-right of the window; the top may be off screen.
        let cx = saved.x + size.width as i32 - 120;
        let cy = saved.y + size.height as i32 - 120;
        let visible = win.available_monitors()?.iter().any(|m| {
            let a = m.work_area();
            cx >= a.position.x
                && cx < a.position.x + a.size.width as i32
                && cy >= a.position.y
                && cy < a.position.y + a.size.height as i32
        });
        if visible {
            return win.set_position(PhysicalPosition::new(saved.x, saved.y));
        }
    }
    place_bottom_right(win)
}

/// Kaydı siler ve pencereyi sağ alta geri götürür.
pub fn reset(win: &WebviewWindow) -> tauri::Result<()> {
    forget(win.app_handle());
    place_bottom_right(win)
}

/// Hareket 400 ms durunca son konumu diske yazar.
pub fn start_saver(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(200));
        let pending = app.state::<PendingMove>();
        let mut slot = pending.0.lock().unwrap();
        if let Some((pos, at)) = *slot {
            if at.elapsed() >= Duration::from_millis(400) {
                *slot = None;
                drop(slot);
                save(&app, pos);
            }
        }
    });
}
