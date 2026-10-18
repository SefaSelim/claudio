mod autostart;
mod drag;
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
/// With `poly`, only the polygon inside the box counts (the office's diamond shape).
#[derive(Deserialize, Clone, Debug)]
pub(crate) struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub poly: Option<Vec<[f64; 2]>>,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        let in_box = x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h;
        match &self.poly {
            Some(points) if in_box && points.len() >= 3 => point_in_polygon(points, x, y),
            _ => in_box,
        }
    }
}

/// Even-odd ray casting.
fn point_in_polygon(points: &[[f64; 2]], x: f64, y: f64) -> bool {
    let mut inside = false;
    let mut j = points.len() - 1;
    for i in 0..points.len() {
        let ([xi, yi], [xj, yj]) = (points[i], points[j]);
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
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

/// Grip pressed: the shell moves the window until the button is released.
/// `content` is the visible part (office and dock) in window CSS px.
#[tauri::command]
fn begin_drag(window: WebviewWindow, content: Rect) {
    drag::begin(window, content);
}

/// Keeps the visible part on screen (after a resize, a collapse, or at start-up).
#[tauri::command]
fn settle_position(window: WebviewWindow, content: Rect) {
    std::thread::spawn(move || drag::settle(&window, content));
}

/// Taşıma tutamağına çift tıklanınca pencereyi sağ alta geri götürür.
#[tauri::command]
fn reset_position(window: WebviewWindow) -> Result<(), String> {
    position::reset(&window).map_err(|e| e.to_string())
}

/// Tıklamayı yok sayan pencere fare olayı almaz; bu yüzden imleci kendimiz yoklarız.
/// İmleç bir alanın üstündeyse pencere tıklanabilir olur, değilse tıklama alttaki pencereye geçer.
fn start_click_through(win: WebviewWindow, regions: Arc<HitRegions>, dragging: Arc<std::sync::atomic::AtomicBool>) {
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
            let want_ignore = !hit && !dragging.load(std::sync::atomic::Ordering::Relaxed);
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
        .manage(drag::Dragging::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_regions,
            quit_app,
            reset_position,
            sidecar_send,
            get_autostart,
            set_autostart,
            set_tray_status,
            begin_drag,
            settle_position
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
            let dragging = app.state::<drag::Dragging>().0.clone();
            start_click_through(win, regions.clone(), dragging);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn polygon_hit_ignores_the_empty_corners_of_the_box() {
        // A diamond inside a 100 x 100 box, like the office floor inside its canvas.
        let r = Rect { x: 0.0, y: 0.0, w: 100.0, h: 100.0, poly: Some(vec![[50.0, 0.0], [100.0, 50.0], [50.0, 100.0], [0.0, 50.0]]) };
        assert!(r.contains(50.0, 50.0));
        assert!(r.contains(70.0, 40.0));
        assert!(!r.contains(5.0, 5.0));
        assert!(!r.contains(95.0, 95.0));
        assert!(!r.contains(150.0, 50.0));
    }

    #[test]
    fn plain_rect_still_works() {
        let r = Rect { x: 10.0, y: 10.0, w: 20.0, h: 20.0, poly: None };
        assert!(r.contains(15.0, 25.0));
        assert!(!r.contains(5.0, 25.0));
    }
}
