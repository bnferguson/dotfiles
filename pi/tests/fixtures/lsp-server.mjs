import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const mode = readFileSync("mode", "utf8");
appendFileSync("events", `start ${process.pid}\n`);
if (mode === "crash") {
  console.error("Bundler fixture failed");
  process.exit(1);
}
const send = (id, result) => {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const header = buffer.indexOf("\r\n\r\n");
    if (header < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, header).toString())[1]);
    if (buffer.length < header + 4 + length) return;
    const message = JSON.parse(buffer.subarray(header + 4, header + 4 + length).toString());
    buffer = buffer.subarray(header + 4 + length);
    appendFileSync("events", `${message.method}\n`);
    if (message.method === "initialize" && mode !== "hang-init") {
      if (mode === "slow-init") setTimeout(() => send(message.id, { capabilities: {} }), 300);
      else send(message.id, { capabilities: {} });
    }
    if (message.method === "textDocument/documentSymbol" && mode !== "hang-symbol") {
      send(message.id, [{ name: "Sample", kind: 5, selectionRange: { start: { line: 0, character: 6 } } }]);
    }
    if (message.method === "textDocument/references") {
      if (mode === "exit-references") {
        console.error("Server crashed during references");
        process.exit(2);
      }
      if (mode !== "hang-references") {
        send(message.id, [{ uri: pathToFileURL(`${process.cwd()}/sample.rb`).href, range: { start: { line: 0, character: 6 } } }]);
      }
    }
    if (message.method === "shutdown" && mode !== "hang-shutdown") send(message.id, null);
    if (message.method === "exit") process.exit(0);
  }
});
