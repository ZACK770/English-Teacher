const { spawn } = require("node:child_process");
const readline = require("node:readline");
const child = spawn(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js", "tail", "--config", "wrangler.pbx-pilot.toml", "--format", "json",
], { stdio: ["ignore", "pipe", "pipe"] });

function record(event) {
  const request = event.event?.request;
  const path = request?.url ? new URL(request.url).pathname : null;
  if (path && path !== "/v1/technoline/pilot") return;
  const exceptions = (event.exceptions ?? []).map((failure) => {
    const message = String(failure.message ?? "");
    if (/no such (?:column|table)/i.test(message)) return "database_schema";
    if (/channel/i.test(message)) return "channel_validation";
    if (/websocket|upgrade/i.test(message)) return "websocket_upgrade";
    return failure.name || "exception";
  });
  const statuses = (event.logs ?? []).flatMap((log) => (
    (log.message ?? []).map(String).filter((line) => /^(?:Teacher pilot Soniox|Teacher pilot response failed)$/.test(line))
  ));
  console.log(JSON.stringify({
    time: event.eventTimestamp ? new Date(event.eventTimestamp).toISOString() : new Date().toISOString(),
    path, method: request?.method ?? null, status: event.event?.response?.status ?? null,
    outcome: event.outcome ?? null, exceptions, statuses,
  }));
}

child.stderr.on("data", (data) => {
  const message = data.toString();
  if (/connected to|waiting for/i.test(message)) console.log("Live tail connected.");
  if (/error|failed/i.test(message)) console.log("Cloudflare live-tail diagnostic:", message.split(/\r?\n/).find(line => /error|failed/i.test(line))?.slice(0, 160));
});
let json = "";
const input = readline.createInterface({ input: child.stdout });
input.on("line", (line) => {
  if (!json && !line.trimStart().startsWith("{")) {
    if (/connected to|waiting for/i.test(line)) console.log("Live tail connected.");
    return;
  }
  json += line + "\n";
  try {
    const event = JSON.parse(json);
    json = "";
    record(event);
  } catch {
    if (json.length > 1_000_000) json = "";
  }
});
const stop = setTimeout(() => {
  console.log("Live tail reached its time limit.");
  child.kill();
}, 180_000);
child.on("error", () => console.log("Could not start the Cloudflare live-tail process."));
child.on("exit", (code) => {
  clearTimeout(stop);
  console.log("Live tail stopped.", code ?? "");
});
