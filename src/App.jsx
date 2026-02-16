import { useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [command, setCommand] = useState("");
  const [portName, setPortName] = useState("");
  const [addr, setAddr] = useState(0);
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
          onChange={(e) => setCommand(e.currentTarget.value)}
          placeholder="Enter a command..."
        />
        <input
          id="port-input"
          onChange={(e) => setPortName(e.currentTarget.value)}
          placeholder="Enter a port name..."
        />
        <input
          id="addr-input"
          type="number"
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


const invoke_cmd = async (command, portName, addr) => {
    try {
        const commandResponse = invoke("run_cmd", {
            command: command,
            port_name: portName,
            addr: addr,
        });
        console.log("Command response:", commandResponse);
        return commandResponse;
    } catch (error) {
        console.error("Error running command:", error);
        return "Error running command";
    }
};