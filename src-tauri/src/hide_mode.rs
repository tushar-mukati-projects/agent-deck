use std::{
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use base64::Engine;
use tauri::Manager;
use windows_sys::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{
        GetSystemMetrics, LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_LOADFROMFILE, SM_CXICON, SM_CXSMICON, SYSTEM_METRICS_INDEX,
        WM_GETICON, WM_SETICON,
    },
};

const TITLE: &str = "Warp";
const ICON_SLOTS: [(u32, SYSTEM_METRICS_INDEX); 2] = [(ICON_SMALL, SM_CXSMICON), (ICON_BIG, SM_CXICON)];

static ORIGINAL: OnceLock<[isize; 2]> = OnceLock::new();
static WARP: OnceLock<[isize; 2]> = OnceLock::new();

pub fn apply(window: &tauri::WebviewWindow, enabled: bool) -> anyhow::Result<Option<String>> {
    let icon = if enabled { warp_icon() } else { None };
    let title = if enabled { TITLE.to_string() } else { window.app_handle().package_info().name.clone() };
    window.set_title(&title)?;
    set_window_icon(window.hwnd()?.0, icon.as_deref())?;
    let Some(path) = icon else { return Ok(None) };
    Ok(Some(format!("data:image/x-icon;base64,{}", base64::engine::general_purpose::STANDARD.encode(std::fs::read(path)?))))
}

fn warp_icon() -> Option<PathBuf> {
    let program_files = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let user_programs = dirs::data_local_dir().map(|dir| dir.join("Programs"));
    [program_files, user_programs].into_iter().flatten().map(|dir| dir.join("Warp").join("icon.ico")).find(|path| path.is_file())
}

fn set_window_icon(hwnd: HWND, icon: Option<&Path>) -> anyhow::Result<()> {
    let original = *ORIGINAL.get_or_init(|| ICON_SLOTS.map(|(kind, _)| window_icon(hwnd, kind)));
    let handles = match icon {
        Some(path) => warp_handles(path)?,
        None => original,
    };
    for ((kind, _), handle) in ICON_SLOTS.into_iter().zip(handles) {
        set_icon(hwnd, kind, handle);
    }
    Ok(())
}

fn warp_handles(path: &Path) -> anyhow::Result<[isize; 2]> {
    if let Some(handles) = WARP.get() {
        return Ok(*handles);
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    let [(_, small), (_, big)] = ICON_SLOTS;
    let loaded = [load_icon(&wide, small), load_icon(&wide, big)];
    anyhow::ensure!(loaded.iter().all(|handle| *handle != 0), "Couldn't load the icon {}", path.display());
    Ok(*WARP.get_or_init(|| loaded))
}

fn load_icon(wide_path: &[u16], metric: SYSTEM_METRICS_INDEX) -> isize {
    let size = system_metric(metric);
    unsafe { LoadImageW(std::ptr::null_mut(), wide_path.as_ptr(), IMAGE_ICON, size, size, LR_LOADFROMFILE) as isize }
}

fn system_metric(metric: SYSTEM_METRICS_INDEX) -> i32 {
    unsafe { GetSystemMetrics(metric) }
}

fn window_icon(hwnd: HWND, kind: u32) -> isize {
    unsafe { SendMessageW(hwnd, WM_GETICON, kind as usize, 0) }
}

fn set_icon(hwnd: HWND, kind: u32, handle: isize) {
    unsafe { SendMessageW(hwnd, WM_SETICON, kind as usize, handle) };
}
