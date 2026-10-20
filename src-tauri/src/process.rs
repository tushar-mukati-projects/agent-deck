use std::{
    io,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    fs,
    process::{Child, Command},
    time::{Duration, Instant},
};

use anyhow::Context;
use serde::Deserialize;
use windows_sys::Win32::{
    Foundation::{FILETIME, HANDLE, STILL_ACTIVE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{GetExitCodeProcess, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    },
};

use crate::{
    sessions::{live_dir, LiveSession},
    util::{lenient, lenient_u64, run_with_timeout},
};

const TASKKILL_TIMEOUT: Duration = Duration::from_secs(10);
const EXIT_WAIT: Duration = Duration::from_secs(5);
const EXIT_POLL: Duration = Duration::from_millis(100);
const TERMINATED_EXIT_CODE: u32 = 1;
const IMAGE_PATH_CHARS: usize = 1024;
const AGENT_IMAGES: [&str; 3] = ["claude", "node", "bun"];

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

fn open_process(pid: u32) -> Option<OwnedHandle> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    (!handle.is_null()).then(|| unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn still_active(process: &OwnedHandle) -> bool {
    let mut code = 0u32;
    let ok = unsafe { GetExitCodeProcess(process.as_raw_handle(), &raw mut code) };
    ok != 0 && code == STILL_ACTIVE as u32
}

fn image_name(process: &OwnedHandle) -> Option<String> {
    let mut buffer = [0u16; IMAGE_PATH_CHARS];
    let mut len = buffer.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(process.as_raw_handle(), 0, buffer.as_mut_ptr(), &raw mut len) };
    let image = (ok != 0).then(|| String::from_utf16_lossy(&buffer[..len as usize]).to_lowercase())?;
    Some(image.rsplit('\\').next().unwrap_or_default().to_string())
}

fn creation_time(process: &OwnedHandle) -> Option<u64> {
    let (mut created, mut exited, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    let ok = unsafe { GetProcessTimes(process.as_raw_handle(), &raw mut created, &raw mut exited, &raw mut kernel, &raw mut user) };
    (ok != 0).then(|| (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
}

fn is_agent_process(pid: u32) -> bool {
    let Some(process) = open_process(pid) else { return false };
    still_active(&process) && image_name(&process).is_none_or(|name| AGENT_IMAGES.iter().any(|agent| name.contains(agent)))
}

fn process_start(pid: u32) -> Option<u64> {
    creation_time(&open_process(pid)?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveFile {
    pid: Option<u32>,
    #[serde(default, deserialize_with = "lenient")]
    session_id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    status: Option<String>,
    #[serde(default, deserialize_with = "lenient_u64")]
    started_at: Option<u64>,
    #[serde(default, deserialize_with = "lenient")]
    proc_start: Option<String>,
}

pub fn live_sessions() -> Vec<LiveSession> {
    let Ok(entries) = fs::read_dir(live_dir()) else { return Vec::new() };
    entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| {
            let text = fs::read_to_string(e.path()).ok()?;
            let live: LiveFile = serde_json::from_str(&text).ok()?;
            let pid = live.pid?;
            is_agent_process(pid).then_some(LiveSession {
                distro: None,
                session_id: live.session_id?,
                pid,
                status: live.status,
                started_at: live.started_at,
            })
        })
        .collect()
}

fn end_process_tree(pid: u32) -> anyhow::Result<()> {
    let pid_text = pid.to_string();
    let output = run_with_timeout(Command::new("taskkill").args(["/PID", &pid_text, "/T", "/F"]), None, TASKKILL_TIMEOUT)?;
    if output.status.success() || !is_agent_process(pid) {
        return Ok(());
    }
    let reason = String::from_utf8_lossy(&output.stderr);
    anyhow::bail!("Couldn't close Claude (PID {pid}): {}", reason.trim())
}

pub fn terminate_live(session_id: &str, pid: u32) -> anyhow::Result<()> {
    let record = fs::read_to_string(live_dir().join(format!("{pid}.json"))).ok();
    let Some(record) = record.and_then(|text| serde_json::from_str::<LiveFile>(&text).ok()) else { return Ok(()) };
    if !is_agent_process(pid) {
        return Ok(());
    }
    anyhow::ensure!(record.session_id.as_deref() == Some(session_id), "PID {pid} is running a different session");
    let recorded = record.proc_start.and_then(|start| start.parse::<u64>().ok());
    anyhow::ensure!(recorded.is_some() && recorded == process_start(pid), "Couldn't confirm PID {pid} is that Claude session, so it was left running");
    end_process_tree(pid)?;
    let deadline = Instant::now() + EXIT_WAIT;
    while is_agent_process(pid) {
        anyhow::ensure!(Instant::now() < deadline, "Claude (PID {pid}) is still running");
        std::thread::sleep(EXIT_POLL);
    }
    Ok(())
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
