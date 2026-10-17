//! Start with Windows: a value under HKCU\...\Run that points at this executable.
//! `reg.exe` keeps this free of extra crates; it needs no admin rights for HKCU.

use std::process::Command;

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE: &str = "Claudio";

fn reg(args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut cmd = Command::new("reg");
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output()
}

fn exe_path() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.to_string_lossy().trim_start_matches(r"\\?\").to_string())
}

/// True when the Run value exists and points at this executable.
pub fn enabled() -> bool {
    let (Ok(out), Ok(exe)) = (reg(&["query", RUN_KEY, "/v", VALUE]), exe_path()) else {
        return false;
    };
    out.status.success() && String::from_utf8_lossy(&out.stdout).to_lowercase().contains(&exe.to_lowercase())
}

pub fn set(on: bool) -> Result<(), String> {
    let out = if on {
        let exe = exe_path()?;
        reg(&["add", RUN_KEY, "/v", VALUE, "/t", "REG_SZ", "/d", &format!("\"{exe}\""), "/f"])
    } else {
        if !enabled() {
            return Ok(());
        }
        reg(&["delete", RUN_KEY, "/v", VALUE, "/f"])
    }
    .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}
