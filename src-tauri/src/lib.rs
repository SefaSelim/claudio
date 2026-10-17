use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

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

/// Pencereyi bulunduğu monitörün çalışma alanının (görev çubuğu hariç) sağ alt köşesine koyar.
fn place_bottom_right(win: &WebviewWindow) -> tauri::Result<()> {
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
        .manage(regions.clone())
        .invoke_handler(tauri::generate_handler![set_hit_regions, quit_app])
        .setup(move |app| {
            let win = app
                .get_webview_window("main")
                .expect("main penceresi tauri.conf.json içinde tanımlı olmalı");
            place_bottom_right(&win)?;
            win.show()?;
            start_click_through(win, regions.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması başlatılamadı");
}
