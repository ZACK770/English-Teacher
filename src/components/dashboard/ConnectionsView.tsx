import React, { useState } from 'react';
import { ShieldCheck, Key, Globe, Radio, Check, Copy, ExternalLink, Zap } from 'lucide-react';

export const ConnectionsView: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">חיבורים, ממשקי API ואבטחת תקשורת</h2>
        <p className="text-sm text-slate-500">
          ניהול נקודות קצה (Webhooks), ערוצי שמע בזמן אמת, הרשאות טכנוליין וסנכרון סליקה נדרים פלוס
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Technoline Telephony Config */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-indigo-600" />
              <h3 className="font-bold text-slate-800">מרכזיית Technoline (SIP/Audio)</h3>
            </div>
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              מחובר ומאומת
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="font-semibold text-slate-600 block mb-1">WebSocket Audio Stream URL (WSS)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value="wss://english.the-impact.net/v1/technoline/stream"
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px]"
                />
                <button
                  onClick={() =>
                    copyToClipboard(
                      'ws',
                      'wss://english.the-impact.net/v1/technoline/stream'
                    )
                  }
                  className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  {copied === 'ws' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-600 block mb-1">IVR Routing Callback Webhook (HTTPS POST)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value="https://english.the-impact.net/v1/technoline/ivr/school"
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px]"
                />
                <button
                  onClick={() =>
                    copyToClipboard(
                      'webhook',
                      'https://english.the-impact.net/v1/technoline/ivr/school'
                    )
                  }
                  className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  {copied === 'webhook' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-600 block mb-1">Technoline Authorized System Phone</label>
              <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px] text-slate-700">
                0765673575 (Subtree /99 ONLY)
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-600 block mb-1">כתובות IP מורשות (IP Whitelist)</label>
              <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px] text-slate-700">
                82.80.200.12, 82.80.200.13, 212.179.35.40/29
              </div>
            </div>
          </div>
        </div>

        {/* Nedarim Plus Payments */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Key className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-800">נדרים פלוס (סליקת מנויים וחבילות)</h3>
            </div>
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Webhook פעיל
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="font-semibold text-slate-600 block mb-1">כתובת חיווי תשלום (Callback URL)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value="https://english.the-impact.net/v1/payments/nedarim/callback"
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px]"
                />
                <button
                  onClick={() =>
                    copyToClipboard(
                      'nedarim',
                      'https://english.the-impact.net/v1/payments/nedarim/callback'
                    )
                  }
                  className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  {copied === 'nedarim' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-600 block mb-1">קוד מוסד (Mosad ID - docs/technoline-integration.md)</label>
              <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px] text-slate-700">
                7019554 (Dibura)
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-600 block mb-1">הקצאת דקות אוטומטית</label>
              <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-emerald-700 font-medium">
                סנכרון מיידי עם קבלת אסמכתא טלפונית / אינטרנטית
              </div>
            </div>
          </div>
        </div>

        {/* Gemini Live API Engine */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-slate-800">מנוע AI קולי בזמן אמת (Gemini Live)</h3>
            </div>
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              Low Latency Audio
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <span className="font-semibold text-slate-600 block mb-1">מודל פעיל:</span>
              <span className="font-mono text-slate-800 bg-slate-100 px-2 py-1 rounded">
                gemini-2.5-flash-native-audio
              </span>
            </div>
            <div>
              <span className="font-semibold text-slate-600 block mb-1">VAD (זיהוי דיבור אנושי):</span>
              <span className="text-slate-700">
                רגישות פתיחה: 50% | שקט לסיום: 450ms | תמיכה בקטיעת דיבור (Barge-in)
              </span>
            </div>
          </div>
        </div>

        {/* Cloudflare Worker / Mirror Relay */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-slate-800">שרתי Edge & עמידות (Render & Cloudflare)</h3>
            </div>
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              99.98% זמינות
            </span>
          </div>

          <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
            <p>
              האפליקציה פועלת בסביבת Node 22 ו-Vite עם תמיכה מלאה בהתרחבות אוטומטית ושמירת מידע מקומית ושרתית.
            </p>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900">
              שיחות הטלפון מנותבות ללא השהייה דרך מעקף שרת ה-SIP הייעודי.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
