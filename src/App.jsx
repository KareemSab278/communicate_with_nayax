import { useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";


// Baud: 9600 (most common)
// Data bits: 8
// Parity: Even
// Stop bits: 1
// Flow control: None
// Read timeout used in your app: ~200–300 ms
// (Occasionally devices use 19200 or 115200 — verify in the device manual or label.)

function App() {
  const [command, setCommand] = useState("cashlessreset(1)");
  const [portName, setPortName] = useState("/dev/serial/by-id/usb-FTDI_USB_Serial_Converter_FTB6SPL3-if00-port0");
  const [addr, setAddr] = useState(1);
  const [output, setOutput] = useState("");
  return (
    <main className="container">
      <h1>Run a command to the nayax reader here</h1>

      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          const output = await invoke_cmd(command, portName, addr);
          setOutput(output);
        }}
      >
        <input
          id="command-input"
          value={command}
          onChange={(e) => setCommand(e.currentTarget.value)}
          placeholder="Enter a command..."
        />
        <input
          id="port-input"
          value={portName}
          onChange={(e) => setPortName(e.currentTarget.value)}
          placeholder="Enter a port name..."
        />
        <input
          id="addr-input"
          type="number"
          value={addr}
          onChange={(e) => setAddr(Number(e.currentTarget.value))}
          placeholder="Enter an address..."
        />
        <button type="submit">Run Command</button>
      </form>
      <p>{output}</p>
    </main>
  );
}


export default App;


const hexToBytes = (hex) => {
  if (!hex) return [];
  const cleaned = hex.replace(/0x/gi, "").replace(/\s+/g, "");
  if (cleaned === "") return [];
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null; // invalid characters
  const normalized = cleaned.length % 2 === 1 ? "0" + cleaned : cleaned;
  const pairs = normalized.match(/.{1,2}/g) || [];
  const bytes = pairs.map((p) => {
    const v = parseInt(p, 16);
    return Number.isNaN(v) ? null : v;
  });
  return bytes.some((b) => b === null) ? null : bytes;
};

const invoke_cmd = async (commandText, portName, addr) => {
  const cmd = (commandText || "").trim();

  // accept textual command `cashlessreset(1)` (or `cashless_reset(1)`) — fallback to hex
  const cashlessRe = /^cashless[_]?reset(?:\s*\(\s*(\d+)\s*\))?$/i;

  try {
    const m = cmd.match(cashlessRe);
    if (m) {
      // const a = m[1] ? Number(m[1]) : addr;
      if (!Number.isInteger(addr) || addr < 0 || addr > 255) return "Error: invalid address";
      const res = await invoke("cashless_reset", { addr: addr, portName: portName }); // camelCase portName
      return String(res);
    }

    // otherwise parse as hex bytes and send via send_raw
    const bytes = hexToBytes(cmd);
    if (bytes === null) return "Error: invalid hex (use 0-9, A-F, spaces allowed)";
    if (bytes.length === 0) return "Error: enter a hex byte (e.g. '00' or '0A FF')";

    const resp = await invoke("send_raw", {
      portName: portName,
      data: bytes,
      read_timeout_ms: 300,
      expected_len: null,
    });
    return bytesToHex(resp);
  } catch (error) {
    console.error("Error running command:", error);
    return `Error: ${error}`;
  }
};