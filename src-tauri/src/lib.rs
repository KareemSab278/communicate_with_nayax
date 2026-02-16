use serialport::{DataBits, FlowControl, Parity, StopBits};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

// ── Serial settings per MDB Master RS232 docs ──
// Baud: 115200, Data: 8, Parity: NONE, Stop: 1, HW flow: RTS/CTS, SW flow: NO
const BAUD_RATE: u32 = 115200;
const DAEMON_ADDR: &str = "127.0.0.1:5127";
const TCP_TIMEOUT_MS: u64 = 1000;

// ─────────────────────────────────────────────────────────────
//  HIGH LEVEL MODE — talks to the Python daemon via TCP :5127
//  Send text commands like CashlessReset(1), get JSON back.
// ─────────────────────────────────────────────────────────────

/// Send a text command to the MDB daemon on TCP 5127 and return the JSON response.
#[tauri::command]
fn mdb_command(command: String) -> Result<String, String> {
    println!("[TCP] Connecting to daemon at {}", DAEMON_ADDR);

    let stream = TcpStream::connect(DAEMON_ADDR)
        .map_err(|e| format!("Cannot connect to MDB daemon at {} — is the Python daemon running? Error: {}", DAEMON_ADDR, e))?;

    stream
        .set_read_timeout(Some(Duration::from_millis(TCP_TIMEOUT_MS)))
        .map_err(|e| format!("Set timeout failed: {}", e))?;
    stream
        .set_write_timeout(Some(Duration::from_millis(TCP_TIMEOUT_MS)))
        .map_err(|e| format!("Set timeout failed: {}", e))?;

    let mut writer = stream.try_clone().map_err(|e| format!("Clone failed: {}", e))?;

    let msg = format!("{}\n", command.trim());
    println!("[TCP TX] {}", msg.trim());
    writer
        .write_all(msg.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    writer.flush().map_err(|e| format!("Flush failed: {}", e))?;

    // Read response line(s) — daemon returns JSON
    let mut reader = BufReader::new(&stream);
    let mut response = String::new();

    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => break, // EOF
            Ok(_) => {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    println!("[TCP RX] {}", trimmed);
                    if !response.is_empty() {
                        response.push('\n');
                    }
                    response.push_str(trimmed);
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                break; // done reading
            }
            Err(e) => {
                if response.is_empty() {
                    return Err(format!("Read failed: {}", e));
                }
                break;
            }
        }
    }

    if response.is_empty() {
        return Err("No response from MDB daemon (timeout)".into());
    }

    Ok(response)
}

// ─────────────────────────────────────────────────────────────
//  LOW LEVEL MODE — direct serial, proper MDB binary framing
//  Settings: 115200 8N1, RTS/CTS hardware flow, no SW flow
// ─────────────────────────────────────────────────────────────

/// Open the serial port with the correct MDB Master RS232 settings.
fn open_serial(port_name: &str, timeout_ms: u64) -> Result<Box<dyn serialport::SerialPort>, String> {
    serialport::new(port_name, BAUD_RATE)
        .data_bits(DataBits::Eight)
        .parity(Parity::None)          // MDB RS232 doc says NONE
        .stop_bits(StopBits::One)
        .flow_control(FlowControl::Hardware) // RTS/CTS per doc
        .timeout(Duration::from_millis(timeout_ms))
        .open()
        .map_err(|e| format!("Failed to open port {}: {}", port_name, e))
}

/// Calculate MDB checksum (simple sum of all bytes, lowest 8 bits).
fn mdb_checksum(data: &[u8]) -> u8 {
    let sum: u16 = data.iter().map(|&b| b as u16).sum();
    (sum & 0xFF) as u8
}

/// Send raw MDB binary frame (with auto-CRC) over serial in low-level mode.
/// The CRC byte is appended automatically.
#[tauri::command]
fn send_raw(
    port_name: &str,
    data: Vec<u8>,
    read_timeout_ms: Option<u64>,
    expected_len: Option<usize>,
) -> Result<Vec<u8>, String> {
    let timeout = read_timeout_ms.unwrap_or(200);
    let mut port = open_serial(port_name, timeout)?;

    // Append MDB checksum
    let chk = mdb_checksum(&data);
    let mut frame = data.clone();
    frame.push(chk);

    println!(
        "[SERIAL TX] {} bytes (inc CRC): {:02X?}",
        frame.len(),
        frame
    );

    port.write_all(&frame)
        .map_err(|e| format!("Write failed: {}", e))?;
    port.flush().ok();

    // Read response
    let mut resp = Vec::new();
    let mut buf = [0u8; 256];

    loop {
        match port.read(&mut buf) {
            Ok(n) if n > 0 => {
                resp.extend_from_slice(&buf[..n]);
                if let Some(exp) = expected_len {
                    if resp.len() >= exp {
                        break;
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => break,
            Ok(_) => break,
            Err(e) => return Err(format!("Read error: {}", e)),
        }
    }

    println!("[SERIAL RX] {} bytes: {:02X?}", resp.len(), resp);
    Ok(resp)
}

#[tauri::command]
fn send_raw_with_crc(
    port_name: &str,
    data: Vec<u8>,
    read_timeout_ms: Option<u64>,
    expected_len: Option<usize>,
) -> Result<Vec<u8>, String> {
    let timeout = read_timeout_ms.unwrap_or(200);
    let mut port = open_serial(port_name, timeout)?;

    println!(
        "[SERIAL TX RAW] {} bytes: {:02X?}",
        data.len(),
        data
    );

    port.write_all(&data)
        .map_err(|e| format!("Write failed: {}", e))?;
    port.flush().ok();

    let mut resp = Vec::new();
    let mut buf = [0u8; 256];

    loop {
        match port.read(&mut buf) {
            Ok(n) if n > 0 => {
                resp.extend_from_slice(&buf[..n]);
                if let Some(exp) = expected_len {
                    if resp.len() >= exp {
                        break;
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => break,
            Ok(_) => break,
            Err(e) => return Err(format!("Read error: {}", e)),
        }
    }

    println!("[SERIAL RX] {} bytes: {:02X?}", resp.len(), resp);
    Ok(resp)
}

// ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            mdb_command,
            send_raw,
            send_raw_with_crc,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
