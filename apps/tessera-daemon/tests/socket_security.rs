use std::fs::{self, File, Permissions};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use tempfile::tempdir;
use tessera_daemon::config::DaemonConfig;
use tessera_daemon::security::{
    cleanup_socket, get_current_uid, prepare_runtime_directory, prepare_socket_path,
    secure_socket_permissions,
};

#[test]
fn test_prepare_runtime_directory_creates_0700() {
    let tmp = tempdir().unwrap();
    let runtime_dir = tmp.path().join("secure_dir");

    prepare_runtime_directory(&runtime_dir).expect("Failed to prepare directory");

    let meta = fs::metadata(&runtime_dir).unwrap();
    let mode = meta.permissions().mode() & 0o777;
    assert_eq!(mode, 0o700, "Directory must have mode 0700");
    assert_eq!(meta.uid(), get_current_uid());
}

#[test]
fn test_prepare_runtime_directory_rejects_insecure_permissions() {
    let tmp = tempdir().unwrap();
    let runtime_dir = tmp.path().join("insecure_dir");
    fs::create_dir(&runtime_dir).unwrap();

    // Set group/world writable
    fs::set_permissions(&runtime_dir, Permissions::from_mode(0o777)).unwrap();

    // prepare_runtime_directory will tighten it to 0700 if owned by user
    prepare_runtime_directory(&runtime_dir).unwrap();
    let mode = fs::metadata(&runtime_dir).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o700);
}

#[test]
fn test_socket_mode_is_0600() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("test.sock");

    let listener = UnixListener::bind(&socket_path).unwrap();
    secure_socket_permissions(&socket_path).expect("Failed to set 0600 on socket");

    let meta = fs::metadata(&socket_path).unwrap();
    let mode = meta.permissions().mode() & 0o777;
    assert_eq!(mode, 0o600, "Socket must have mode 0600");
    drop(listener);
}

#[test]
fn test_symlink_socket_path_rejected() {
    let tmp = tempdir().unwrap();
    let real_file = tmp.path().join("real_target");
    File::create(&real_file).unwrap();

    let symlink_socket = tmp.path().join("symlink.sock");
    std::os::unix::fs::symlink(&real_file, &symlink_socket).unwrap();

    let err = prepare_socket_path(&symlink_socket).unwrap_err();
    assert!(err.0.contains("symlink"));
}

#[test]
fn test_stale_owned_socket_cleaned_up() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("stale.sock");

    // Bind and close listener to simulate inactive stale socket
    let listener = UnixListener::bind(&socket_path).unwrap();
    drop(listener);
    assert!(socket_path.exists());

    // prepare_socket_path should detect inactive stale socket and remove it safely
    prepare_socket_path(&socket_path).expect("Stale socket cleanup failed");
    assert!(
        !socket_path.exists(),
        "Stale socket should have been deleted"
    );
}

#[test]
fn test_second_instance_rejected_if_active() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("active.sock");

    // Keep active listener alive
    let _active_listener = UnixListener::bind(&socket_path).unwrap();

    // Second instance attempting to prepare same path should fail with single-instance error
    let err = prepare_socket_path(&socket_path).unwrap_err();
    assert!(
        err.0
            .contains("Another active daemon instance is already listening"),
        "Unexpected error: {}",
        err.0
    );
}

#[test]
fn test_cleanup_socket_removes_socket() {
    let tmp = tempdir().unwrap();
    let socket_path = tmp.path().join("cleanup.sock");

    let _listener = UnixListener::bind(&socket_path).unwrap();
    assert!(socket_path.exists());

    cleanup_socket(&socket_path);
    assert!(!socket_path.exists());
}

#[test]
fn test_socket_path_validation_refuses_tmp_and_traversal() {
    assert!(DaemonConfig::validate_socket_path(&PathBuf::from("/tmp/tessera.sock")).is_err());
    assert!(
        DaemonConfig::validate_socket_path(&PathBuf::from("/run/user/1000/../tessera.sock"))
            .is_err()
    );
    assert!(DaemonConfig::validate_socket_path(&PathBuf::from("relative/tessera.sock")).is_err());
}
