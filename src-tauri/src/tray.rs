//! Tray icon: the one way back to the office while it is hidden (the window has no
//! taskbar button). Left click shows or hides it; the menu has the rest.

use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::position;

pub struct Tray {
    toggle: MenuItem<Wry>,
    on_top: CheckMenuItem<Wry>,
    tooltip: Mutex<String>,
}

const TRAY_ID: &str = "main";

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Ofisi gizle", true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on_top", "Her zaman üstte", true, true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset", "Sağ alta taşı", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Ofisi kapat", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &on_top, &reset, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Claudio Ofis")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle_window(app),
            "on_top" => {
                if let (Some(win), Some(tray)) = (app.get_webview_window("main"), app.try_state::<Tray>()) {
                    let on = tray.on_top.is_checked().unwrap_or(true);
                    let _ = win.set_always_on_top(on);
                }
            }
            "reset" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = position::reset(&win);
                    sync_toggle(app);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(Tray { toggle, on_top, tooltip: Mutex::new(String::new()) });
    Ok(())
}

fn toggle_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    if win.is_visible().unwrap_or(true) {
        let _ = win.hide();
    } else {
        let _ = win.show();
        let _ = win.set_focus();
    }
    sync_toggle(app);
}

fn sync_toggle(app: &AppHandle) {
    let (Some(win), Some(tray)) = (app.get_webview_window("main"), app.try_state::<Tray>()) else { return };
    let visible = win.is_visible().unwrap_or(true);
    let _ = tray.toggle.set_text(if visible { "Ofisi gizle" } else { "Ofisi göster" });
}

/// The office reports what waits for the user; the tray tooltip says it.
pub fn set_status(app: &AppHandle, text: &str) {
    let Some(tray) = app.try_state::<Tray>() else { return };
    let mut last = tray.tooltip.lock().unwrap();
    if *last == text {
        return;
    }
    *last = text.to_string();
    if let Some(icon) = app.tray_by_id(TRAY_ID) {
        let tip = if text.is_empty() { "Claudio Ofis".to_string() } else { format!("Claudio Ofis · {text}") };
        let _ = icon.set_tooltip(Some(tip));
    }
}
