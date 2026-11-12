import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { BotProfile, TutorControls, BotRole } from '../../types';
import { Bot, Plus, Copy, Settings, Check, ArrowRight, Play, Eye } from 'lucide-react';

export const BotsView: React.FC = () => {
  const { bots, controls, saveBotProfile, saveBotControls, createBot, duplicateBot, showToast } = useApp();

  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'identity' | 'prompt' | 'speech' | 'context' | 'access' | 'preview' | 'versions'>('identity');

  // Modals
  const [showNewBotModal, setShowNewBotModal] = useState(false);
  const [newBotId, setNewBotId] = useState('');
  const [newBotLabel, setNewBotLabel] = useState('');
  const [newBotRole, setNewBotRole] = useState<BotRole>('teacher');

  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateTargetId, setDuplicateTargetId] = useState('');
  const [duplicateNewLabel, setDuplicateNewLabel] = useState('');

  const selectedBot = bots.find(b => b.id === selectedBotId);
  const botControls = selectedBotId ? controls[selectedBotId] : null;

  // Local draft controls
  const [draftControls, setDraftControls] = useState<TutorControls | null>(null);
  const [draftProfile, setDraftProfile] = useState<BotProfile | null>(null);

  const openBotEditor = (bot: BotProfile) => {
    setSelectedBotId(bot.id);
    setDraftProfile({ ...bot });
    setDraftControls({ ...(controls[bot.id] || controls['maya-child']) });
    setActiveTab('identity');
  };

  const handleSaveBot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftProfile || !draftControls || !selectedBotId) return;

    saveBotProfile(draftProfile);
    saveBotControls(selectedBotId, draftControls);
  };

  const handleCreateBot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBotId.trim() || !newBotLabel.trim()) return;

    createBot({
      id: newBotId.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
      label: newBotLabel,
      role: newBotRole,
      audience: 'general'
    });

    setShowNewBotModal(false);
    setNewBotId('');
    setNewBotLabel('');
  };

  const handleDuplicateBot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBotId || !duplicateTargetId.trim() || !duplicateNewLabel.trim()) return;

    duplicateBot(selectedBotId, duplicateTargetId.toLowerCase().replace(/[^a-z0-9_-]/g, ''), duplicateNewLabel);
    setShowDuplicateModal(false);
    setDuplicateTargetId('');
    setDuplicateNewLabel('');
  };

  const roleLabels: Record<string, string> = {
    teacher: 'מורה',
    translator: 'תרגומון',
    sales: 'מכירות ואינטייק',
    service: 'שירות לקוחות',
    custom: 'מותאם אישית'
  };

  return (
    <div className="space-y-8" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">מרכז הניהול / מורים ובוטים</span>
          <h1 className="text-2xl font-black text-[#172b35] flex items-center gap-2">
            <span>בוטים ומורים</span>
          </h1>
          <p className="text-xs text-[#718087] mt-1">
            לכל בוט זהות, הנחיות, הגדרות דיבור וכתובת חיבור משלו בקו הטלפוני ובאתר.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedBotId ? (
            <button
              onClick={() => setSelectedBotId(null)}
              className="bg-[#fafbfc] border border-[#e3e8eb] hover:bg-white text-[#172b35] px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>חזרה לרשימת הבוטים</span>
            </button>
          ) : (
            <button
              onClick={() => setShowNewBotModal(true)}
              className="bg-[#137c69] hover:bg-[#0f6656] text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>יצירת בוט חדש</span>
            </button>
          )}
        </div>
      </div>

      {/* VIEW 1: Bots Grid */}
      {!selectedBotId && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {bots.map(b => (
            <div
              key={b.id}
              className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-xs flex flex-col justify-between hover:border-[#137c69] transition"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-[#e9f5f0] text-[#137c69] flex items-center justify-center font-bold text-lg">
                    <Bot className="w-6 h-6" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                      b.enabled ? 'bg-[#e9f5f0] text-[#137c69]' : 'bg-[#f5f6f8] text-[#718087]'
                    }`}>
                      {b.enabled ? 'פעיל' : 'מושהה'}
                    </span>
                    <span className="text-[11px] text-[#718087] bg-[#fafbfc] px-2 py-0.5 rounded-md border border-[#e3e8eb]">
                      גרסה {b.active_version}
                    </span>
                  </div>
                </div>

                <h3 className="font-extrabold text-lg text-[#172b35] mb-1">{b.label}</h3>
                <span className="text-xs font-semibold text-[#137c69] block mb-2">
                  {roleLabels[b.role] || b.role} • קהל: {b.audience}
                </span>
                <p className="text-xs text-[#718087] line-clamp-3 leading-relaxed mb-4">
                  {b.description}
                </p>
              </div>

              <div className="border-t border-[#f0f3f4] pt-4 flex items-center justify-between">
                <span className="text-[11px] text-[#718087]">
                  {b.channel_configured ? '● ערוץ טלפוני מוגדר' : '○ טרם הוגדר ערוץ טלפוני'}
                </span>
                <button
                  onClick={() => openBotEditor(b)}
                  className="bg-[#102d32] hover:bg-[#1a454d] text-white px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>עריכת הבוט ←</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW 2: Bot Editor with 7 Tabs */}
      {selectedBot && draftProfile && draftControls && (
        <div className="bg-white border border-[#e3e8eb] rounded-2xl shadow-xs overflow-hidden">
          {/* Editor Header Bar */}
          <div className="p-6 bg-[#fafbfc] border-b border-[#e3e8eb] flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold text-[#172b35]">{draftProfile.label}</h2>
                <span className="text-xs bg-[#e9f5f0] text-[#137c69] font-bold px-2 py-0.5 rounded">
                  {roleLabels[draftProfile.role]} • גרסה {draftProfile.active_version}
                </span>
              </div>
              <p className="text-xs text-[#718087]">
                נתיב WebSocket: <code className="font-mono text-[#102d32]" dir="ltr">{draftProfile.websocket_path}</code>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setDuplicateTargetId(`${draftProfile.id}_copy`);
                  setDuplicateNewLabel(`${draftProfile.label} · עותק`);
                  setShowDuplicateModal(true);
                }}
                className="bg-white border border-[#e3e8eb] text-[#172b35] hover:bg-[#fafbfc] px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>שכפול בוט</span>
              </button>
            </div>
          </div>

          {/* 7 Tabs Bar */}
          <div className="flex border-b border-[#e3e8eb] overflow-x-auto px-4 bg-white">
            {[
              { id: 'identity', label: 'זהות וניתוב' },
              { id: 'prompt', label: 'פרומפט ופתיחה' },
              { id: 'speech', label: 'קול, דיבור ו-VAD' },
              { id: 'context', label: 'תמלול והקשר' },
              { id: 'access', label: 'דקות ומכסות' },
              { id: 'preview', label: 'מה נשלח ל-AI' },
              { id: 'versions', label: 'גרסאות' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3.5 px-4 font-bold text-xs border-b-2 transition shrink-0 ${
                  activeTab === tab.id
                    ? 'border-[#137c69] text-[#137c69] bg-[#e9f5f0]/40'
                    : 'border-transparent text-[#718087] hover:text-[#172b35]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Editor Form */}
          <form onSubmit={handleSaveBot} className="p-6 space-y-6">
            {/* TAB 1: Identity */}
            {activeTab === 'identity' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
                <div>
                  <label className="font-bold text-[#718087] block mb-1">שם תצוגה של הבוט:</label>
                  <input
                    type="text"
                    required
                    value={draftProfile.label}
                    onChange={e => setDraftProfile({ ...draftProfile, label: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm font-semibold"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#718087] block mb-1">תפקיד במערכת:</label>
                  <select
                    value={draftProfile.role}
                    onChange={e => setDraftProfile({ ...draftProfile, role: e.target.value as BotRole })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm"
                  >
                    <option value="teacher">מורה (School)</option>
                    <option value="translator">תרגומון (Translator)</option>
                    <option value="sales">מכירות ואינטייק (Sales & Intake)</option>
                    <option value="service">שירות לקוחות (Customer Service)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-[#718087] block mb-1">קהל יעד:</label>
                  <select
                    value={draftProfile.audience}
                    onChange={e => setDraftProfile({ ...draftProfile, audience: e.target.value as any })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm"
                  >
                    <option value="general">כללי (שוכי הרובוט / קהל רחב)</option>
                    <option value="child">ילדים ובני נוער (מאיה)</option>
                    <option value="adult">מבוגרים ועסקים (אלכס)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-[#718087] block mb-1">מזהה ערוץ בטכנוליין (אופציונלי):</label>
                  <input
                    type="text"
                    value={draftProfile.channel_id || ''}
                    onChange={e => setDraftProfile({ ...draftProfile, channel_id: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm font-mono"
                    dir="ltr"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="font-bold text-[#718087] block mb-1">תיאור המורה ומטרות השיחה:</label>
                  <textarea
                    rows={3}
                    value={draftProfile.description}
                    onChange={e => setDraftProfile({ ...draftProfile, description: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs leading-relaxed"
                  />
                </div>

                <div className="flex items-center gap-6 pt-2 md:col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-[#172b35]">
                    <input
                      type="checkbox"
                      checked={draftProfile.enabled}
                      onChange={e => setDraftProfile({ ...draftProfile, enabled: e.target.checked })}
                      className="rounded text-[#137c69]"
                    />
                    <span>בוט פעיל במערכת</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer font-bold text-[#172b35]">
                    <input
                      type="checkbox"
                      checked={draftProfile.phone_enabled}
                      onChange={e => setDraftProfile({ ...draftProfile, phone_enabled: e.target.checked })}
                      className="rounded text-[#137c69]"
                    />
                    <span>פעיל בשיחות טלפון (מרכזייה שלוחה 99)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer font-bold text-[#172b35]">
                    <input
                      type="checkbox"
                      checked={draftProfile.web_enabled}
                      onChange={e => setDraftProfile({ ...draftProfile, web_enabled: e.target.checked })}
                      className="rounded text-[#137c69]"
                    />
                    <span>פעיל באתר (אזור התלמיד)</span>
                  </label>
                </div>
              </div>
            )}

            {/* TAB 2: Prompt & Opening */}
            {activeTab === 'prompt' && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="font-bold text-[#718087] block mb-1">
                    פרומפט המערכת (System Instructions ל-Gemini Live):
                  </label>
                  <textarea
                    rows={10}
                    required
                    value={draftControls.base_prompt}
                    onChange={e => setDraftControls({ ...draftControls, base_prompt: e.target.value })}
                    className="w-full p-3 rounded-xl border border-[#e3e8eb] font-mono text-xs leading-relaxed text-[#102d32]"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#718087] block mb-1">
                    הוראת הפתיחה ליצירת דיבור ראשוני:
                  </label>
                  <textarea
                    rows={2}
                    value={draftControls.opening_message}
                    onChange={e => setDraftControls({ ...draftControls, opening_message: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="font-bold text-[#718087] block mb-1">מטרה פדגוגית:</label>
                    <input
                      type="text"
                      value={draftControls.learning_goal}
                      onChange={e => setDraftControls({ ...draftControls, learning_goal: e.target.value })}
                      className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-[#718087] block mb-1">מדיניות סיום שיחה:</label>
                    <select
                      value={draftControls.ending_policy}
                      onChange={e => setDraftControls({ ...draftControls, ending_policy: e.target.value as any })}
                      className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs"
                    >
                      <option value="after_target_with_permission">לאחר משך היעד ובהסכמת התלמיד</option>
                      <option value="learner_only">רק לבקשת התלמיד</option>
                      <option value="model_discretion">לפי שיקול דעת המורה</option>
                    </select>
                  </div>
                </div>

                <div className="p-4 bg-[#fafbfc] border border-[#e3e8eb] rounded-xl grid grid-cols-2 gap-4">
                  <div>
                    <label className="font-bold text-[#718087] block mb-1">סגירה ללא דיבור מהלקוח (שניות שקט):</label>
                    <input
                      type="number"
                      value={draftControls.idle_timeout_seconds}
                      onChange={e => setDraftControls({ ...draftControls, idle_timeout_seconds: Number(e.target.value) })}
                      className="w-full p-2 rounded-lg border border-[#e3e8eb] text-xs font-semibold"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-[#718087] block mb-1">פעולת סיום שיחה:</label>
                    <select
                      value={draftControls.session_end_action}
                      onChange={e => setDraftControls({ ...draftControls, session_end_action: e.target.value as any })}
                      className="w-full p-2 rounded-lg border border-[#e3e8eb] text-xs"
                    >
                      <option value="return_to_menu">חזרה לתפריט המרכזייה</option>
                      <option value="hangup">ניתוק הקו</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Speech, Voice & VAD */}
            {activeTab === 'speech' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
                <div>
                  <label className="font-bold text-[#718087] block mb-1">מודל Gemini:</label>
                  <input
                    type="text"
                    value={draftControls.model}
                    onChange={e => setDraftControls({ ...draftControls, model: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] font-mono text-xs"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#718087] block mb-1">קול הבוט (Gemini Voice):</label>
                  <select
                    value={draftControls.voice}
                    onChange={e => setDraftControls({ ...draftControls, voice: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs font-semibold"
                  >
                    <option value="Puck">Puck (גברי חם וקליל - שוכי)</option>
                    <option value="Aoede">Aoede (נשי חם וסבלני - מאיה)</option>
                    <option value="Charon">Charon (גברי שקול - תרגומון)</option>
                    <option value="Fenrir">Fenrir (עמוק וסמכותי)</option>
                    <option value="Kore">Kore (בהיר ודינמי)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-[#718087] block mb-1">שפת פלט ראשית שנשלחת ל-Google:</label>
                  <input
                    type="text"
                    value={draftControls.language_code}
                    onChange={e => setDraftControls({ ...draftControls, language_code: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs font-mono"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#718087] block mb-1">טמפרטורת יצירתיות (0.0-1.0):</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={draftControls.temperature}
                    onChange={e => setDraftControls({ ...draftControls, temperature: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#718087] block mb-1">קטיעת הבוט כשהלקוח מדבר (Barge-in):</label>
                  <select
                    value={draftControls.activity_handling}
                    onChange={e => setDraftControls({ ...draftControls, activity_handling: e.target.value as any })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs"
                  >
                    <option value="START_OF_ACTIVITY_INTERRUPTS">לקטוע את תשובת הבוט מיד כשהלקוח מדבר</option>
                    <option value="NO_INTERRUPTION">לא לקטוע (המתן לסיום התשובה)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-[#718087] block mb-1">קול בבוט ניווט:</label>
                  <select
                    value={draftControls.navigation_voice ?? 'engine'}
                    onChange={e => setDraftControls({ ...draftControls, navigation_voice: e.target.value as any })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs"
                  >
                    <option value="engine">מנוע קבוע: משפטים מוגדרים מראש בקול Google (זול)</option>
                    <option value="gemini">Gemini מדבר: Gemini מנהל את השיחה ומקבל נתונים חיים</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-[#718087] block mb-1">זמן שקט לסיום תור (מילישניות):</label>
                  <input
                    type="number"
                    value={draftControls.vad_silence_ms}
                    onChange={e => setDraftControls({ ...draftControls, vad_silence_ms: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs"
                  />
                </div>
              </div>
            )}

            {/* TAB 4: Context & Vocabulary */}
            {activeTab === 'context' && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="font-bold text-[#718087] block mb-1">אוצר מילים מותאם אישית (Custom Vocabulary):</label>
                  <textarea
                    rows={4}
                    value={draftControls.custom_vocabulary.join('\n')}
                    onChange={e => setDraftControls({
                      ...draftControls,
                      custom_vocabulary: e.target.value.split('\n').filter(Boolean)
                    })}
                    placeholder="מונח אחד בכל שורה"
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="font-bold text-[#718087] block mb-1">סף דחיסת הקשר (טוקנים):</label>
                    <input
                      type="number"
                      value={draftControls.context_trigger_tokens}
                      onChange={e => setDraftControls({ ...draftControls, context_trigger_tokens: Number(e.target.value) })}
                      className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-[#718087] block mb-1">יעד לאחר דחיסה:</label>
                    <input
                      type="number"
                      value={draftControls.context_target_tokens}
                      onChange={e => setDraftControls({ ...draftControls, context_target_tokens: Number(e.target.value) })}
                      className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: Access & Quotas */}
            {activeTab === 'access' && (
              <div className="space-y-4 text-xs">
                <div className="p-3.5 bg-[#eff4f3] rounded-xl border border-[#d2e4de] text-[#137c69]">
                  הגדרת מכסות שיחה ואכיפת דקות. בוט זה מוגדר להעביר לשלוחת סיום מכסה (/99/8) כאשר היתרה נגמרת.
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="font-bold text-[#718087] block mb-1">שיחות חינם לאדם בחודש:</label>
                    <input type="number" defaultValue={2} className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs" />
                  </div>
                  <div>
                    <label className="font-bold text-[#718087] block mb-1">משך שיחה חינמית (שניות):</label>
                    <input type="number" defaultValue={120} className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs" />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 6: Preview */}
            {activeTab === 'preview' && (
              <div className="space-y-3 text-xs">
                <span className="font-bold text-[#718087] block">מבנה Setup Message הנשלח ל-Gemini:</span>
                <pre className="bg-[#102d32] text-[#dceab7] p-4 rounded-xl overflow-x-auto font-mono text-[11px] leading-relaxed" dir="ltr">
                  {JSON.stringify({
                    model: draftControls.model,
                    generationConfig: {
                      responseModalities: ['AUDIO'],
                      speechConfig: {
                        voiceConfig: {
                          prebuiltVoiceConfig: { voiceName: draftControls.voice }
                        }
                      },
                      temperature: draftControls.temperature
                    },
                    systemInstruction: {
                      parts: [{ text: draftControls.base_prompt }]
                    }
                  }, null, 2)}
                </pre>
              </div>
            )}

            {/* TAB 7: Versions */}
            {activeTab === 'versions' && (
              <div className="space-y-2 text-xs">
                <div className="p-3 bg-[#fafbfc] border border-[#e3e8eb] rounded-xl flex items-center justify-between">
                  <div>
                    <span className="font-bold text-[#172b35] block">גרסה {draftProfile.active_version} (נוכחית)</span>
                    <span className="text-[#718087] text-[11px]">פורסמה לפני זמן קצר • מודל {draftControls.model}</span>
                  </div>
                  <span className="text-xs bg-[#e9f5f0] text-[#137c69] px-2 py-0.5 rounded font-bold">פעילה בקו</span>
                </div>
              </div>
            )}

            {/* Actions Bar */}
            <div className="pt-4 border-t border-[#f0f3f4] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelectedBotId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#718087] hover:bg-[#fafbfc]"
              >
                סגירה
              </button>
              <button
                type="submit"
                className="bg-[#137c69] hover:bg-[#0f6656] text-white px-6 py-2.5 rounded-xl text-xs font-bold shadow-sm transition"
              >
                שמירת שינויים ופרסום גרסה
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Bot Modal */}
      {showNewBotModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#e3e8eb] shadow-xl max-w-md w-full p-6 text-right" dir="rtl">
            <h3 className="font-bold text-lg text-[#172b35] mb-4">יצירת בוט / מורה חדש</h3>
            <form onSubmit={handleCreateBot} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-[#718087] block mb-1">מזהה באנגלית (למשל: tutor-tom):</label>
                <input
                  type="text"
                  required
                  value={newBotId}
                  onChange={e => setNewBotId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb] font-mono"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">שם הבוט בעברית:</label>
                <input
                  type="text"
                  required
                  value={newBotLabel}
                  onChange={e => setNewBotLabel(e.target.value)}
                  placeholder="למשל: תום (אנגלית לתיירות)"
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                />
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">תפקיד:</label>
                <select
                  value={newBotRole}
                  onChange={e => setNewBotRole(e.target.value as BotRole)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                >
                  <option value="teacher">מורה (School)</option>
                  <option value="translator">תרגומון (Translator)</option>
                  <option value="sales">מכירות ואינטייק (Sales)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewBotModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#718087]"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="bg-[#137c69] text-white px-5 py-2 rounded-xl font-bold shadow-sm"
                >
                  צור בוט
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Duplicate Bot Modal */}
      {showDuplicateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#e3e8eb] shadow-xl max-w-md w-full p-6 text-right" dir="rtl">
            <h3 className="font-bold text-lg text-[#172b35] mb-4">שכפול בוט קיים</h3>
            <form onSubmit={handleDuplicateBot} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-[#718087] block mb-1">מזהה הבוט המשוכפל באנגלית:</label>
                <input
                  type="text"
                  required
                  value={duplicateTargetId}
                  onChange={e => setDuplicateTargetId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb] font-mono"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">שם התצוגה בעברית:</label>
                <input
                  type="text"
                  required
                  value={duplicateNewLabel}
                  onChange={e => setDuplicateNewLabel(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDuplicateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#718087]"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="bg-[#137c69] text-white px-5 py-2 rounded-xl font-bold shadow-sm"
                >
                  שכפל
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
