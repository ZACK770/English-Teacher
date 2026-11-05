import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { UserCheck, Sparkles, BookOpen, Volume2, ShieldAlert, Award, ChevronRight, History } from 'lucide-react';

export const LegacyConsole: React.FC = () => {
  const { customers, callRecords, playTtsAudio } = useApp();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(customers[0]?.id || '');
  const [activeCategory, setActiveCategory] = useState<'profile' | 'radar' | 'history'>('profile');

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) || customers[0];
  const customerCalls = callRecords.filter(
    (c) => c.student_name === selectedCustomer?.full_name || c.phone_number === selectedCustomer?.phone
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Notice header */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between text-xs text-amber-900">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
          <span>
            <strong>קונסולת מורה מקורית (Legacy Teacher Console):</strong> ממשק פדגוגי למעקב פרטני אחר התקדמות תלמיד,
            ציון שפה וניתוח טעויות משיעורי הטלפון.
          </span>
        </div>
        <span className="font-mono bg-white/80 px-2.5 py-1 rounded-lg border border-amber-200">
          /dashboard/legacy
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Student Selector Sidebar */}
        <div className="md:col-span-4 bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
          <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-indigo-600" />
            רשימת תלמידים להוראה
          </h3>
          <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
            {customers.map((c) => {
              const isSelected = c.id === selectedCustomer?.id;
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedCustomerId(c.id)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition ${
                    isSelected
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-900 font-bold'
                      : 'border-slate-100 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{c.full_name}</span>
                    <span className="font-mono text-[11px] text-slate-500">{c.phone}</span>
                  </div>
                  <div className="text-[11px] font-normal text-slate-500 mt-1 flex justify-between">
                    <span>יתרה: {c.balance_minutes} דק'</span>
                    <span className="text-indigo-600">רמה: {c.current_level}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Student Card & Pedagogical Analytics */}
        <div className="md:col-span-8 space-y-4">
          {selectedCustomer ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
              <div className="flex items-start justify-between pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{selectedCustomer.full_name}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    טלפון: {selectedCustomer.phone} • רמה לימודית: {selectedCustomer.current_level} • הצטרף: {selectedCustomer.created_at}
                  </p>
                </div>
                <div className="text-left">
                  <div className="text-xs text-slate-500">דקות שנותרו</div>
                  <div className="text-2xl font-bold text-indigo-600 font-mono">
                    {selectedCustomer.balance_minutes} דק'
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 border-b border-slate-100 pb-2">
                <button
                  onClick={() => setActiveCategory('profile')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeCategory === 'profile'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  מדדי שליטה ולקסיקון
                </button>
                <button
                  onClick={() => setActiveCategory('radar')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeCategory === 'radar'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  מפת כישורי שפה (CEFR)
                </button>
                <button
                  onClick={() => setActiveCategory('history')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeCategory === 'history'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  היסטוריית שיחות הוראה ({customerCalls.length})
                </button>
              </div>

              {/* Tab 1: Profile & Metrics */}
              {activeCategory === 'profile' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                      <div className="text-xs text-slate-500">שיחות שבוצעו</div>
                      <div className="text-xl font-bold text-indigo-700 mt-0.5">{selectedCustomer.total_calls}</div>
                    </div>
                    <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
                      <div className="text-xs text-slate-500">מילים שנרכשו</div>
                      <div className="text-xl font-bold text-emerald-700 mt-0.5">
                        {selectedCustomer.vocab_words_mastered}
                      </div>
                    </div>
                    <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-100">
                      <div className="text-xs text-slate-500">רצף למידה יומי (Streak)</div>
                      <div className="text-xl font-bold text-amber-700 mt-0.5">
                        {selectedCustomer.streak_days} ימים 🔥
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-700 space-y-2">
                    <div className="font-bold text-slate-800">הערות פדגוגיות של מורה ה-AI (Shochi / Maya):</div>
                    <p className="leading-relaxed">
                      התלמיד מגלה שיפור ניכר בביטחון העצמי בזמן שיחה טלפונית. זמני ההיסוס פחתו ב-40%. מומלץ להתמקד בשיעור הבא בהרחבת משפטים מורכבים בזמן עבר (Past Simple vs Past Perfect)
                      ותרגול דיאלוגים מתחום הנדל"ן והמשא ומתן.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 2: Radar / CEFR Breakdown */}
              {activeCategory === 'radar' && (
                <div className="space-y-3">
                  <div className="space-y-2 text-xs">
                    <div>
                      <div className="flex justify-between font-medium text-slate-700 mb-1">
                        <span>אוצר מילים שימושי (Vocabulary):</span>
                        <span>82%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-indigo-600 h-full rounded-full" style={{ width: '82%' }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between font-medium text-slate-700 mb-1">
                        <span>שטף ומהירות תגובה (Fluency):</span>
                        <span>74%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-emerald-600 h-full rounded-full" style={{ width: '74%' }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between font-medium text-slate-700 mb-1">
                        <span>דיוק דקדוקי (Grammar Accuracy):</span>
                        <span>68%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-amber-500 h-full rounded-full" style={{ width: '68%' }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between font-medium text-slate-700 mb-1">
                        <span>הגייה והבנת שמיעה (Pronunciation & Listening):</span>
                        <span>89%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-purple-600 h-full rounded-full" style={{ width: '89%' }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: History */}
              {activeCategory === 'history' && (
                <div className="space-y-3">
                  {customerCalls.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-400">
                      אין היסטוריית שיחות מתועדת לתלמיד זה במאגר
                    </div>
                  ) : (
                    customerCalls.map((call) => (
                      <div key={call.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800">{call.topic}</span>
                          <span className="text-slate-400">{call.date} • {call.duration_seconds} שניות</span>
                        </div>
                        <div className="text-slate-600">
                          ציון שיחה: <strong className="text-emerald-700">{call.score || 'ללא'}</strong>
                        </div>
                        {call.grammar_corrections.length > 0 && (
                          <div className="text-[11px] text-amber-800 bg-amber-50/70 p-2 rounded-lg border border-amber-200/50">
                            תיקון דקדוק: {call.grammar_corrections[0].original} ➔ {call.grammar_corrections[0].corrected}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
              בחר תלמיד להצגת נתונים פדגוגיים
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
