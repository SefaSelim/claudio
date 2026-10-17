mod autostart;
mod position;
mod sidecar;
mod tray;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager, RunEvent, WebviewWindow, WindowEvent};

use position::PendingMove;
use sidecar::Sidecar;

/// Ön yüzün bildirdiği tıklanabilir bir alan (CSS piksel, pencereye göre).
#[derive(Deserialize, Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }
}

#[derive(Default)]
struct HitRegions(Mutex<Vec<Rect>>);

#[tauri::command]
fn set_hit_regions(regions: Vec<Rect>, state: tauri::State<'_, Arc<HitRegions>>) {
    *state.0.lock().unwrap() = regions;
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Ön yüzden gelen bir JSON komut satırını yan sürece yazar.
#[tauri::command]
fn sidecar_send(line: String, sidecar: tauri::State<'_, Sidecar>) -> Result<(), String> {
    sidecar.send(&line)
}

/// Tray tooltip text, such as "2 istek seni bekliyor".
#[tauri::command]
fn set_tray_status(app: AppHandle, text: String) {
    tray::set_status(&app, &text);
}

#[tauri::command]
fn get_autostart() -> bool {
    autostart::enabled()
}

#[tauri::command]
fn set_autostart(on: bool) -> Result<(), String> {
    autostart::set(on)
}

/// Taşıma tutamağına çift tıklanınca pencereyi sağ alta geri götürür.
#[tauri::command]
fn reset_position(window: WebviewWindow) -> Result<(), String> {
    position::reset(&window).map_err(|e| e.to_string())
}

/// Tıklamayı yok sayan pencere fare olayı almaz; bu yüzden imleci kendimiz yoklarız.
/// İmleç bir alanın üstündeyse pencere tıklanabilir olur, değilse tıklama alttaki pencereye geçer.
fn start_click_through(win: WebviewWindow, regions: Arc<HitRegions>) {
    thread::spawn(move || {
        let mut ignoring: Option<bool> = None;
        loop {
            // ~60 Hz: imleç hızlı hareket etse de ilk tıklama doğru pencereye gider.
            thread::sleep(Duration::from_millis(16));
            let (Ok(cursor), Ok(origin), Ok(scale)) =
                (win.cursor_position(), win.inner_position(), win.scale_factor())
            else {
                continue;
            };
            let x = (cursor.x - origin.x as f64) / scale;
            let y = (cursor.y - origin.y as f64) / scale;
            let hit = regions
                .0
                .lock()
                .map(|r| r.iter().any(|rect| rect.contains(x, y)))
                .unwrap_or(false);
            let want_ignore = !hit;
            if ignoring != Some(want_ignore) && win.set_ignore_cursor_events(want_ignore).is_ok() {
                ignoring = Some(want_ignore);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let regions = Arc::new(HitRegions::default());
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(regions.clone())
        .manage(PendingMove::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_regions,
            quit_app,
            reset_position,
            sidecar_send,
            get_autostart,
            set_autostart,
            set_tray_status
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::Moved(pos) = event {
                // Küçültülmüş pencere Windows'ta (-32000, -32000) civarına taşınır; bunu kaydetme.
                if !window.is_minimized().unwrap_or(false) && pos.x > -10_000 && pos.y > -10_000 {
                    window.state::<PendingMove>().record(*pos);
                }
            }
        })
        .setup(move |app| {
            let win = app
                .get_webview_window("main")
                .expect("main penceresi tauri.conf.json içinde tanımlı olmalı");
            position::restore(&win)?;
            win.show()?;
            position::start_saver(app.handle().clone());
            start_click_through(win, regions.clone());
            tray::create(app.handle())?;
            app.manage(Sidecar::spawn(app.handle()));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri uygulaması başlatılamadı")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(sidecar) = app.try_state::<Sidecar>() {
                    sidecar.shutdown();
                }
            }
        });
}
