import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import { apiPrefix, PortalError, portalRequest } from "./portalApi";

const connecting = "רגע, מחברים את השיחה…";
const connectionError = "השיחה לא התחברה. אפשר לנסות שוב או להתקשר לקו.";
const earlyClose = "החיבור לשיחה נסגר לפני שהמורה התחיל לדבר. אפשר לנסות שוב או להתקשר לקו.";
const micPermission = "כדי לדבר כאן צריך לאפשר גישה למיקרופון בדפדפן.";
const callErrors: Record<string, string> = {
  call_failed: connectionError,
  access_blocked: "שיחות הטעימה נוצלו ואין דקות בחבילה. כל מה שלמדת שמור. להמשך: חייגו 076-5673575 והקישו 3.",
  customer_busy: "כבר יש לך שיחה פעילה. כדי להתחיל חדשה, יש לסיים את השיחה הקיימת.",
  system_busy: "כל קווי השיחה תפוסים כרגע. אפשר לנסות שוב בעוד רגע.",
  gemini_budget_reached: "מכסת השימוש היומית של המערכת הסתיימה. אפשר לחזור מחר.",
  gemini_guard_unavailable: "שירות השיחות אינו זמין כרגע. אפשר לנסות שוב בעוד רגע.",
};

const processorCode = (name: string) => `
class SpeakoolMic extends AudioWorkletProcessor {
  constructor() { super(); this.samples=[]; this.position=0; }
  process(inputs) {
    const input=inputs[0]?.[0]; if(!input) return true;
    this.samples.push(...input);
    const step=sampleRate/8000;
    const output=[];
    while(this.position+step<=this.samples.length) {
      const start=Math.floor(this.position), end=Math.floor(this.position+step);
      let sum=0; for(let i=start;i<end;i++) sum+=this.samples[i];
      output.push(Math.max(-1,Math.min(1,sum/(end-start))));
      this.position+=step;
    }
    const used=Math.floor(this.position); this.samples.splice(0,used); this.position-=used;
    if(output.length) this.port.postMessage(Int16Array.from(output,x=>x<0?x*32768:x*32767));
    return true;
  }
} registerProcessor('${name}',SpeakoolMic);`;

class VoiceTimeout extends Error {}

function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal, milliseconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => { finish(); reject(signal.reason); };
    const timer = setTimeout(() => { finish(); reject(new VoiceTimeout(message)); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then(value => { finish(); resolve(value); }, error => { finish(); reject(error); });
  });
}

