import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import { apiPrefix, portalRequest } from "./portalApi";

const callErrors: Record<string, string> = {
  call_failed: "השיחה לא התחברה. אפשר לנסות שוב או להתקשר לקו.",
  access_blocked: "שיחות הטעימה נוצלו ואין דקות בחבילה. כל מה שלמדת שמור. להמשך: חייגו 076-5673575 והקישו 3.",
  system_busy: "כל קווי השיחה תפוסים כרגע. אפשר לנסות שוב בעוד רגע.",
  gemini_budget_reached: "מכסת השימוש היומית של המערכת הסתיימה. אפשר לחזור מחר.",
  gemini_guard_unavailable: "שירות השיחות אינו זמין כרגע. אפשר לנסות שוב בעוד רגע.",
};

const processorCode = `
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
} registerProcessor('speakool-mic',SpeakoolMic);`;

export function VoiceRoom({ token, botId, teacherId, name, onDone }: { token: string; botId: string; teacherId?: string; name: string; onDone: () => void }) {
  const [state, setState] = useState("רגע, מחברים את השיחה…");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const closeRef = useRef<() => void>(() => {});
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let context: AudioContext | null = null;
    let processor: AudioWorkletNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let playAt = 0;
    let receivedAudio = false;
    let serverError = "";
    const cleanup = () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      processor?.disconnect(); source?.disconnect();
      ws?.close();
      if (context && context.state !== "closed") void context.close();
    };
    closeRef.current = () => { disposed = true; cleanup(); onDone(); };
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("לשיחה קולית צריך דפדפן עדכני וחיבור מאובטח.");
        context = new AudioContext();
        await context.resume();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        if (disposed) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const blob = URL.createObjectURL(new Blob([processorCode], { type: "text/javascript" }));
        try { await context.audioWorklet.addModule(blob); } finally { URL.revokeObjectURL(blob); }
        const { ticket } = await portalRequest<{ ticket: string }>("/v1/portal/voice-ticket", token, { bot_id: botId, ...(teacherId ? { teacher_id: teacherId } : {}) });
        if (disposed) return cleanup();
        const url = new URL(apiPrefix + "/v1/portal/voice", location.origin);
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("ticket", ticket);
        ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
          if (disposed || !context || !ws) return cleanup();
          source = context.createMediaStreamSource(stream);
          processor = new AudioWorkletNode(context, "speakool-mic");
          const silent = context.createGain(); silent.gain.value = 0;
          source.connect(processor); processor.connect(silent); silent.connect(context.destination);
          processor.port.onmessage = (event: MessageEvent<Int16Array>) => { if (ws?.readyState === WebSocket.OPEN) ws.send(new Int16Array(event.data).buffer); };
          setState("עוד רגע, המורה מצטרף…");
        };
        ws.onmessage = (event) => {
          if (disposed || !context) return;
          if (typeof event.data === "string") {
            try {
              const message = JSON.parse(event.data);
              if (message.type === "ready") { setConnected(true); setState("אפשר לדבר. אנחנו מקשיבים."); }
              if (message.type === "hangup" && Object.hasOwn(callErrors, message.reason)) {
                serverError = callErrors[message.reason];
                setError(serverError);
              }
            } catch { /* Optional status frames do not affect audio. */ }
            return;
          }
          const samples = new Int16Array(event.data as ArrayBuffer);
          if (!samples.length) return;
          receivedAudio ||= samples.some(n => Math.abs(n) > 100);
          if (receivedAudio) setConnected(true);
          const buffer = context.createBuffer(1, samples.length, 8000);
          buffer.getChannelData(0).set(Float32Array.from(samples, n => n / 32768));
          const audio = context.createBufferSource(); audio.buffer = buffer; audio.connect(context.destination);
          playAt = Math.max(context.currentTime + .025, playAt);
          if (playAt > context.currentTime + 2) playAt = context.currentTime + .025;
          audio.start(playAt); playAt += buffer.duration;
        };
        ws.onerror = () => { if (!disposed) setError("השיחה לא התחברה. אפשר לנסות שוב או להתקשר לקו."); };
        ws.onclose = () => {
          if (!disposed) {
            setConnected(false);
            if (!receivedAudio && !serverError) setError("לא הצלחנו לפתוח שיעור. כדאי לבדוק את יתרת הדקות או לנסות שוב.");
            else setState("עוד שיחה קטנה. עוד צעד קדימה.");
          }
          cleanup();
        };
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : "לא הצלחנו לפתוח את המיקרופון."); cleanup(); }
    };
    void start();
    return () => { disposed = true; cleanup(); };
  }, [token, botId, teacherId]);
  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => setSeconds(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [connected]);
  const toggleMic = () => { streamRef.current?.getAudioTracks().forEach(t => { t.enabled = muted; }); setMuted(!muted); };
  return <div className="sk-call">
    <div className={"sk-voice-orb " + (connected ? "is-speaking" : "")}><span /><span /><span /><Mic size={38} strokeWidth={1.1} /></div>
    <p className="sk-eyebrow">שיחה עם {name}</p><h2>{error ? "רגע קטן." : "פשוט לדבר."}</h2>
    <p role={error ? "alert" : "status"}>{error || state}</p>
    {connected && <p className="sk-timer" dir="ltr">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</p>}
    <div className="sk-actions">
      {connected && <button className="sk-icon" title={muted ? "פתיחת מיקרופון" : "השתקת מיקרופון"} aria-label={muted ? "פתיחת מיקרופון" : "השתקת מיקרופון"} aria-pressed={muted} onClick={toggleMic}>{muted ? <MicOff /> : <Mic />}</button>}
      <button className="sk-primary" onClick={() => closeRef.current()}><PhoneOff size={17} />{connected ? "נסיים כאן" : "בחזרה לפורטל"}</button>
    </div><small>כמו בטלפון, גם כאן השיחה משתמשת בדקות הלימוד שלך.</small>
  </div>;
}
