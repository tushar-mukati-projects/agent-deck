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
        DestroyIcon, GetSystemMetrics, LoadImageW, SendMessageW, HICON, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_LOADFROMFILE, SM_CXICON, SM_CXSMICON,
        SYSTEM_METRICS_INDEX, WM_GETICON, WM_SETICON,
    },
};

const TITLE: &str = "Warp";
const ICON_SLOTS: [(u32, SYSTEM_METRICS_INDEX); 2] = [(ICON_SMALL, SM_CXSMICON), (ICON_BIG, SM_CXICON)];

static ORIGINAL: OnceLock<[isize; 2]> = OnceLock::new();
static WARP: OnceLock<[isize; 2]> = OnceLock::new();

pub fn apply(window: &tauri::WebviewWindow, enabled: bool) -> anyhow::Result<Option<String>> {
    let icon = if enabled { warp_icon() } else { None };
    let logo = icon.as_deref().map(std::fs::read).transpose()?;
    let hwnd = window.hwnd()?.0;
    let title = if enabled { TITLE.to_string() } else { window.app_handle().package_info().name.clone() };
    window.set_title(&title)?;
    set_window_icon(hwnd, icon.as_deref());
    Ok(logo.map(|bytes| format!("data:image/x-icon;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))))
}

fn warp_icon() -> Option<PathBuf> {
    let program_files = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let user_programs = dirs::data_local_dir().map(|dir| dir.join("Programs"));
    [program_files, user_programs].into_iter().flatten().map(|dir| dir.join("Warp").join("icon.ico")).find(|path| path.is_file())
}

fn set_window_icon(hwnd: HWND, icon: Option<&Path>) {
    let original = *ORIGINAL.get_or_init(|| ICON_SLOTS.map(|(kind, _)| window_icon(hwnd, kind)));
    let handles = icon.and_then(warp_handles).unwrap_or(original);
    for ((kind, _), handle) in ICON_SLOTS.into_iter().zip(handles) {
        set_icon(hwnd, kind, handle);
    }
}

fn warp_handles(path: &Path) -> Option<[isize; 2]> {
    if let Some(handles) = WARP.get() {
        return Some(*handles);
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    let [small, big] = ICON_SLOTS.map(|(_, metric)| LoadedIcon::load(&wide, metric));
    let (Some(small), Some(big)) = (small, big) else {
        return None;
    };
    Some(*WARP.get_or_init(|| [small.into_raw(), big.into_raw()]))
}

struct LoadedIcon(isize);

impl LoadedIcon {
    fn load(wide_path: &[u16], metric: SYSTEM_METRICS_INDEX) -> Option<Self> {
        let size = system_metric(metric);
        let handle = unsafe { LoadImageW(std::ptr::null_mut(), wide_path.as_ptr(), IMAGE_ICON, size, size, LR_LOADFROMFILE) as isize };
        (handle != 0).then_some(Self(handle))
    }

    fn into_raw(self) -> isize {
        let handle = self.0;
        std::mem::forget(self);
        handle
    }
}

impl Drop for LoadedIcon {
    fn drop(&mut self) {
        let _ = unsafe { DestroyIcon(self.0 as HICON) };
    }
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
