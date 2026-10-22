//! Synchronous Tauri commands run on the webview thread, so file and database
//! work there stalls the UI. Commands that touch disk wrap their body in `run`.

use std::sync::{Mutex, MutexGuard};

pub async fn run<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|err| err.to_string())?
}

static FILES: Mutex<()> = Mutex::new(());

/// File commands used to run one after another on the webview thread. Off that thread they could
/// overlap, so a save racing a second save (or a read) of the same file is kept impossible by
/// taking this lock for the duration of each file operation. Database commands have their own lock.
pub fn files() -> MutexGuard<'static, ()> {
    FILES.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}
