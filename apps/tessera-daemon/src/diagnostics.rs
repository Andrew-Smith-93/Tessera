use crate::config::{
    DAEMON_VERSION, MAX_ARRAY_LENGTH, MAX_BUFFERED_BYTES, MAX_FRAME_SIZE,
    MAX_IDEMPOTENCY_CACHE_SIZE, MAX_NESTING_DEPTH, MAX_OUTSTANDING_REQUESTS, MAX_QUEUE_LENGTH,
    MAX_STRING_LENGTH, MAX_SUBSCRIPTION_COUNT, PROTOCOL_MAJOR_VERSION, PROTOCOL_MINOR_VERSION,
    PROTOCOL_NAMESPACE,
};
use crate::protocol::{error_codes, KNOWN_EVENTS, KNOWN_METHODS, V1_CAPABILITIES};

pub fn print_protocol_summary(backend_capabilities: u64) {
    println!("Tessera IPC Protocol V1 Specification");
    println!("=====================================");
    println!("Daemon Version:     {}", DAEMON_VERSION);
    println!("Protocol Namespace: {}", PROTOCOL_NAMESPACE);
    println!(
        "Supported Version:  {}.{}",
        PROTOCOL_MAJOR_VERSION, PROTOCOL_MINOR_VERSION
    );
    println!();
    println!("Resource Limits:");
    println!(
        "  Max Frame Size:          {} bytes (1 MiB)",
        MAX_FRAME_SIZE
    );
    println!(
        "  Max Buffered Bytes:      {} bytes (2 MiB)",
        MAX_BUFFERED_BYTES
    );
    println!("  Max Nesting Depth:       {}", MAX_NESTING_DEPTH);
    println!("  Max String Length:       {} chars", MAX_STRING_LENGTH);
    println!("  Max Array Length:        {} items", MAX_ARRAY_LENGTH);
    println!("  Max Queue Length:        {} commands", MAX_QUEUE_LENGTH);
    println!("  Max Outstanding Reqs:    {}", MAX_OUTSTANDING_REQUESTS);
    println!("  Max Subscriptions:       {}", MAX_SUBSCRIPTION_COUNT);
    println!("  Max Idempotency Cache:   {}", MAX_IDEMPOTENCY_CACHE_SIZE);
    println!();
    println!("Standard Capabilities:");
    for cap in V1_CAPABILITIES {
        println!("  - {}", cap);
    }
    println!(
        "Available Backend Capabilities: 0x{:04x}",
        backend_capabilities
    );
    println!();
    println!("Registered Methods:");
    for m in KNOWN_METHODS {
        println!("  - {}", m);
    }
    println!();
    println!("Registered Events:");
    for ev in KNOWN_EVENTS {
        println!("  - {}", ev);
    }
    println!();
    println!("Protocol Error Taxonomy:");
    let errors = [
        error_codes::INVALID_ENVELOPE,
        error_codes::UNSUPPORTED_MAJOR_VERSION,
        error_codes::UNSUPPORTED_MINOR_VERSION,
        error_codes::CAPABILITY_NOT_NEGOTIATED,
        error_codes::UNKNOWN_METHOD,
        error_codes::INVALID_PAYLOAD,
        error_codes::FRAME_TOO_LARGE,
        error_codes::CONFIG_VALIDATION_FAILED,
        error_codes::REVISION_CONFLICT,
        error_codes::IDEMPOTENCY_CONFLICT,
        error_codes::RESOURCE_LIMIT_EXCEEDED,
        error_codes::WINDOW_NOT_FOUND,
        error_codes::OUTPUT_NOT_FOUND,
        error_codes::TRACE_DISABLED,
        error_codes::INTERNAL_ERROR,
        error_codes::DECODE_ERROR,
    ];
    for err in errors {
        println!("  - {}", err);
    }
}
