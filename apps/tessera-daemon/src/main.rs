use std::sync::Arc;
use tessera_daemon::backend::DisconnectedBackend;
use tessera_daemon::config::{CliMode, DaemonConfig, DAEMON_VERSION};
use tessera_daemon::diagnostics::print_protocol_summary;
use tessera_daemon::schema::CompiledSchemas;
use tessera_daemon::security::prepare_runtime_directory;
use tessera_daemon::server::DaemonServer;
use tessera_daemon::shutdown::{wait_for_signal, ShutdownCoordinator};

#[tokio::main]
async fn main() {
    let config = match DaemonConfig::parse_from_args(std::env::args()) {
        Ok(cfg) => cfg,
        Err(err) => {
            eprintln!("Error: {}", err);
            eprintln!("Run 'tessera-daemon --help' for usage instructions.");
            std::process::exit(1);
        }
    };

    match config.mode {
        CliMode::Help => {
            print_help();
            std::process::exit(0);
        }
        CliMode::Version => {
            println!("tessera-daemon {}", DAEMON_VERSION);
            std::process::exit(0);
        }
        CliMode::PrintProtocol => {
            print_protocol_summary(0);
            std::process::exit(0);
        }
        CliMode::Check => {
            if let Err(e) = run_check(&config) {
                eprintln!("Check failed: {}", e);
                std::process::exit(1);
            }
            println!(
                "Configuration, canonical schemas, and runtime directory security checks passed."
            );
            std::process::exit(0);
        }
        CliMode::Run => {
            let shutdown_coord = ShutdownCoordinator::new();
            let shutdown_clone = shutdown_coord.clone();

            tokio::spawn(async move {
                wait_for_signal(shutdown_clone).await;
            });

            let backend = Arc::new(DisconnectedBackend);
            let server =
                match DaemonServer::new(config.socket_path.clone(), backend, shutdown_coord) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("Failed to initialize daemon server: {}", e);
                        std::process::exit(1);
                    }
                };

            println!(
                "tessera-daemon v{} listening on {} (mode: disconnected)",
                DAEMON_VERSION,
                config.socket_path.display()
            );

            if let Err(e) = server.run().await {
                eprintln!("Server error: {}", e);
                std::process::exit(1);
            }
        }
    }
}

fn run_check(config: &DaemonConfig) -> Result<(), String> {
    // 1. Verify schema compilation
    CompiledSchemas::compile().map_err(|e| format!("Schema validation failure: {}", e))?;

    // 2. Verify runtime directory
    let parent = config
        .socket_path
        .parent()
        .ok_or_else(|| "Invalid socket path parent directory".to_string())?;
    prepare_runtime_directory(parent).map_err(|e| e.to_string())?;

    Ok(())
}

fn print_help() {
    println!("tessera-daemon v{}", DAEMON_VERSION);
    println!("Optional companion daemon for Tessera KWin tiling window manager");
    println!();
    println!("USAGE:");
    println!("  tessera-daemon [OPTIONS]");
    println!();
    println!("OPTIONS:");
    println!("  --socket <PATH>     Specify absolute path to Unix domain socket");
    println!("                      (default: $XDG_RUNTIME_DIR/tessera/tessera.sock)");
    println!(
        "  --check             Validate configuration, schemas, and directory security then exit"
    );
    println!("  --print-protocol    Print protocol namespace, versions, limits, methods, and error codes");
    println!("  -h, --help          Print help information");
    println!("  -V, --version       Print version information");
}
