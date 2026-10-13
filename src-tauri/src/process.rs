use std::process::Child;

pub struct Job {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    pub fn for_child(child: &Child) -> Self {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if !handle.is_null() {
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                AssignProcessToJobObject(handle, child.as_raw_handle() as _);
            }
            Self { handle }
        }
    }

    pub fn terminate(&self) {
        if !self.handle.is_null() {
            unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.handle, 1) };
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { windows_sys::Win32::Foundation::CloseHandle(self.handle) };
        }
    }
}

pub struct Managed {
    pub child: parking_lot::Mutex<Child>,
    job: Job,
}

impl Managed {
    pub fn new(child: Child) -> Self {
        let job = Job::for_child(&child);
        Self { child: parking_lot::Mutex::new(child), job }
    }

    pub fn running(&self) -> bool {
        self.child.lock().try_wait().map(|s| s.is_none()).unwrap_or(false)
    }

    pub fn stop(&self) {
        self.job.terminate();
        let mut child = self.child.lock();
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Drop for Managed {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    fn pings() -> usize {
        let out = Command::new("tasklist").args(["/fi", "imagename eq PING.EXE", "/fo", "csv", "/nh"]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).matches("PING.EXE").count()
    }

    #[test]
    fn stopping_kills_grandchildren() {
        let before = pings();
        let child = Command::new("cmd").args(["/c", "ping -n 30 127.0.0.1 > nul"]).stdout(Stdio::null()).spawn().unwrap();
        let managed = Managed::new(child);
        std::thread::sleep(std::time::Duration::from_millis(800));
        assert!(managed.running());
        assert_eq!(pings(), before + 1);
        managed.stop();
        assert!(!managed.running());
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert_eq!(pings(), before);
    }
}
