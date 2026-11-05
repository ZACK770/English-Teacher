export interface StartFrame {
  callId: string;
  caller: string;
}

export function parseStartFrame(raw: string, expectedChannel: string): StartFrame {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(raw);
  } catch {
    throw new Error("Invalid start frame");
  }
  if (!p || Array.isArray(p) || p.type !== "start" || !expectedChannel || p.token !== expectedChannel) {
    throw new Error("Invalid channel");
  }
  const format = Object.fromEntries(
    String(p.format ?? "").split(";").map((part) => {
      const [key, value] = part.trim().split("=");
      return value === undefined ? ["codec", key] : [key, value];
    }),
  );
  if (format.codec !== "pcm16" || Number(format.rate) !== 8000 || Number(format.ch) !== 1) {
    throw new Error("Expected mono PCM16 at 8000Hz");
  }
  const callId = typeof p.callId === "string" ? p.callId.trim() : "";
  if (!callId || callId.length > 200) throw new Error("Invalid call ID");
  return { callId, caller: String(p.caller ?? "").slice(0, 64) };
}

export function transferCommand(target: string): string {
  if (!target.startsWith("/")) throw new Error("Invalid transfer target");
  return JSON.stringify({ type: "transfer_extension", target });
}