export function VoiceRoom({ token, botId, teacherId, name, onDone }: { token: string; botId: string; teacherId?: string; name: string; onDone: () => void }) {
  const [state, setState] = useState(connecting);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [needsGesture, setNeedsGesture] = useState(false);
  const startRef = useRef<() => void>(() => {});
  const closeRef = useRef<() => void>(() => {});
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    const cleanup = () => stop?.();
    closeRef.current = () => { disposed = true; cleanup(); onDone(); };
    const start = async (gesture = false) => {
      if (disposed || stop) return;
      setError("");
      setNeedsGesture(false);
      setState(connecting);
      setConnected(false);
      setMuted(false);
      setSeconds(0);
      const attempt = new AbortController();
      const signal = attempt.signal;
      let context: AudioContext | undefined;
      let stream: MediaStream | undefined;
      let ws: WebSocket | undefined;
      let processor: AudioWorkletNode | undefined;
      let source: MediaStreamAudioSourceNode | undefined;
      let silent: GainNode | undefined;
      let socketTimer: ReturnType<typeof setTimeout> | undefined;
      const closeSocket = () => {
        clearTimeout(socketTimer);
        if (!ws) return;
        const socket = ws;
        ws = undefined;
        socket.close();
      };
      stop = () => {
        stop = undefined;
        attempt.abort();
        stream?.getTracks().forEach(t => t.stop());
        if (streamRef.current === stream) streamRef.current = null;
        processor?.disconnect(); source?.disconnect(); silent?.disconnect();
        closeSocket();
        if (context && context.state !== "closed") void context.close().catch(() => {});
      };
      const fail = (message: string) => {
        if (signal.aborted) return;
        setConnected(false);
        setError(message);
        cleanup();
      };
      try {
        if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("לשיחה קולית צריך דפדפן עדכני וחיבור מאובטח.");
        const audioContext = context = new AudioContext();
        if (audioContext.state === "suspended" && !gesture) {
          setNeedsGesture(true);
          cleanup();
          return;
        }
        try { await beforeDeadline(audioContext.resume(), signal, 5000, ""); }
        catch (e) {
          if (signal.aborted) return;
          if (e instanceof VoiceTimeout || (e instanceof DOMException && e.name === "NotAllowedError")) {
            setNeedsGesture(true);
            cleanup();
            return;
          }
          throw e;
        }
        const microphone = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }).then(result => {
          if (signal.aborted) result.getTracks().forEach(track => track.stop());
          else stream = result;
          return result;
        });
        const mic = await beforeDeadline(microphone, signal, 30000, "המיקרופון לא נפתח. בדקו את ההרשאה בדפדפן ונסו שוב.");
        if (signal.aborted) return;
        streamRef.current = mic;
        const prepareWorklet = async (name: string) => {
          const blob = URL.createObjectURL(new Blob([processorCode(name)], { type: "text/javascript" }));
          try {
            await beforeDeadline(audioContext.audioWorklet.addModule(blob), signal, 5000, "לא הצלחנו להכין את השמע. אפשר לנסות שוב.");
            return name;
          } finally { URL.revokeObjectURL(blob); }
        };
        const name = await prepareWorklet("speakool-mic").catch(error => {
          if (signal.aborted || !(error instanceof VoiceTimeout)) throw error;
          // The first registration may still finish after its timeout.
          return prepareWorklet("speakool-mic-retry");
        });
        if (signal.aborted) return;
        source = audioContext.createMediaStreamSource(mic);
        processor = new AudioWorkletNode(audioContext, name);
        silent = audioContext.createGain(); silent.gain.value = 0;
        source.connect(processor); processor.connect(silent); silent.connect(audioContext.destination);
        processor.port.onmessage = (event: MessageEvent<Int16Array>) => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(new Int16Array(event.data).buffer);
        };
        const getTicket = async () => {
          const ticketRequest = new AbortController();
          try {
            return await beforeDeadline(
              portalRequest<{ ticket: string }>("/v1/portal/voice-ticket", token, { bot_id: botId, ...(teacherId ? { teacher_id: teacherId } : {}) }, undefined, ticketRequest.signal),
              signal, 8000, connectionError,
            );
          } finally { ticketRequest.abort(); }
        };
        const { ticket } = await getTicket().catch(error => {
          const transient = error instanceof VoiceTimeout || error instanceof TypeError || (error instanceof PortalError && (error.status === 408 || error.status >= 500));
          if (signal.aborted || !transient) throw error;
          return getTicket();
        }).catch(error => {
          throw error instanceof PortalError ? error : new Error(connectionError);
        });
        if (signal.aborted) return;
        const url = new URL(apiPrefix + "/v1/portal/voice", location.origin);
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("ticket", ticket);
        const socket = ws = new WebSocket(url);
        let connected = false, playAt = 0;
        socket.binaryType = "arraybuffer";
        socketTimer = setTimeout(() => fail(connectionError), 10000);
        const ready = () => {
          clearTimeout(socketTimer);
          connected = true;
          setConnected(true);
          setState("אפשר לדבר. אנחנו מקשיבים.");
        };
        socket.onopen = () => {
          if (signal.aborted) return;
          clearTimeout(socketTimer);
          socketTimer = setTimeout(() => fail(connectionError), 28000);
          setState("עוד רגע, המורה מצטרף…");
        };
        socket.onmessage = (event) => {
          if (signal.aborted) return;
          if (typeof event.data === "string") {
            try {
              const message = JSON.parse(event.data);
              if (message.type === "ready") ready();
              if (message.type === "hangup" && Object.hasOwn(callErrors, message.reason)) fail(callErrors[message.reason]);
            } catch { /* Optional status frames do not affect audio. */ }
            return;
          }
          const samples = new Int16Array(event.data as ArrayBuffer);
          if (!samples.length) return;
          if (!connected && samples.some(n => Math.abs(n) > 100)) ready();
          const buffer = audioContext.createBuffer(1, samples.length, 8000);
          buffer.getChannelData(0).set(Float32Array.from(samples, n => n / 32768));
          const audio = audioContext.createBufferSource(); audio.buffer = buffer; audio.connect(audioContext.destination);
          playAt = Math.max(audioContext.currentTime + .025, playAt);
          if (playAt > audioContext.currentTime + 2) playAt = audioContext.currentTime + .025;
          audio.start(playAt); playAt += buffer.duration;
        };
        socket.onerror = () => fail(connectionError);
        socket.onclose = () => {
          if (signal.aborted) return;
          if (!connected) fail(earlyClose);
          else {
            setConnected(false);
            setState("עוד שיחה קטנה. עוד צעד קדימה.");
            cleanup();
          }
        };
      } catch (e) {
        fail(e instanceof DOMException && e.name === "NotAllowedError" ? micPermission : e instanceof Error ? e.message : "לא הצלחנו לפתוח את המיקרופון.");
      }
    };
    startRef.current = () => { void start(true); };
    void start();
    return () => { disposed = true; cleanup(); };
  }, [token, botId, teacherId]);
  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => setSeconds(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [connected]);
  const toggleMic = () => { streamRef.current?.getAudioTracks().forEach(t => { t.enabled = muted; }); setMuted(!muted); };
  const exit = <button className="sk-primary" onClick={() => closeRef.current()}><PhoneOff size={17} />{connected ? "נסיים כאן" : "חזרה לאזור האישי"}</button>;
  if (needsGesture) return <div className="sk-call"><button className="sk-primary" onClick={() => startRef.current()}>התחל לדבר</button>{exit}</div>;
  return <div className="sk-call">
    <div className={"sk-voice-orb " + (connected ? "is-speaking" : "")}><span /><span /><span /><Mic size={38} strokeWidth={1.1} /></div>
    <p className="sk-eyebrow">שיחה עם {name}</p><h2>{error ? "רגע קטן." : "פשוט לדבר."}</h2>
    <p role={error ? "alert" : "status"}>{error || state}</p>
    {connected && <p className="sk-timer" dir="ltr">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</p>}
    <div className="sk-actions">
      {connected && <button className="sk-icon" title={muted ? "פתיחת מיקרופון" : "השתקת מיקרופון"} aria-label={muted ? "פתיחת מיקרופון" : "השתקת מיקרופון"} aria-pressed={muted} onClick={toggleMic}>{muted ? <MicOff /> : <Mic />}</button>}
      {error && !connected && <button className="sk-secondary" onClick={() => startRef.current()}>לנסות שוב</button>}
      {exit}
    </div><small>כמו בטלפון, גם כאן השיחה משתמשת בדקות הלימוד שלך.</small>
  </div>;
}
