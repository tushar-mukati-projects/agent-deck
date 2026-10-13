use std::path::PathBuf;

use base64::Engine;
use tauri::Manager;

const TITLE: &str = "Warp";

pub fn apply(window: &tauri::WebviewWindow, enabled: bool) -> anyhow::Result<Option<String>> {
    let icon = if enabled { warp_icon() } else { None };
    let title = if enabled { TITLE.to_string() } else { window.app_handle().package_info().name.clone() };
    window.set_title(&title)?;
    set_window_icon(window.hwnd()?.0, icon.as_deref());
    let Some(path) = icon else { return Ok(None) };
    Ok(Some(format!("data:image/x-icon;base64,{}", base64::engine::general_purpose::STANDARD.encode(std::fs::read(path)?))))
}

fn warp_icon() -> Option<PathBuf> {
    let program_files = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let user_programs = dirs::data_local_dir().map(|dir| dir.join("Programs"));
    [program_files, user_programs].into_iter().flatten().map(|dir| dir.join("Warp").join("icon.ico")).find(|path| path.is_file())
}

fn set_window_icon(hwnd: *mut std::ffi::c_void, icon: Option<&std::path::Path>) {
    use std::{os::windows::ffi::OsStrExt, sync::OnceLock};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_LOADFROMFILE, SM_CXICON, SM_CXSMICON, WM_GETICON, WM_SETICON,
    };

    static ORIGINAL: OnceLock<[isize; 2]> = OnceLock::new();
    static WARP: OnceLock<[isize; 2]> = OnceLock::new();
    let slots = [(ICON_SMALL, SM_CXSMICON), (ICON_BIG, SM_CXICON)];
    let original = *ORIGINAL.get_or_init(|| slots.map(|(kind, _)| unsafe { SendMessageW(hwnd, WM_GETICON, kind as usize, 0) }));
    let handles = match icon {
        Some(path) => *WARP.get_or_init(|| {
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
            slots.map(|(_, metric)| unsafe {
                let size = GetSystemMetrics(metric);
                LoadImageW(std::ptr::null_mut(), wide.as_ptr(), IMAGE_ICON, size, size, LR_LOADFROMFILE) as isize
            })
        }),
        None => original,
    };
    for ((kind, _), handle) in slots.into_iter().zip(handles) {
        unsafe { SendMessageW(hwnd, WM_SETICON, kind as usize, handle) };
    }
}
