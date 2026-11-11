use std::{
    collections::HashMap,
    io,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle},
    sync::Mutex,
    time::Duration,
};

use tokio::process::Child;
use windows_sys::Win32::{
    Foundation::{ERROR_MORE_DATA, FILETIME, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
            JOBOBJECT_BASIC_PROCESS_ID_LIST, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JobObjectBasicAccountingInformation, JobObjectBasicProcessIdList,
            JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
            TerminateJobObject,
        },
        Threading::{
            GetProcessTimes, INFINITE, OpenProcess, OpenThread, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_SYNCHRONIZE, ResumeThread, THREAD_SUSPEND_RESUME, WaitForSingleObject,
        },
    },
};

pub(super) struct ProcessJob {
    handle: OwnedHandle,
    members: Mutex<HashMap<(u32, u64), OwnedHandle>>,
}

impl ProcessJob {
    pub(super) fn new() -> io::Result<Self> {
        // No inheritable security attributes: only this owner retains the job
        // handle, so a child cannot keep KILL_ON_JOB_CLOSE alive after Drop.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        let handle = own_handle(handle)?;
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let success = unsafe {
            SetInformationJobObject(
                handle.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if success == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            handle,
            members: Mutex::new(HashMap::new()),
        })
    }

    pub(super) fn assign_and_resume(&self, child: &Child, pid: u32) -> io::Result<()> {
        let process = child
            .raw_handle()
            .ok_or_else(|| io::Error::other("新进程没有可用句柄"))?;
        let success = unsafe { AssignProcessToJobObject(self.handle.as_raw_handle(), process) };
        if success == 0 {
            return Err(io::Error::last_os_error());
        }
        // CREATE_SUSPENDED guarantees the selected executable cannot spawn
        // descendants before membership is established. Its primary thread is
        // the sole thread at this point; std/Tokio already closed hThread.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        let snapshot = own_handle(snapshot)?;
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut found = unsafe { Thread32First(snapshot.as_raw_handle(), &mut entry) };
        while found != 0 {
            if entry.th32OwnerProcessID == pid {
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                let thread = own_handle(thread)?;
                let previous = unsafe { ResumeThread(thread.as_raw_handle()) };
                if previous == u32::MAX {
                    return Err(io::Error::last_os_error());
                }
                if previous != 1 {
                    return Err(io::Error::other("Java 主线程的挂起状态无效"));
                }
                return Ok(());
            }
            found = unsafe { Thread32Next(snapshot.as_raw_handle(), &mut entry) };
        }
        Err(io::Error::other("无法找到已挂起的 Java 主线程"))
    }

    pub(super) fn active_processes(&self) -> io::Result<u32> {
        self.capture_members()?;
        let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        let success = unsafe {
            QueryInformationJobObject(
                self.handle.as_raw_handle(),
                JobObjectBasicAccountingInformation,
                (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                std::ptr::null_mut(),
            )
        };
        if success == 0 {
            return Err(io::Error::last_os_error());
        }
        if accounting.ActiveProcesses == 0 {
            // Accounting can reach zero during termination before process
            // handles become signaled. Wait on retained member handles too.
            let members = self
                .members
                .lock()
                .map_err(|_| io::Error::other("进程句柄记录不可用"))?;
            for handle in members.values() {
                wait_process(handle.as_raw_handle());
            }
        }
        Ok(accounting.ActiveProcesses)
    }

    pub(super) fn terminate(&self) -> io::Result<()> {
        let captured = self.capture_members();
        if unsafe { TerminateJobObject(self.handle.as_raw_handle(), 1) } == 0 {
            return Err(io::Error::last_os_error());
        }
        captured
    }

    pub(super) fn wait_empty_blocking(&self) {
        while self.active_processes().is_ok_and(|count| count > 0) {
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn capture_members(&self) -> io::Result<()> {
        let mut capacity = 128;
        let ids = loop {
            let byte_size = 8 + capacity * std::mem::size_of::<usize>();
            let mut buffer = vec![0_usize; byte_size.div_ceil(std::mem::size_of::<usize>())];
            let success = unsafe {
                QueryInformationJobObject(
                    self.handle.as_raw_handle(),
                    JobObjectBasicProcessIdList,
                    buffer.as_mut_ptr().cast(),
                    byte_size as u32,
                    std::ptr::null_mut(),
                )
            };
            if success == 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(ERROR_MORE_DATA as i32) && capacity < 1024 * 1024 {
                    capacity *= 2;
                    continue;
                }
                return Err(error);
            }
            let header = unsafe { &*buffer.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() };
            let count = header.NumberOfProcessIdsInList as usize;
            if count > capacity {
                return Err(io::Error::other("Job 进程列表大小无效"));
            }
            // The variable-length list starts after two u32 header fields. The
            // usize allocation supplies the correct native pointer alignment.
            let ids = unsafe {
                std::slice::from_raw_parts(
                    buffer.as_ptr().cast::<u8>().add(8).cast::<usize>(),
                    count,
                )
            }
            .to_vec();
            break ids;
        };
        let mut members = self
            .members
            .lock()
            .map_err(|_| io::Error::other("进程句柄记录不可用"))?;
        members.retain(|_, handle| unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) } != windows_sys::Win32::Foundation::WAIT_OBJECT_0);
        for pid in ids {
            let handle = unsafe {
                OpenProcess(
                    PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                    0,
                    pid as u32,
                )
            };
            if handle.is_null() {
                continue;
            } // This member may already have exited.
            let handle = own_handle(handle)?;
            let mut belongs = 0;
            if unsafe {
                IsProcessInJob(
                    handle.as_raw_handle(),
                    self.handle.as_raw_handle(),
                    &mut belongs,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            if belongs == 0 {
                continue;
            } // Avoid retaining an unrelated reused PID.
            let mut creation = FILETIME::default();
            let mut exit = FILETIME::default();
            let mut kernel = FILETIME::default();
            let mut user = FILETIME::default();
            if unsafe {
                GetProcessTimes(
                    handle.as_raw_handle(),
                    &mut creation,
                    &mut exit,
                    &mut kernel,
                    &mut user,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            let created =
                (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
            members.entry((pid as u32, created)).or_insert(handle);
        }
        Ok(())
    }
}

fn own_handle(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    // Each call passes a newly created handle; OwnedHandle closes it exactly once.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

pub(super) fn wait_process(handle: RawHandle) {
    // A live Tokio Child retains this borrowed process handle through the wait.
    unsafe {
        WaitForSingleObject(handle, INFINITE);
    }
}
