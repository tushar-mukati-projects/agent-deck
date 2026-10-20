use std::{
    io,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    process::Child,
};

use anyhow::Context;
use windows_sys::Win32::{
    Foundation::HANDLE,
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

const TERMINATED_EXIT_CODE: u32 = 1;

struct Job {
    handle: OwnedHandle,
}

impl Job {
    fn for_child(child: &Child) -> anyhow::Result<Self> {
        let job = Self { handle: create_job().context("Couldn't create a job object")? };
        kill_on_close(job.raw()).context("Couldn't set up the job object")?;
        assign_process(job.raw(), child.as_raw_handle()).context("Couldn't add the process to its job object")?;
        Ok(job)
    }

    fn raw(&self) -> HANDLE {
        self.handle.as_raw_handle()
    }

    fn terminate(&self) -> anyhow::Result<()> {
        terminate_job(self.raw()).context("Couldn't stop the processes in the job object")
    }
}

fn win32_result(ok: i32) -> io::Result<()> {
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn create_job() -> io::Result<OwnedHandle> {
    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if handle.is_null() {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn kill_on_close(job: HANDLE) -> io::Result<()> {
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let size = size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
    win32_result(unsafe { SetInformationJobObject(job, JobObjectExtendedLimitInformation, (&raw const info).cast(), size) })
}

fn assign_process(job: HANDLE, process: HANDLE) -> io::Result<()> {
    win32_result(unsafe { AssignProcessToJobObject(job, process) })
}

fn terminate_job(job: HANDLE) -> io::Result<()> {
    win32_result(unsafe { TerminateJobObject(job, TERMINATED_EXIT_CODE) })
}

pub struct Managed {
    pub child: parking_lot::Mutex<Child>,
    job: Job,
}

impl Managed {
    pub fn new(mut child: Child) -> anyhow::Result<Self> {
        match Job::for_child(&child) {
            Ok(job) => Ok(Self { child: parking_lot::Mutex::new(child), job }),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(error)
            }
        }
    }

    pub fn running(&self) -> bool {
        self.child.lock().try_wait().map(|s| s.is_none()).unwrap_or(false)
    }

    pub fn stop(&self) -> anyhow::Result<()> {
        let terminated = self.job.terminate();
        let mut child = self.child.lock();
        let _ = child.kill();
        let _ = child.wait();
        terminated
    }
}

impl Drop for Managed {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    use windows_sys::Win32::System::JobObjects::{
        JobObjectBasicAccountingInformation, QueryInformationJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    };

    const WAIT_LIMIT: Duration = Duration::from_secs(10);
    const POLL_GAP: Duration = Duration::from_millis(20);

    fn active_processes(job: &Job) -> u32 {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        let size = size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32;
        let ok = unsafe { QueryInformationJobObject(job.raw(), JobObjectBasicAccountingInformation, (&raw mut info).cast(), size, std::ptr::null_mut()) };
        win32_result(ok).unwrap();
        info.ActiveProcesses
    }

    fn wait_for(job: &Job, count: u32) {
        let deadline = Instant::now() + WAIT_LIMIT;
        while active_processes(job) != count {
            assert!(Instant::now() < deadline, "the job never reached {count} processes");
            std::thread::sleep(POLL_GAP);
        }
    }

    #[test]
    fn stopping_kills_grandchildren() {
        let child = Command::new("cmd").args(["/c", "ping -n 30 127.0.0.1 > nul"]).stdout(Stdio::null()).spawn().unwrap();
        let managed = Managed::new(child).unwrap();
        wait_for(&managed.job, 2);
        assert!(managed.running());
        managed.stop().unwrap();
        assert!(!managed.running());
        wait_for(&managed.job, 0);
    }
}
