use std::fs::{self, DirBuilder, Permissions};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityError(pub String);

impl std::fmt::Display for SecurityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Security error: {}", self.0)
    }
}

impl std::error::Error for SecurityError {}

pub fn get_current_uid() -> u32 {
    unsafe { libc::getuid() }
}

/// Prepares and verifies runtime directory permissions (0700) and ownership.
pub fn prepare_runtime_directory(dir: &Path) -> Result<(), SecurityError> {
    if !dir.exists() {
        let mut builder = DirBuilder::new();
        builder.recursive(true);
        builder.mode(0o700);
        builder.create(dir).map_err(|e| {
            SecurityError(format!(
                "Failed to create runtime directory {}: {}",
                dir.display(),
                e
            ))
        })?;
    }

    let meta = fs::symlink_metadata(dir).map_err(|e| {
        SecurityError(format!(
            "Failed to query runtime directory {}: {}",
            dir.display(),
            e
        ))
    })?;

    if meta.file_type().is_symlink() {
        return Err(SecurityError(format!(
            "Runtime directory must not be a symlink: {}",
            dir.display()
        )));
    }

    if !meta.is_dir() {
        return Err(SecurityError(format!(
            "Runtime path is not a directory: {}",
            dir.display()
        )));
    }

    let current_uid = get_current_uid();
    if meta.uid() != current_uid {
        return Err(SecurityError(format!(
            "Runtime directory {} is owned by UID {}, expected current UID {}",
            dir.display(),
            meta.uid(),
            current_uid
        )));
    }

    let mode = meta.permissions().mode() & 0o777;
    // Disallow group or world permissions (must be strictly 0700)
    if (mode & 0o077) != 0 {
        // Attempt to tighten permissions to 0700 if currently owned by user
        let _ = fs::set_permissions(dir, Permissions::from_mode(0o700));
        let updated_meta = fs::metadata(dir).map_err(|e| SecurityError(e.to_string()))?;
        let updated_mode = updated_meta.permissions().mode() & 0o777;
        if (updated_mode & 0o077) != 0 {
            return Err(SecurityError(format!(
                "Runtime directory {} has insecure permissions {:o} (must be 0700, no group/world access)",
                dir.display(),
                mode
            )));
        }
    }

    Ok(())
}

/// Verifies socket path security and cleans up stale owned sockets.
pub fn prepare_socket_path(socket_path: &Path) -> Result<(), SecurityError> {
    let parent = socket_path
        .parent()
        .ok_or_else(|| SecurityError("Socket path has no parent directory".to_string()))?;

    prepare_runtime_directory(parent)?;

    // Inspect existing socket if present
    if let Ok(meta) = fs::symlink_metadata(socket_path) {
        if meta.file_type().is_symlink() {
            return Err(SecurityError(format!(
                "Socket path {} is a symlink. Refusing to use or delete.",
                socket_path.display()
            )));
        }

        let current_uid = get_current_uid();
        if meta.uid() != current_uid {
            return Err(SecurityError(format!(
                "Socket file {} is owned by UID {}, refusing to remove foreign socket",
                socket_path.display(),
                meta.uid()
            )));
        }

        // Check if an active daemon instance is currently responding
        match UnixStream::connect(socket_path) {
            Ok(_) => {
                return Err(SecurityError(format!(
                    "Another active daemon instance is already listening on {}",
                    socket_path.display()
                )));
            }
            Err(e) => {
                // ConnectionRefused or NotFound indicates a stale socket from previous crash
                if e.kind() == std::io::ErrorKind::ConnectionRefused
                    || e.kind() == std::io::ErrorKind::NotFound
                {
                    fs::remove_file(socket_path).map_err(|rem_err| {
                        SecurityError(format!(
                            "Failed to remove stale socket {}: {}",
                            socket_path.display(),
                            rem_err
                        ))
                    })?;
                } else {
                    return Err(SecurityError(format!(
                        "Error checking existing socket {}: {}",
                        socket_path.display(),
                        e
                    )));
                }
            }
        }
    }

    Ok(())
}

/// Tightens socket permissions to owner-only (0600) upon creation.
pub fn secure_socket_permissions(socket_path: &Path) -> Result<(), SecurityError> {
    fs::set_permissions(socket_path, Permissions::from_mode(0o600)).map_err(|e| {
        SecurityError(format!(
            "Failed to set mode 0600 on socket {}: {}",
            socket_path.display(),
            e
        ))
    })?;

    let meta = fs::metadata(socket_path).map_err(|e| {
        SecurityError(format!(
            "Failed to stat socket {}: {}",
            socket_path.display(),
            e
        ))
    })?;

    let current_uid = get_current_uid();
    if meta.uid() != current_uid {
        return Err(SecurityError(format!(
            "Socket {} UID mismatch: owned by {}, current UID {}",
            socket_path.display(),
            meta.uid(),
            current_uid
        )));
    }

    Ok(())
}

/// Safely removes socket on clean shutdown.
pub fn cleanup_socket(socket_path: &Path) {
    if let Ok(meta) = fs::symlink_metadata(socket_path) {
        if !meta.file_type().is_symlink() && meta.uid() == get_current_uid() {
            let _ = fs::remove_file(socket_path);
        }
    }
}
