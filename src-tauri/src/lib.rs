use serialport::{DataBits, FlowControl, Parity, StopBits};
use std::thread::sleep;
use std::time::Duration;

// Example: number of retries and command delay
const RESET_RETRIES: u8 = 3;
const CASHLESS_CMD_DELAY_MS: u64 = 100;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn cashless_reset(addr: u8, port_name: &str) -> Result<bool, String> {
    // this needs the correct port settings for the nayax reader
    let mut port = serialport::new(port_name, 9600)
        .data_bits(DataBits::Eight)
        .parity(Parity::Even)
        .stop_bits(StopBits::One)
        .flow_control(FlowControl::None)
        .timeout(Duration::from_millis(200))
        .open()
        .map_err(|e| format!("Failed to open port: {}", e))?;

    let reset_cmd: u8 = (addr & 0xF0) | 0x00;
    println!(
        "[TX] Sending RESET to addr 0x{:02X} -> 0x{:02X}",
        addr, reset_cmd
    );

    let mut buf = [0u8; 1];

    for attempt in 1..=RESET_RETRIES {
        port.write(&[reset_cmd])
            .map_err(|e| format!("Write failed: {}", e))?;
        port.flush().unwrap_or_default();

        println!("[RESET] Attempt {}/{}", attempt, RESET_RETRIES);

        match port.read(&mut buf) {
            Ok(1) if buf[0] == 0x00 => {
                println!("[RESET] ACK received");
                return Ok(true);
            }
            Ok(n) => {
                println!("[RX] Received {} byte(s): {:02X?}", n, &buf[..n]);
            }
            Err(e) => {
                println!("[RX] No response: {}", e);
            }
        }

        sleep(Duration::from_millis(200));
    }

    println!("[RESET] No ACK after {} attempts", RESET_RETRIES);
    Ok(false)
}

#[tauri::command]
fn run_cmd(command: &str, port_name: &str, addr: u8) -> Result<String, String> {
    let mut port = serialport::new(port_name, 9600)
        .data_bits(DataBits::Eight)
        .parity(Parity::Even)
        .stop_bits(StopBits::One)
        .flow_control(FlowControl::None)
        .timeout(Duration::from_millis(200))
        .open()
        .map_err(|e| format!("Failed to open port: {}", e))?;

    let cmd: u8 = (addr & 0xF0) | 0x00;
    println!("[TX] Sending Command to addr 0x{:02X} -> 0x{:02X}", addr, cmd);
    let mut buf = [0u8; 1];

    for attempt in 1..=RESET_RETRIES {
        port.write(&[cmd])
            .map_err(|e| format!("Write failed: {}", e))?;
        port.flush().ok();

        println!("[CMD] Attempt {}/{}", attempt, RESET_RETRIES);

        match port.read(&mut buf) {
            Ok(1) if buf[0] == 0x00 => {
                println!("[CMD] ACK received");
                return Ok("ACK received".to_string());
            }
            Ok(n) => println!("[RX] Received {} byte(s): {:02X?}", n, &buf[..n]),
            Err(e) => println!("[RX] No response: {}", e),
        }

        sleep(Duration::from_millis(200));
    }

    println!("[CMD] No ACK after {} attempts", RESET_RETRIES);
    Ok("No ACK received".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, cashless_reset, run_cmd])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
