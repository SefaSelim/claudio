//! Moving the office by its grip, and keeping it on screen.
//!
//! The window is much taller than the office (panels open above it). Windows' own
//! move loop keeps a window's top edge on screen, which stopped the office from going
//! up. So the shell moves the window itself: it follows the cursor while the left
//! button is held, then slides the visible part (office and dock) back inside the
//! monitor's work area with a small margin.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::{Manager, PhysicalPosition, WebviewWindow};

use crate::position;
use crate::Rect;

/// Set while a drag runs; click-through stays off so the cursor never falls through.
#[derive(Default)]
pub struct Dragging(pub Arc<AtomicBool>);

const MARGIN: f64 = 10.0; // CSS px between the office and the screen edge

#[cfg(windows)]
fn left_button_down() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    // The high bit says the key is down right now.
    unsafe { (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0 }
}

#[cfg(not(windows))]
fn left_button_down() -> bool {
    false
}

/// Follows the cursor until the left button is released, then settles `content`
/// (window-relative CSS px) inside the work area.
pub fn begin(win: WebviewWindow, content: Rect) {
    let flag = win.state::<Dragging>().0.clone();
    if flag.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        let (Ok(start_cursor), Ok(start_pos)) = (win.cursor_position(), win.outer_position()) else {
            flag.store(false, Ordering::SeqCst);
            return;
        };
        let mut last = start_pos;
        // Give the button state a moment to register the press that started the drag.
        thread::sleep(Duration::from_millis(16));
        while left_button_down() {
            if let Ok(cursor) = win.cursor_position() {
                let next = PhysicalPosition::new(
                    start_pos.x + (cursor.x - start_cursor.x).round() as i32,
                    start_pos.y + (cursor.y - start_cursor.y).round() as i32,
                );
                if next != last && win.set_position(next).is_ok() {
                    last = next;
                }
            }
            thread::sleep(Duration::from_millis(8));
        }
        flag.store(false, Ordering::SeqCst);
        settle(&win, content);
    });
}

/// Slides the window so `content` sits inside the nearest monitor's work area, then saves.
pub fn settle(win: &WebviewWindow, content: Rect) {
    let (Ok(pos), Ok(scale), Ok(monitors)) = (win.outer_position(), win.scale_factor(), win.available_monitors()) else {
        return;
    };
    let left = pos.x as f64 + content.x * scale;
    let top = pos.y as f64 + content.y * scale;
    let right = left + content.w * scale;
    let bottom = top + content.h * scale;
    let (cx, cy) = ((left + right) / 2.0, (top + bottom) / 2.0);

    // The monitor holding the content's centre, else the one closest to it.
    let area = monitors
        .iter()
        .map(|m| m.work_area())
        .min_by(|a, b| {
            let dist = |r: &tauri::PhysicalRect<i32, u32>| {
                let (x0, y0) = (r.position.x as f64, r.position.y as f64);
                let (x1, y1) = (x0 + r.size.width as f64, y0 + r.size.height as f64);
                let dx = if cx < x0 { x0 - cx } else if cx > x1 { cx - x1 } else { 0.0 };
                let dy = if cy < y0 { y0 - cy } else if cy > y1 { cy - y1 } else { 0.0 };
                dx * dx + dy * dy
            };
            dist(a).total_cmp(&dist(b))
        });
    let Some(area) = area else { return };
    let m = MARGIN * scale;
    let (x0, y0) = (area.position.x as f64 + m, area.position.y as f64 + m);
    let (x1, y1) = (area.position.x as f64 + area.size.width as f64 - m, area.position.y as f64 + area.size.height as f64 - m);
    let dx = if left < x0 { x0 - left } else if right > x1 { x1 - right } else { 0.0 };
    let dy = if top < y0 { y0 - top } else if bottom > y1 { y1 - bottom } else { 0.0 };

    if dx.abs() >= 1.0 || dy.abs() >= 1.0 {
        // A short ease-out slide back inside.
        const STEPS: i32 = 12;
        for i in 1..=STEPS {
            let t = i as f64 / STEPS as f64;
            let e = 1.0 - (1.0 - t).powi(3);
            let _ = win.set_position(PhysicalPosition::new(pos.x + (dx * e).round() as i32, pos.y + (dy * e).round() as i32));
            thread::sleep(Duration::from_millis(14));
        }
    }
    if let Ok(final_pos) = win.outer_position() {
        position::save_now(win.app_handle(), final_pos);
    }
}
