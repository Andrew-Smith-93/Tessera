use std::sync::Arc;
use std::time::Duration;
use tempfile::tempdir;
use tessera_daemon::backend::DisconnectedBackend;
use tessera_daemon::server::DaemonServer;
use tessera_daemon::shutdown::ShutdownCoordinator;
use tokio::net::UnixStream;
use tokio::time::sleep;

#[tokio::test]
async fn test_graceful_shutdown_cleans_up_socket() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("tessera_test_shutdown.sock");

    let shutdown = ShutdownCoordinator::new();
    let backend = Arc::new(DisconnectedBackend);

    let server = DaemonServer::new(socket_path.clone(), backend, shutdown.clone())
        .expect("Server initialization failed");

    let server_handle = tokio::spawn(async move {
        server.run().await.expect("Server run error");
    });

    // Wait for server to bind and listen
    let mut connected = false;
    for _ in 0..50 {
        if UnixStream::connect(&socket_path).await.is_ok() {
            connected = true;
            break;
        }
        sleep(Duration::from_millis(20)).await;
    }
    assert!(connected, "Failed to connect to daemon server socket");
    assert!(socket_path.exists());

    // Trigger shutdown
    shutdown.trigger();

    // Await server exit
    tokio::time::timeout(Duration::from_secs(3), server_handle)
        .await
        .expect("Server timed out while shutting down")
        .expect("Server task panicked");

    // Verify socket is cleanly unlinked
    assert!(
        !socket_path.exists(),
        "Socket should be deleted upon clean shutdown"
    );
}
