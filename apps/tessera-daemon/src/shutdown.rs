use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::watch;

pub struct ShutdownCoordinator {
    is_shutting_down: AtomicBool,
    tx: watch::Sender<bool>,
    rx: watch::Receiver<bool>,
}

impl ShutdownCoordinator {
    pub fn new() -> Arc<Self> {
        let (tx, rx) = watch::channel(false);
        Arc::new(ShutdownCoordinator {
            is_shutting_down: AtomicBool::new(false),
            tx,
            rx,
        })
    }

    pub fn is_shutting_down(&self) -> bool {
        self.is_shutting_down.load(Ordering::SeqCst)
    }

    pub fn subscribe(&self) -> watch::Receiver<bool> {
        self.rx.clone()
    }

    pub fn trigger(&self) {
        if !self.is_shutting_down.swap(true, Ordering::SeqCst) {
            let _ = self.tx.send(true);
        }
    }
}

pub async fn wait_for_signal(coordinator: Arc<ShutdownCoordinator>) {
    let mut sigterm = match signal(SignalKind::terminate()) {
        Ok(s) => Some(s),
        Err(e) => {
            eprintln!("Warning: failed to register SIGTERM handler: {}", e);
            None
        }
    };

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            // SIGINT received
        }
        _ = async {
            if let Some(ref mut s) = sigterm {
                s.recv().await;
            } else {
                std::future::pending::<()>().await;
            }
        } => {
            // SIGTERM received
        }
    }

    coordinator.trigger();
}
