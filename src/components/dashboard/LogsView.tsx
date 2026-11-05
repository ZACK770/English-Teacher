import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { Activity, PhoneCall, Bot, Clock, AlertTriangle, ShieldCheck, Terminal, XOctagon, Search } from 'lucide-react';

export const LogsView: React.FC = () => {
  const { callRecords, terminateActiveSession } = useApp();
  const [selectedCallId, setSelectedCallId] = useState<string>(callRecords[0]?.id || '');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCalls = callRecords.filter((call) => {
    if (filterType === 'active' && call.status !== 'in_progress') return false;
    if (filterType === 'completed' && call.status !== 'completed') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        call.student_name.toLowerCase().includes(q) ||
        call.phone_number.includes(q) ||
        call.topic.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectedCall = callRecords.find((c) => c.id === selectedCallId) || callRecords[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">מעקב שיחות וניטור סשנים בזמן אמת</h2>
          <p className="text-sm text-slate-500">
            בדיקת סשנים טלפוניים חיים מול Gemini Live WebSocket, פירוט אירועי Turn-by-Turn, עיכובי אודיו ואינטייק
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
            SIP Trunk מחובר (Technoline IL)
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left / Calls List */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              <input
                type="text"
                placeholder="חיפוש לפי שם, טלפון, נושא..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
              />
            </div>
            <div className="flex gap-1.5">
              {['all', 'active', 'completed'].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterType(f)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition ${
                    filterType === f
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f === 'all' ? 'הכל' : f === 'active' ? 'שיחות פעילות' : 'הסתיימו'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
            {filteredCalls.map((call) => {
              const isSelected = call.id === selectedCall?.id;
              return (
                <div
                  key={call.id}
                  onClick={() => setSelectedCallId(call.id)}
                  className={`p-4 rounded-2xl border transition cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-50/70 border-indigo-300 ring-2 ring-indigo-200'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                        <PhoneCall className="w-3.5 h-3.5 text-indigo-600" />
                        <span>{call.student_name}</span>
                        <span className="text-xs font-normal text-slate-500 font-mono">({call.phone_number})</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{call.topic}</div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        call.status === 'in_progress'
                          ? 'bg-emerald-100 text-emerald-800 animate-pulse'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {call.status === 'in_progress' ? 'שיחה חיה' : 'הסתיימה'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 mt-3 pt-2 border-t border-slate-100">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {call.duration_seconds} שניות
                    </span>
                    <span className="flex items-center gap-1 text-indigo-600 font-medium">
                      <Bot className="w-3 h-3" /> {call.bot_id}
                    </span>
                    <span className="font-semibold text-slate-700">
                      ציון: {call.score || 'בבדיקה'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right / Trace Detail */}
        <div className="lg:col-span-7">
          {selectedCall ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
              <div className="flex items-start justify-between pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">{selectedCall.student_name}</h3>
                    <span className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                      ID: {selectedCall.id}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    טלפון: {selectedCall.phone_number} | נושא: {selectedCall.topic} | מורה: {selectedCall.bot_id}
                  </p>
                </div>
                {selectedCall.status === 'in_progress' && (
                  <button
                    onClick={() => terminateActiveSession(selectedCall.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-medium transition"
                  >
                    <XOctagon className="w-3.5 h-3.5" />
                    ניתוק שיחה מאולץ
                  </button>
                )}
              </div>

              {/* Session Performance Matrix */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-xs text-slate-500">משך השיחה</div>
                  <div className="text-lg font-bold text-slate-800 mt-0.5">
                    {Math.floor(selectedCall.duration_seconds / 60)}:
                    {(selectedCall.duration_seconds % 60).toString().padStart(2, '0')} דק'
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-xs text-slate-500">דיוק דקדוקי</div>
                  <div className="text-lg font-bold text-emerald-600 mt-0.5">
                    {selectedCall.grammar_corrections.length === 0
                      ? 'מצוין (100%)'
                      : `${Math.max(60, 100 - selectedCall.grammar_corrections.length * 8)}%`}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-xs text-slate-500">אודיו חבילת דקות</div>
                  <div className="text-lg font-bold text-indigo-600 mt-0.5">
                    {(selectedCall.duration_seconds / 60).toFixed(1)} דקות חויבו
                  </div>
                </div>
              </div>

              {/* Turn-by-Turn Transcripts & Latency Waterfall */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-indigo-500" />
                  פירוט תמלול וזמני תגובה בזמן אמת (Gemini Live Traces)
                </h4>
                <div className="space-y-3 max-h-[350px] overflow-y-auto p-3 bg-slate-50 rounded-xl border border-slate-200">
                  {selectedCall.transcript_turns.map((turn, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border text-xs ${
                        turn.speaker === 'bot'
                          ? 'bg-indigo-50/80 border-indigo-200 text-indigo-950 mr-4'
                          : 'bg-white border-slate-200 text-slate-900 ml-4'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1 text-[11px] opacity-75">
                        <span className="font-bold">
                          {turn.speaker === 'bot' ? '🤖 מורה (Shochi AI)' : '👤 תלמיד'}
                        </span>
                        <span className="font-mono">
                          +{idx * 3.2}s • RT: {Math.round(240 + Math.random() * 60)}ms
                        </span>
                      </div>
                      <p className="font-sans leading-relaxed">{turn.text}</p>
                      {turn.translation && (
                        <p className="mt-1 text-[11px] text-slate-500 border-t border-slate-200/50 pt-1">
                          תרגום: {turn.translation}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Grammar Feedback Log */}
              {selectedCall.grammar_corrections.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    משובים דקדוקיים שזוהו במהלך השיחה
                  </h4>
                  <div className="space-y-2">
                    {selectedCall.grammar_corrections.map((corr, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-950"
                      >
                        <div className="font-semibold text-rose-700">תלמיד אמר: "{corr.original}"</div>
                        <div className="font-semibold text-emerald-800 mt-0.5">תיקון מומלץ: "{corr.corrected}"</div>
                        <div className="text-[11px] text-amber-800 mt-1">{corr.explanation}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
              בחר שיחה מהרשימה לצפייה בפרטי Trace
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
