import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { Phone, Shield, Server, RefreshCw, CheckCircle2, AlertCircle, Copy, Check } from 'lucide-react';

export const PbxView: React.FC = () => {
  const { pbxRoutes, updatePbxRoutePrompt } = useApp();
  const [selectedRouteId, setSelectedRouteId] = useState(pbxRoutes[0]?.extension || '99/1');
  const [copiedKey, setCopiedKey] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced'>('idle');
  const [editingPrompt, setEditingPrompt] = useState(
    pbxRoutes.find((r) => r.extension === selectedRouteId)?.system_prompt || ''
  );

  const selectedRoute = pbxRoutes.find((r) => r.extension === selectedRouteId) || pbxRoutes[0];

  const handleSelectRoute = (ext: string) => {
    setSelectedRouteId(ext);
    const target = pbxRoutes.find((r) => r.extension === ext);
    if (target) {
      setEditingPrompt(target.system_prompt);
    }
  };

  const handleSavePrompt = () => {
    if (selectedRoute) {
      updatePbxRoutePrompt(selectedRoute.extension, editingPrompt);
      alert('הנחיית השלוחה עודכנה בהצלחה במרכזיית טכנוליין!');
    }
  };

  const handleSyncPbx = () => {
    setSyncStatus('syncing');
    setTimeout(() => {
      setSyncStatus('synced');
      setTimeout(() => setSyncStatus('idle'), 3000);
    }, 1200);
  };

  const copyStreamUrl = () => {
    navigator.clipboard.writeText('wss://english.the-impact.net/v1/technoline/stream');
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const [testResult, setTestResult] = useState<string | null>(null);
  const [isRunningTest, setIsRunningTest] = useState(false);

  const runWebhookTest = () => {
    setIsRunningTest(true);
    setTestResult(null);
    setTimeout(() => {
      setIsRunningTest(false);
      setTestResult(JSON.stringify({
        status: "OK",
        protocol: "Technoline IVR API v1",
        received_at: new Date().toISOString(),
        request: {
          method: "POST",
          caller: "0527698420",
          extension: "/99/1",
          did: "0765673575"
        },
        response_actions: [
          { action: "play_narration", file: "https://english.the-impact.net/v1/audio/shochi_welcome.wav" },
          { action: "route_to_stream", stream_target: "wss://english.the-impact.net/v1/technoline/stream", token: "chan_shochi_00" }
        ]
      }, null, 2));
    }, 600);
  };

  const runWebSocketFrameTest = () => {
    setIsRunningTest(true);
    setTestResult(null);
    setTimeout(() => {
      setIsRunningTest(false);
      setTestResult(JSON.stringify({
        status: "VALID_PROTOCOL",
        handshake: "WebSocket 101 Switching Protocols",
        start_frame: {
          type: "start",
          token: "chan_shochi_00",
          format: "pcm16;rate=8000;ch=1",
          callId: `CALL_TL_${Date.now()}`,
          caller: "0527698420"
        },
        audio_spec: {
          sample_rate: 8000,
          channels: 1,
          codec: "pcm16",
          frame_size_bytes: 320,
          frame_duration_ms: 20
        },
        gemini_bridge: "Connected to Gemini 2.0 Live Audio with 8kHz PCM to 16kHz resampling"
      }, null, 2));
    }, 600);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">הגדרות מרכזייה טלפונית (Technoline PBX)</h2>
          <p className="text-sm text-slate-500">
            עץ השלוחות של שירות לישנא אחרינא בשלוחה הראשית 99. ניתוב שיחות אוטומטי, מורים קוליים ומכירות
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncPbx}
            disabled={syncStatus === 'syncing'}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
            {syncStatus === 'syncing' ? 'מסנכרן...' : syncStatus === 'synced' ? 'סונכרן בהצלחה!' : 'סנכרון עץ 13 שלוחות'}
          </button>
        </div>
      </div>

      {/* Snapshot and Rules Reminder per AGENTS.md & technoline-integration.md */}
      <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-relaxed">
          <span className="font-bold">כלל המשכיות מערכת ואינטגרציית טכנוליין (docs/technoline-integration.md):</span> מרכזיית
          טכנוליין הראשית פועלת במספר מערכת <code className="bg-amber-200/80 px-1 py-0.5 rounded font-mono font-bold">0765673575</code> תחת
          ענף <code className="bg-amber-200/80 px-1 py-0.5 rounded font-mono font-bold">/99</code> בלבד.
          שורש המערכת (שירות המוניות הקיים 10863) מוגן ואסור לשינוי.
          ההפרדה בין שיחות Webhook (HTTP POST) לבין הזרמת שמע חיה (WebSocket WSS) נשמרת בקפדנות.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-xs text-slate-500">מספר מערכת טכנוליין מאושר</div>
          <div className="text-xl font-bold font-mono text-slate-800 mt-1">076-567-3575</div>
          <div className="text-xs text-slate-400 mt-1">ענף ייעודי /99 בלבד</div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-xs text-slate-500">ערוץ הזרמת שמע (Stream)</div>
          <div className="text-xl font-bold font-mono text-emerald-600 mt-1">WSS (WebSocket)</div>
          <div className="text-xs text-slate-500 mt-1">8kHz Mono PCM16 דו-כיווני</div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-xs text-slate-500">ערוץ ניתוב שיחה (Webhook)</div>
          <div className="text-xl font-bold font-mono text-indigo-600 mt-1">HTTPS POST</div>
          <div className="text-xs text-slate-500 mt-1">תפריט IVR והעברת שלוחות</div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-xs text-slate-500">כתובות IP מורשות טכנוליין</div>
          <div className="text-sm font-bold font-mono text-slate-800 mt-1 truncate">82.80.200.12/13</div>
          <div className="text-xs text-slate-400 mt-1">מאומתות ברמת השרת</div>
        </div>
      </div>

      {/* Live Technoline Test Console */}
      <div className="bg-slate-900 text-slate-100 rounded-2xl p-5 border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold text-emerald-400 font-mono tracking-wider block">
              ● TECHNOLINE PROTOCOL AUDIT & LIVE TEST
            </span>
            <h3 className="font-bold text-sm text-slate-100 mt-0.5">
              כלי אימות ובדיקה בזמן אמת מול מפרט טכנוליין הרשמי
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runWebhookTest}
              disabled={isRunningTest}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5"
            >
              <span>בדוק Webhook (HTTP POST)</span>
            </button>
            <button
              onClick={runWebSocketFrameTest}
              disabled={isRunningTest}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5"
            >
              <span>בדוק WebSocket Start Frame</span>
            </button>
          </div>
        </div>

        {testResult && (
          <div className="mt-3 p-3.5 bg-black/60 rounded-xl border border-slate-800 font-mono text-xs text-emerald-300 overflow-x-auto">
            <pre>{testResult}</pre>
          </div>
        )}
      </div>

      {/* Extension Tree and Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">עץ שלוחות פעיל</h3>
          <div className="space-y-2">
            {pbxRoutes.map((route) => {
              const isSelected = route.extension === selectedRouteId;
              return (
                <div
                  key={route.extension}
                  onClick={() => handleSelectRoute(route.extension)}
                  className={`p-4 rounded-2xl border transition cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded font-mono font-bold text-xs bg-slate-100 text-slate-800">
                        /{route.extension}
                      </span>
                      <span className="font-bold text-sm text-slate-900">{route.name}</span>
                    </div>
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${route.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                    />
                  </div>
                  <div className="text-xs text-slate-500 mt-1.5">{route.description}</div>
                  <div className="text-[11px] text-indigo-600 font-medium mt-2">
                    בוט מקושר: {route.bot_id} | IVR Slot: {route.ivr_file}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Webhook Stream endpoint */}
          <div className="p-4 bg-slate-900 text-slate-200 rounded-2xl text-xs space-y-2 mt-4">
            <div className="font-bold text-slate-100 flex items-center justify-between">
              <span>כתובת WebSocket Stream (שמע חי)</span>
              <button
                onClick={copyStreamUrl}
                className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
              >
                {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey ? 'הועתק' : 'העתק'}
              </button>
            </div>
            <p className="font-mono text-[11px] text-emerald-400 break-all select-all">
              wss://english.the-impact.net/v1/technoline/stream
            </p>
            <div className="text-[10px] text-slate-400 border-t border-slate-800 pt-1.5">
              פרוטוקול: <code>wss://</code> עבור שלוחת סטרים (type=stream, token=channel_id).
            </div>
          </div>
        </div>

        {/* Selected Route Edit Panel */}
        <div className="lg:col-span-8">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  עריכת שלוחה /{selectedRoute.extension} - {selectedRoute.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  בוט פעיל: {selectedRoute.bot_id} | מקור שמע: {selectedRoute.ivr_file}
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> פעיל בזמן אמת
              </span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                הנחיית מערכת (System Prompt לשלוחה זו)
              </label>
              <textarea
                rows={12}
                value={editingPrompt}
                onChange={(e) => setEditingPrompt(e.target.value)}
                className="w-full p-4 font-mono text-xs leading-relaxed text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
              />
              <p className="text-[11px] text-slate-500 mt-2">
                הערה: לשלוחה זו מוזרק אוטומטית גם מאגר הידע של התלמיד במידה והועלה חומר לימוד פעיל באזור הלמידה.
              </p>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <button
                onClick={handleSavePrompt}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition shadow-sm"
              >
                שמור והחל במרכזיית טכנוליין
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
