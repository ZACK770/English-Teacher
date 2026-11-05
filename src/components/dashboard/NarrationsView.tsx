import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { Volume2, Play, Pause, Download, Plus, CheckCircle, RefreshCw } from 'lucide-react';

export const NarrationsView: React.FC = () => {
  const { narrations, addNarration, updateNarrationStatus, playTtsAudio } = useApp();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSlot, setNewSlot] = useState('welcome');
  const [newScript, setNewScript] = useState('');
  const [newVoice, setNewVoice] = useState('Puck');

  const handlePlay = (id: string, text: string) => {
    if (playingId === id) {
      setPlayingId(null);
    } else {
      setPlayingId(id);
      playTtsAudio(text);
      setTimeout(() => setPlayingId(null), 3000);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newScript.trim()) return;

    addNarration({
      title: newTitle,
      slot: newSlot,
      hebrew_script: newScript,
      english_script: '',
      voice: newVoice,
      status: 'ready',
    });

    setNewTitle('');
    setNewScript('');
    setShowAddModal(false);
  };

  const downloadWav = (title: string, text: string) => {
    // Generate a simple dummy audio or text download
    const blob = new Blob([`Audio script recording for: ${title}\n\n${text}`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}_recording.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">ספריית הקלטות וקריינות IVR</h2>
          <p className="text-sm text-slate-500">
            ניהול קבצי השמע וההנחיות הקוליות במרכזיית טכנוליין (שלוחה 99). הפקה מיידית בקולות ה-AI והורדה ל-PBX.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition shadow-sm"
        >
          <Plus className="w-4 h-4" />
          הפקת קריינות חדשה
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-xs font-medium text-slate-500">קריינויות פעילות במרכזייה</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{narrations.filter(n => n.status === 'published').length}</div>
          <div className="text-xs text-emerald-600 mt-1">מקושרות לשלוחות 99/1, 99/2, 99/3</div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-xs font-medium text-slate-500">הקלטות ממתינות לפרסום</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{narrations.filter(n => n.status === 'ready').length}</div>
          <div className="text-xs text-amber-600 mt-1">מוכנות להאזנה ואישור</div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-xs font-medium text-slate-500">פורמט טכנוליין נדרש</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">WAV / 8kHz</div>
          <div className="text-xs text-slate-500 mt-1">PCM 16-bit Mono</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">רשימת קריינויות ושיבוצים</h3>
          <span className="text-xs text-slate-500">{narrations.length} פריטים במאגר</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs uppercase font-medium">
              <tr>
                <th className="px-6 py-3">שם הקריינות</th>
                <th className="px-6 py-3">מיקום ב-IVR</th>
                <th className="px-6 py-3">טקסט ההודעה</th>
                <th className="px-6 py-3">קול ושפה</th>
                <th className="px-6 py-3">סטטוס</th>
                <th className="px-6 py-3 text-center">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {narrations.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/70 transition">
                  <td className="px-6 py-4 font-medium text-slate-800">
                    <div className="flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-indigo-500" />
                      <span>{item.title}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-slate-100 text-slate-700">
                      {item.slot}
                    </span>
                  </td>
                  <td className="px-6 py-4 max-w-md text-slate-600 line-clamp-2">
                    {item.hebrew_script}
                  </td>
                  <td className="px-6 py-4 text-slate-500">
                    <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                      {item.voice}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                        item.status === 'published'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {item.status === 'published' ? (
                        <>
                          <CheckCircle className="w-3 h-3" /> פורסם למרכזייה
                        </>
                      ) : (
                        'ממתין לסנכרון'
                      )}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handlePlay(item.id, item.hebrew_script || item.text || '')}
                        className={`p-2 rounded-lg text-xs font-medium transition flex items-center gap-1 ${
                          playingId === item.id
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                        }`}
                        title="השמעת דגימה"
                      >
                        {playingId === item.id ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        {playingId === item.id ? 'מנגן...' : 'האזן'}
                      </button>
                      <button
                        onClick={() => downloadWav(item.title || item.name || 'קריינות', item.hebrew_script || item.text || '')}
                        className="p-2 rounded-lg text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
                        title="הורדת קובץ WAV לטכנוליין"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() =>
                          updateNarrationStatus(
                            item.id,
                            item.status === 'published' ? 'ready' : 'published'
                          )
                        }
                        className={`p-2 rounded-lg text-xs font-medium transition ${
                          item.status === 'published'
                            ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                        title="שנה סטטוס פרסום"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-4">הפקת קריינות טלפונית חדשה (IVR)</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">כותרת הקריינות</label>
                <input
                  type="text"
                  required
                  placeholder="למשל: ברוכים הבאים לבית הספר"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">שלוחת שיבוץ</label>
                  <select
                    value={newSlot}
                    onChange={(e) => setNewSlot(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                  >
                    <option value="welcome">/99 - הודעת פתיחה ראשית</option>
                    <option value="school_intro">/99/1 - פתיחת בית ספר שוכי</option>
                    <option value="translator_intro">/99/2 - שלוחת מתורגמן חי</option>
                    <option value="intake_intro">/99/3 - שיחת מכירה ואינטייק</option>
                    <option value="quota_exhausted">הודעת מיצוי דקות</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">קול קריין (Gemini Voice)</label>
                  <select
                    value={newVoice}
                    onChange={(e) => setNewVoice(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                  >
                    <option value="Puck">Puck (חם, צעיר וסוחף - שוכי)</option>
                    <option value="Charon">Charon (עמוק, בטוח וסמכותי)</option>
                    <option value="Kore">Kore (טבעית, סבלנית ומעודדת - מיה)</option>
                    <option value="Fenrir">Fenrir (קצבי ודינמי)</option>
                    <option value="Aoede">Aoede (אלגנטית וברורה)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">טקסט ההקלטה (בעברית או אנגלית)</label>
                <textarea
                  rows={4}
                  required
                  placeholder="הזן את המילים שיוקלטו במדויק ויושמעו למתקשר..."
                  value={newScript}
                  onChange={(e) => setNewScript(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition"
                >
                  הפקה וסנכרון
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
