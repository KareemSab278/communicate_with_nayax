import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// MDB Master RS232 Interface — High Level Mode (TCP :5127 via Python daemon)
// Comm settings: 115200, 8N1, RTS/CTS hardware flow, no software flow

const EXAMPLE_COMMANDS = [
  "CashlessReset(1)",
  "CashlessInit(1)",
  "CashlessSettings(1)",
  "CashlessEnable(1)",
  "CashlessSessionComplete(1)",
];

function App() {
  const [command, setCommand] = useState("CashlessReset(1)");
  const [portName, setPortName] = useState(
    "/dev/serial/by-id/usb-FTDI_USB_Serial_Converter_FTB6SPL3-if00-port0"
  );
  const [mode, setMode] = useState("tcp"); // "tcp" = high level daemon, "serial" = low level
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState([]);

  const addLog = (entry) =>
    setLog((prev) => [...prev, { time: new Date().toLocaleTimeString(), ...entry }]);

  const runCommand = async () => {
    const cmd = (command || "").trim();
    if (!cmd) return;
    setLoading(true);
    setOutput("");

    try {
      if (mode === "tcp") {
        // ── High level: send text command to Python daemon via TCP ──
        const res = await invoke("mdb_command", { command: cmd });
        setOutput(res);
        addLog({ cmd, response: res, mode: "TCP" });
      } else {
        // ── Low level: parse hex bytes, send via serial with auto-CRC ──
        const bytes = hexToBytes(cmd);
        if (bytes === null) {
          setOutput("Error: invalid hex (use 0-9, A-F, spaces ok)");
          setLoading(false);
          return;
        }
        if (bytes.length === 0) {
          setOutput("Error: enter hex bytes (e.g. '10 00' for cashless 1 reset)");
          setLoading(false);
          return;
        }

        const resp = await invoke("send_raw", {
          portName: portName,
          data: bytes,
          readTimeoutMs: 300,
          expectedLen: null,
        });
        const hex = bytesToHex(resp);
        setOutput(hex || "(no response)");
        addLog({ cmd, response: hex, mode: "SERIAL" });
      }
    } catch (error) {
      const msg = `Error: ${error}`;
      setOutput(msg);
      addLog({ cmd, response: msg, mode: mode.toUpperCase() });
    }

    setLoading(false);
  };

  return (
    <main className="container">
      <h1>MDB Master RS232 — Nayax Comms</h1>

      {/* Mode selector */}
      <div style={{ marginBottom: 12 }}>
        <label>
          <input
            type="radio"
            name="mode"
            value="tcp"
            checked={mode === "tcp"}
            onChange={() => setMode("tcp")}
          />{" "}
          High Level (TCP daemon on :5127)
        </label>
        <label style={{ marginLeft: 16 }}>
          <input
            type="radio"
            name="mode"
            value="serial"
            checked={mode === "serial"}
            onChange={() => setMode("serial")}
          />{" "}
          Low Level (direct serial — hex bytes)
        </label>
      </div>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          runCommand();
        }}
      >
        <input
          id="command-input"
          value={command}
          onChange={(e) => setCommand(e.currentTarget.value)}
          placeholder={
            mode === "tcp"
              ? "e.g. CashlessReset(1)"
              : "e.g. 10 00 (hex bytes, CRC added automatically)"
          }
          style={{ flex: 2 }}
        />

        {mode === "serial" && (
          <input
            id="port-input"
            value={portName}
            onChange={(e) => setPortName(e.currentTarget.value)}
            placeholder="Serial port path"
            style={{ flex: 2 }}
          />
        )}

        <button type="submit" disabled={loading}>
          {loading ? "Sending..." : "Send"}
        </button>
      </form>

      {/* Quick command buttons (TCP mode) */}
      {mode === "tcp" && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {EXAMPLE_COMMANDS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCommand(c);
              }}
              style={{ fontSize: 11, padding: "4px 8px" }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Response */}
      <pre
        style={{
          marginTop: 16,
          padding: 12,
          background: "#1a1a2e",
          color: "#0f0",
          borderRadius: 6,
          minHeight: 60,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {output || "(no output yet)"}
      </pre>

      {/* Log */}
      {log.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Command log ({log.length})</summary>
          <div
            style={{
              maxHeight: 200,
              overflow: "auto",
              fontSize: 12,
              background: "#111",
              padding: 8,
              borderRadius: 4,
            }}
          >
            {log.map((entry, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <span style={{ color: "#888" }}>[{entry.time}]</span>{" "}
                <span style={{ color: "#6cf" }}>[{entry.mode}]</span>{" "}
                <strong>{entry.cmd}</strong> → {entry.response}
              </div>
            ))}
          </div>
        </details>
      )}
    </main>
  );
}

export default App;

const hexToBytes = (hex) => {
  if (!hex) return [];
  const cleaned = hex.replace(/0x/gi, "").replace(/\s+/g, "");
  if (cleaned === "") return [];
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null;
  const normalized = cleaned.length % 2 === 1 ? "0" + cleaned : cleaned;
  const pairs = normalized.match(/.{1,2}/g) || [];
  const bytes = pairs.map((p) => parseInt(p, 16));
  return bytes.some((b) => Number.isNaN(b)) ? null : bytes;
};

const bytesToHex = (bytes) =>
  (bytes || []).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");