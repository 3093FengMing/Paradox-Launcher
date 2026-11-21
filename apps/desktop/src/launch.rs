//! Coordinate credential preparation and the permanent launch lifecycle owner.

mod controller;
mod supervision;
pub use controller::LaunchController;
use supervision::{GameExit, ProcessEvent, supervise_owned};

use std::{
    future::Future,
    panic::{AssertUnwindSafe, catch_unwind},
    path::Path,
    sync::Arc,
};

use anyhow::{Result, anyhow};
use paradox_core::{AppConfig, ElementalService, GameProfile, accounts::AccountsManager};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::{
    AppState,
    commands::{activity, java, log, profile, sdk_runtime, snapshot},
};

fn finish_credentials<T>(
    credential: Result<T>,
    cancellation: &CancellationToken,
) -> Result<Option<T>> {
    match credential {
        Err(error) if error.root_cause().to_string() == "auth.errors.cancelled" => Ok(None),
        Err(error) => Err(error),
        Ok(_) if cancellation.is_cancelled() => Ok(None),
        Ok(credential) => Ok(Some(credential)),
    }
}

async fn prepare_until_cancelled<T>(
    cancellation: &CancellationToken,
    preparation: impl Future<Output = Result<T>>,
) -> Result<Option<T>> {
    tokio::select! {
        biased;
        () = cancellation.cancelled() => Ok(None),
        result = preparation => result.map(Some),
    }
}

pub fn start(key: &str, app: tauri::AppHandle, state: &AppState) -> Result<()> {
    let controller = Arc::clone(&state.launch);
    let (guard, cancellation, stop) = controller.begin(Arc::clone(&state.busy))?;
    let config = snapshot(state).map_err(anyhow::Error::msg)?;
    let profile = profile(&config, key).map_err(anyhow::Error::msg)?;
    let managed_runtime_root = java::managed_root(state);
    let accounts = Arc::clone(&state.accounts);
    controller
        .announce_preparing(|| activity(&app, "launch", "started", "正在检查 Java 并构建启动命令"));
    tauri::async_runtime::spawn_blocking(move || {
        let result = catch_unwind(AssertUnwindSafe(|| {
            let request = GameLaunch {
                app: &app,
                config: &config,
                profile: &profile,
                managed_runtime_root: &managed_runtime_root,
                accounts: &accounts,
                controller: &controller,
                cancellation: &cancellation,
            };
            run_game(request, stop)
        }))
        .unwrap_or_else(|_| Err(anyhow!("启动工作线程异常退出")));
        guard.finish(|| report_exit(&app, result));
    });
    Ok(())
}

pub fn request_stop(app: &tauri::AppHandle, controller: &LaunchController) -> Result<()> {
    controller.request_stop(|| activity(app, "launch", "cancelling", "正在停止启动或游戏进程"))
}

enum LaunchExit {
    Cancelled,
    Exited(GameExit),
}

struct GameLaunch<'a> {
    app: &'a tauri::AppHandle,
    config: &'a AppConfig,
    profile: &'a GameProfile,
    managed_runtime_root: &'a Path,
    accounts: &'a AccountsManager,
    controller: &'a LaunchController,
    cancellation: &'a CancellationToken,
}

fn run_game(request: GameLaunch<'_>, mut stop: mpsc::Receiver<()>) -> Result<LaunchExit> {
    let GameLaunch {
        app,
        config,
        profile,
        managed_runtime_root,
        accounts,
        controller,
        cancellation,
    } = request;
    let runtime = sdk_runtime()?;
    if cancellation.is_cancelled() {
        return Ok(LaunchExit::Cancelled);
    }
    let effective = profile.effective_settings(&config.settings)?;
    let service = ElementalService::new(&effective)?;
    // Refresh persists rotating credentials cooperatively before returning.
    // Dropping that future at cancellation could lose the replacement token.
    let credential =
        runtime.block_on(accounts.selected_credential(&effective.network, cancellation));
    let Some(credential) = finish_credentials(credential, cancellation)? else {
        return Ok(LaunchExit::Cancelled);
    };
    let secret = credential
        .as_ref()
        .map(|credential| credential.access_token.clone());
    let result = (|| {
        let prepared = runtime.block_on(prepare_until_cancelled(
            cancellation,
            service.prepare_authenticated_launch(
                profile,
                &effective,
                managed_runtime_root,
                credential,
            ),
        ))?;
        let Some(prepared) = prepared else {
            return Ok(LaunchExit::Cancelled);
        };
        let process = {
            let _entered = runtime.enter();
            controller.spawn_if_active(|| prepared.spawn())?
        };
        let Some(mut process) = process else {
            return Ok(LaunchExit::Cancelled);
        };
        supervise_owned(
            &runtime,
            controller,
            &mut process.child,
            &mut process.lines,
            &mut stop,
            |line| &line.line,
            |event| match event {
                ProcessEvent::Running => {
                    controller.announce_running(|| {
                        activity(
                            app,
                            "launch",
                            "running",
                            &format!("{} 已启动", profile.name),
                        )
                    });
                }
                ProcessEvent::StopFailed => controller
                    .stop_failed(|| activity(app, "launch", "running", "停止游戏失败，请重试")),
                ProcessEvent::Log(level, message) => {
                    log(app, level, &redact(message, secret.as_deref()))
                }
            },
        )
        .map(LaunchExit::Exited)
    })();
    redact_failure(result, secret.as_deref())
}

fn redact(line: &str, secret: Option<&str>) -> String {
    match secret {
        Some(token) if !token.is_empty() => line.replace(token, "[REDACTED]"),
        _ => line.to_owned(),
    }
}

fn redact_failure<T>(result: Result<T>, secret: Option<&str>) -> Result<T> {
    result.map_err(|error| anyhow!(redact(&format!("{error:#}"), secret)))
}

fn report_exit(app: &tauri::AppHandle, result: Result<LaunchExit>) {
    match result {
        Ok(LaunchExit::Cancelled) => activity(app, "launch", "finished", "启动已取消"),
        Ok(LaunchExit::Exited(exit)) if exit.stopped => {
            activity(app, "launch", "finished", "游戏已停止")
        }
        Ok(LaunchExit::Exited(exit)) => activity(
            app,
            "launch",
            if exit.status.success() {
                "finished"
            } else {
                "error"
            },
            &format!("游戏进程已退出：{}", exit.status),
        ),
        Err(error) => activity(
            app,
            "launch",
            "error",
            &format!("启动或等待游戏进程失败：{error:#}"),
        ),
    }
}

#[cfg(test)]
mod tests;
