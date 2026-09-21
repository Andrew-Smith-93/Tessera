use std::path::{Path, PathBuf};

pub const PROTOCOL_NAMESPACE: &str = "tessera.ipc";
pub const PROTOCOL_MAJOR_VERSION: u32 = 1;
pub const PROTOCOL_MINOR_VERSION: u32 = 0;
pub const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

// Resource limits matching Protocol V1 specification
pub const MAX_FRAME_SIZE: usize = 1_048_576; // 1 MiB
pub const MAX_BUFFERED_BYTES: usize = 2_097_152; // 2 MiB
pub const MAX_NESTING_DEPTH: usize = 32;
pub const MAX_STRING_LENGTH: usize = 65_536;
pub const MAX_ARRAY_LENGTH: usize = 10_000;
pub const MAX_QUEUE_LENGTH: usize = 1_000;
pub const MAX_OUTSTANDING_REQUESTS: usize = 1_000;
pub const MAX_SUBSCRIPTION_COUNT: usize = 100;
pub const MAX_IDEMPOTENCY_CACHE_SIZE: usize = 1_000;

// Timeout limits
pub const HANDSHAKE_TIMEOUT_SECS: u64 = 5;
pub const READ_TIMEOUT_SECS: u64 = 30;
pub const WRITE_TIMEOUT_SECS: u64 = 5;
pub const MAX_CONCURRENT_CONNECTIONS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliMode {
    Run,
    Check,
    PrintProtocol,
    Help,
    Version,
}

#[derive(Debug, Clone)]
pub struct DaemonConfig {
    pub mode: CliMode,
    pub socket_path: PathBuf,
}

impl DaemonConfig {
    pub fn parse_from_args<I, T>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = T>,
        T: Into<String>,
    {
        let args_vec: Vec<String> = args.into_iter().map(Into::into).collect();
        let mut mode = CliMode::Run;
        let mut custom_socket: Option<PathBuf> = None;

        let mut i = 1;
        while i < args_vec.len() {
            match args_vec[i].as_str() {
                "--help" | "-h" => {
                    return Ok(DaemonConfig {
                        mode: CliMode::Help,
                        socket_path: PathBuf::new(),
                    })
                }
                "--version" | "-V" => {
                    return Ok(DaemonConfig {
                        mode: CliMode::Version,
                        socket_path: PathBuf::new(),
                    })
                }
                "--check" => {
                    mode = CliMode::Check;
                    i += 1;
                }
                "--print-protocol" => {
                    mode = CliMode::PrintProtocol;
                    i += 1;
                }
                "--socket" => {
                    if i + 1 >= args_vec.len() {
                        return Err("--socket requires a path argument".to_string());
                    }
                    let p = PathBuf::from(&args_vec[i + 1]);
                    Self::validate_socket_path(&p)?;
                    custom_socket = Some(p);
                    i += 2;
                }
                other => {
                    return Err(format!("Unknown option: {}", other));
                }
            }
        }

        let socket_path = match custom_socket {
            Some(p) => p,
            None => Self::default_socket_path()?,
        };

        Ok(DaemonConfig { mode, socket_path })
    }

    pub fn default_socket_path() -> Result<PathBuf, String> {
        let runtime_dir = std::env::var("XDG_RUNTIME_DIR").map_err(|_| {
            "XDG_RUNTIME_DIR is not set. Refusing to default to /tmp for socket placement."
                .to_string()
        })?;

        if runtime_dir.trim().is_empty() {
            return Err(
                "XDG_RUNTIME_DIR is empty. Refusing to default to /tmp for socket placement."
                    .to_string(),
            );
        }

        let path = PathBuf::from(runtime_dir)
            .join("tessera")
            .join("tessera.sock");
        Self::validate_socket_path(&path)?;
        Ok(path)
    }

    pub fn validate_socket_path(path: &Path) -> Result<(), String> {
        if !path.is_absolute() {
            return Err(format!("Socket path must be absolute: {}", path.display()));
        }

        // Refuse /tmp or direct paths under /tmp
        if path.starts_with("/tmp") {
            return Err(format!(
                "Socket path {} is in /tmp, which is disallowed for security reasons. Use XDG_RUNTIME_DIR.",
                path.display()
            ));
        }

        // Refuse path traversal (e.g. "..")
        for comp in path.components() {
            if let std::path::Component::ParentDir = comp {
                return Err(format!(
                    "Socket path must not contain parent directory traversal ('..'): {}",
                    path.display()
                ));
            }
        }

        Ok(())
    }
}
