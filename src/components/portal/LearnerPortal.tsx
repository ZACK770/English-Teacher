import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import {
  BookOpen,
  Gamepad2,
  PhoneCall,
  History,
  Upload,
  CheckCircle2,
  Flame,
  Volume2,
  Sparkles,
  Send,
  Trash2,
  FileText,
  Calendar,
  Lock,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Play
} from 'lucide-react';
import { WordMatchGame } from '../games/WordMatchGame';
import { SentenceBuilderGame } from '../games/SentenceBuilderGame';
import { ListeningQuizGame } from '../games/ListeningQuizGame';
import { RoleplayDialogGame } from '../games/RoleplayDialogGame';

export const LearnerPortal: React.FC = () => {
  const {
    customers,
    activeLearnerId,
    setActiveLearnerId,
    bots,
    studyMaterials,
    addStudyMaterial,
    toggleMaterialActiveForPhone,
    deleteStudyMaterial,
    detailedCalls,
    gameScores,
    receipts,
    packages,
    sendLearnerMessage,
    showToast
  } = useApp();

  const currentCustomer = customers.find(c => c.id === activeLearnerId) || customers[0];

  // Tabs
  type PortalTab = 'practice' | 'materials' | 'games' | 'history';
  const [activeTab, setActiveTab] = useState<PortalTab>('materials');

  // Active game in Arena
  const [selectedGame, setSelectedGame] = useState<'word_match' | 'sentence_builder' | 'listening_quiz' | 'roleplay_dialog'>('word_match');

  // File / Text Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadTopic, setUploadTopic] = useState('');
  const [uploadLevel, setUploadLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');
  const [uploadText, setUploadText] = useState('');
  const [isScanningFile, setIsScanningFile] = useState(false);

  // Live Chat in Practice Room
  const [selectedTeacherId, setSelectedTeacherId] = useState(currentCustomer.preferred_bot || 'shochi-robot');
  const [practiceMode, setPracticeMode] = useState<'course' | 'free' | 'translation'>('free');
  const [targetTranslationLang, setTargetTranslationLang] = useState('English');
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(detailedCalls[0]?.call_id || null);

  // Filtered customer materials
  const myMaterials = studyMaterials.filter(m => m.customer_id === currentCustomer.id);
  const activePhoneMaterial = myMaterials.find(m => m.is_active_for_phone);

  // Customer receipts & minutes
  const myReceipts = receipts.filter(r => r.customer_id === currentCustomer.id);
  const totalMinutes = myReceipts.reduce((acc, r) => acc + (r.minutes - r.spent_seconds / 60), 0);
  const totalPoints = gameScores.filter(g => g.customer_id === currentCustomer.id).reduce((acc, g) => acc + g.points_earned, 140);

  // Habit loop state
  const dailyStreak = 5;
  const dailyFreeCallsRemaining = 0; // Trigger desire/urgency: 0 left today, upgrade or wait

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanningFile(true);
    showToast(`סורק ומעבד את הקובץ "${file.name}" למאגר הידע...`);

    // Simulated OCR / PDF text extraction
    setTimeout(() => {
      setIsScanningFile(false);
      setUploadTitle(file.name.replace(/\.[^/.]+$/, ''));
      setUploadTopic('סריקת מסמך וחומרי לימוד');
      setUploadText(`Key concepts extracted from ${file.name}:
Executive Summary: Modern English communication in professional settings.
Vocabulary:
Agenda - סדר יום
Milestone - אבן דרך בפרויקט
Deliverable - תוצר מוסכם
Follow-up - שיחת המשך
Action item - משימה לביצוע

Key Sentences:
We should align on the project milestones during our next sync.
Please ensure all deliverables are reviewed before Friday.`);
    }, 1200);
  };

  const handleSaveMaterial = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTitle.trim() || !uploadText.trim()) return;

    addStudyMaterial({
      title: uploadTitle,
      topic: uploadTopic || 'כללי',
      level: uploadLevel,
      rawText: uploadText
    });

    setShowUploadModal(false);
    setUploadTitle('');
    setUploadTopic('');
    setUploadText('');
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isSending) return;

    setIsSending(true);
    const text = chatInput;
    setChatInput('');
    try {
      await sendLearnerMessage(text, selectedTeacherId, practiceMode, targetTranslationLang);
    } finally {
      setIsSending(false);
    }
  };

  const playSpeech = (text: string, lang: string = 'en-US') => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      window.speechSynthesis.speak(u);
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8" dir="rtl">
      {/* Top Profile & Welcome Bar */}
      <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 mb-8 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#102d32] text-[#dceab7] flex items-center justify-center text-2xl font-black shadow-sm">
              {currentCustomer.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#137c69] tracking-wider uppercase">אזור התלמיד האישי · לישנא אחרינא</span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-[#fff4df] text-[#93661e]">
                  <Flame className="w-3.5 h-3.5 fill-current" />
                  רצף {dailyStreak} ימים
                </span>
              </div>
              <h1 className="text-2xl font-extrabold text-[#172b35]">
                שלום, {currentCustomer.name}
              </h1>
              <p className="text-xs text-[#718087] mt-0.5">
                החשבון, הדקות וחומרי הלימוד שלך מסונכרנים אוטומטית בין האתר לשיחה הטלפונית בקו.
              </p>
            </div>
          </div>

          {/* Quick Learner Profile Switcher */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#718087]">החלף משתמש לבדיקה:</span>
            <select
              value={activeLearnerId}
              onChange={e => setActiveLearnerId(e.target.value)}
              className="text-xs font-semibold bg-[#fafbfc] border border-[#e3e8eb] rounded-lg px-3 py-1.5 text-[#172b35] focus:outline-none focus:border-[#137c69]"
            >
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Metric Cards Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[#f0f3f4]">
          <div className="bg-[#fafbfc] p-3.5 rounded-xl border border-[#e3e8eb]">
            <span className="text-xs text-[#718087] block">נקודות הישג</span>
            <span className="text-2xl font-black text-[#172b35] tabular-nums">{totalPoints}</span>
            <span className="text-[11px] text-[#137c69] block mt-0.5">רמה 4 · מתקדם</span>
          </div>

          <div className="bg-[#fafbfc] p-3.5 rounded-xl border border-[#e3e8eb]">
            <span className="text-xs text-[#718087] block">יתרת דקות שיחה</span>
            <span className="text-2xl font-black text-[#137c69] tabular-nums">
              {Math.max(0, totalMinutes).toFixed(1)}
            </span>
            <span className="text-[11px] text-[#718087] block mt-0.5">מתוך {myReceipts.length} חבילות פעילות</span>
          </div>

          <div className="bg-[#fafbfc] p-3.5 rounded-xl border border-[#e3e8eb]">
            <span className="text-xs text-[#718087] block">חומרים פעילים בטלפון</span>
            <span className="text-2xl font-black text-[#172b35] tabular-nums">
              {activePhoneMaterial ? 1 : 0}
            </span>
            <span className="text-[11px] text-[#718087] block mt-0.5 truncate max-w-[180px]">
              {activePhoneMaterial ? activePhoneMaterial.title : 'טרם נבחר נושא'}
            </span>
          </div>

          <div className="bg-[#fafbfc] p-3.5 rounded-xl border border-[#e3e8eb]">
            <span className="text-xs text-[#718087] block">שיחות שתועדו</span>
            <span className="text-2xl font-black text-[#172b35] tabular-nums">
              {detailedCalls.filter(c => c.customer_id === currentCustomer.id).length}
            </span>
            <span className="text-[11px] text-[#718087] block mt-0.5">כולל תמלילים וניתוח הגייה</span>
          </div>
        </div>

        {/* Habit & Desire Notice (Hook Model) */}
        <div className="mt-5 p-3.5 rounded-xl bg-[#eff4f3] border border-[#d2e4de] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#137c69]">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>
              <strong>מנגנון התמדה יומי:</strong> ניצלת את שיחת ההיכרות היומית להיום. השיחה הבאה תפתח מחר ב-08:00 בבוקר, או שדרג לחבילת דקות מלאה כדי להמשיך ברצף ללא הגבלה!
            </span>
          </div>
          <button
            onClick={() => showToast('מעבר למסך רכישת חבילת דקות')}
            className="bg-[#137c69] text-white hover:bg-[#0f6656] px-3.5 py-1.5 rounded-lg font-bold transition shrink-0"
          >
            שדרוג לחבילה מלאה ←
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-[#e3e8eb] mb-8 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('materials')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition shrink-0 ${
            activeTab === 'materials'
              ? 'bg-[#102d32] text-white shadow-sm'
              : 'text-[#718087] hover:text-[#172b35] hover:bg-white'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>החומרים והספרים שלי</span>
          {activePhoneMaterial && (
            <span className="w-2 h-2 rounded-full bg-[#dceab7]" title="חומר פעיל בטלפון" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('games')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition shrink-0 ${
            activeTab === 'games'
              ? 'bg-[#102d32] text-white shadow-sm'
              : 'text-[#718087] hover:text-[#172b35] hover:bg-white'
          }`}
        >
          <Gamepad2 className="w-4 h-4" />
          <span>משחקוני תרגול אינטראקטיביים</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition shrink-0 ${
            activeTab === 'history'
              ? 'bg-[#102d32] text-white shadow-sm'
              : 'text-[#718087] hover:text-[#172b35] hover:bg-white'
          }`}
        >
          <History className="w-4 h-4" />
          <span>יומן שיחות ותמלילים מפורטים</span>
        </button>

        <button
          onClick={() => setActiveTab('practice')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition shrink-0 ${
            activeTab === 'practice'
              ? 'bg-[#102d32] text-white shadow-sm'
              : 'text-[#718087] hover:text-[#172b35] hover:bg-white'
          }`}
        >
          <PhoneCall className="w-4 h-4" />
          <span>חדר אימון אינטראקטיבי</span>
        </button>
      </div>

      {/* TAB 1: Materials Upload & Telephone Sync */}
      {activeTab === 'materials' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-[#172b35] flex items-center gap-2">
                  <span>מאגר חומרי הלימוד והספרים שלי</span>
                </h2>
                <p className="text-xs text-[#718087] mt-1">
                  העלו טקסטים, ספרים או רשימות מילים. המערכת תסרוק אותם ליחידות ידע ותלביש את השיחה הטלפונית הבאה על הנושא שתבחרו!
                </p>
              </div>

              <button
                onClick={() => setShowUploadModal(true)}
                className="bg-[#137c69] hover:bg-[#0f6656] text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm transition inline-flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                <span>העלאת חומר לימוד חדש</span>
              </button>
            </div>

            {/* Currently Active For Phone Banner */}
            {activePhoneMaterial ? (
              <div className="bg-[#e9f5f0] border border-[#b8dfd1] rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#137c69] text-white flex items-center justify-center font-bold">
                    <PhoneCall className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold text-[#137c69] uppercase tracking-wider block">
                      ● מוגדר כעת לשיחה הטלפונית הבאה
                    </span>
                    <h3 className="font-bold text-[#172b35] text-sm">{activePhoneMaterial.title}</h3>
                    <p className="text-xs text-[#718087]">
                      כשחייגת ל-99/1 או שוכי יתקשר אליך – המורה יתמקד ב-{activePhoneMaterial.vocabulary.length} מילים ומשפטי המפתח שהעלית!
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => toggleMaterialActiveForPhone(activePhoneMaterial.id)}
                  className="text-xs bg-white border border-[#b8dfd1] text-[#137c69] hover:bg-[#137c69] hover:text-white px-3 py-1.5 rounded-lg font-semibold transition"
                >
                  הסר מסנכרון טלפוני
                </button>
              </div>
            ) : (
              <div className="bg-[#f5f6f8] border border-[#e3e8eb] rounded-xl p-4 mb-6 text-xs text-[#718087] flex items-center justify-between">
                <span>טרם בחרת חומר שיוזרק לשיחה הטלפונית. בחר חומר מהרשימה מטה והקלק "סנכרן לשיחה בקו".</span>
              </div>
            )}

            {/* Materials Grid */}
            {myMaterials.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-[#e3e8eb] rounded-2xl">
                <FileText className="w-12 h-12 text-[#94a3b8] mx-auto mb-3" />
                <h3 className="font-bold text-base text-[#172b35] mb-1">עדיין אין חומרי לימוד שמורים</h3>
                <p className="text-xs text-[#718087] max-w-sm mx-auto mb-4">
                  העלו קובץ שיעורי בית, עמוד מספר או רשימת מילים מקצועית מעולמכם כדי שהמורה יתרגל איתכם בטלפון.
                </p>
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="bg-[#137c69] text-white px-4 py-2 rounded-xl text-xs font-bold transition"
                >
                  העלאת חומר ראשון
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {myMaterials.map(mat => {
                  const isActive = mat.is_active_for_phone;
                  return (
                    <div
                      key={mat.id}
                      className={`p-5 rounded-2xl border transition-all ${
                        isActive
                          ? 'bg-white border-[#137c69] shadow-md ring-1 ring-[#137c69]/20'
                          : 'bg-[#fafbfc] border-[#e3e8eb] hover:bg-white hover:border-[#cbd5e1]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <span className="text-[11px] font-semibold text-[#137c69] bg-[#e9f5f0] px-2 py-0.5 rounded-md">
                            {mat.topic}
                          </span>
                          <h3 className="font-bold text-base text-[#172b35] mt-1.5">{mat.title}</h3>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => toggleMaterialActiveForPhone(mat.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                              isActive
                                ? 'bg-[#137c69] text-white'
                                : 'bg-white border border-[#e3e8eb] text-[#718087] hover:border-[#137c69] hover:text-[#137c69]'
                            }`}
                          >
                            <PhoneCall className="w-3 h-3" />
                            <span>{isActive ? 'פעיל בקו' : 'סנכרן לקו'}</span>
                          </button>
                          <button
                            onClick={() => deleteStudyMaterial(mat.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition"
                            title="מחק חומר"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-[#718087] line-clamp-2 mb-4 leading-relaxed">
                        {mat.raw_text}
                      </p>

                      {/* Vocabulary Chips */}
                      <div className="border-t border-[#f0f3f4] pt-3">
                        <span className="text-[11px] font-bold text-[#718087] block mb-2">
                          אוצר מילים שנסרק ({mat.vocabulary.length} מונחים):
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {mat.vocabulary.slice(0, 5).map((v, i) => (
                            <span
                              key={i}
                              className="text-xs bg-white border border-[#e3e8eb] px-2.5 py-1 rounded-md text-[#172b35]"
                            >
                              <strong dir="ltr">{v.english}</strong> – {v.hebrew}
                            </span>
                          ))}
                          {mat.vocabulary.length > 5 && (
                            <span className="text-xs text-[#718087] py-1 px-1">
                              +{mat.vocabulary.length - 5} נוספים
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Dedicated Interactive Games Arena */}
      {activeTab === 'games' && (
        <div className="space-y-6">
          {/* Game Selector Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { id: 'word_match', title: '1. התאמת מילים', sub: 'Word Match' },
              { id: 'sentence_builder', title: '2. בניית משפטים', sub: 'Sentence Builder' },
              { id: 'listening_quiz', title: '3. אתגר שמיעה', sub: 'Listening Quiz' },
              { id: 'roleplay_dialog', title: '4. סימולציית שיחה', sub: 'Roleplay Studio' }
            ].map(g => (
              <button
                key={g.id}
                onClick={() => setSelectedGame(g.id as any)}
                className={`p-3.5 rounded-xl border text-right transition ${
                  selectedGame === g.id
                    ? 'bg-[#102d32] border-[#102d32] text-white shadow-sm'
                    : 'bg-white border-[#e3e8eb] text-[#172b35] hover:bg-[#f5f6f8]'
                }`}
              >
                <span className="text-xs block font-bold">{g.title}</span>
                <span className={`text-[11px] block mt-0.5 ${selectedGame === g.id ? 'text-[#dceab7]' : 'text-[#718087]'}`}>
                  {g.sub}
                </span>
              </button>
            ))}
          </div>

          {/* Active Game Stage */}
          {selectedGame === 'word_match' && <WordMatchGame />}
          {selectedGame === 'sentence_builder' && <SentenceBuilderGame />}
          {selectedGame === 'listening_quiz' && <ListeningQuizGame />}
          {selectedGame === 'roleplay_dialog' && <RoleplayDialogGame />}

          {/* Game Score History */}
          <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-base text-[#172b35] mb-4">היסטוריית הישגים במשחקונים</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-[#e3e8eb] text-[#718087]">
                    <th className="py-2.5 px-3">משחקון</th>
                    <th className="py-2.5 px-3">תוצאה</th>
                    <th className="py-2.5 px-3">דיוק</th>
                    <th className="py-2.5 px-3">נקודות שנצברו</th>
                    <th className="py-2.5 px-3">מועד</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f3f4]">
                  {gameScores.filter(g => g.customer_id === currentCustomer.id).map(score => (
                    <tr key={score.id} className="hover:bg-[#fafbfc]">
                      <td className="py-3 px-3 font-semibold text-[#172b35]">{score.game_title}</td>
                      <td className="py-3 px-3 tabular-nums">{score.score} / {score.total_questions}</td>
                      <td className="py-3 px-3 tabular-nums text-[#137c69] font-bold">{score.accuracy_pct}%</td>
                      <td className="py-3 px-3 tabular-nums font-bold text-[#6d5ce7]">+{score.points_earned}</td>
                      <td className="py-3 px-3 text-[#718087]">{new Date(score.completed_at).toLocaleString('he-IL')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Detailed Call Traces & Audio History */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-sm">
            <h2 className="text-xl font-bold text-[#172b35] mb-2">יומן שיחות מעמיק ותמלילים</h2>
            <p className="text-xs text-[#718087] mb-6">
              כל שיחה שקיימתם (בטלפון או באתר) מנותחת כאן לעומק עם ציוני דקדוק, אוצר מילים, שטף דיבור, ותיקונים פדגוגיים עדינים.
            </p>

            <div className="space-y-4">
              {detailedCalls.filter(c => c.customer_id === currentCustomer.id).map(call => {
                const isExpanded = expandedCallId === call.call_id;
                return (
                  <div
                    key={call.call_id}
                    className="border border-[#e3e8eb] rounded-xl overflow-hidden bg-white shadow-xs transition"
                  >
                    {/* Header bar */}
                    <div
                      onClick={() => setExpandedCallId(isExpanded ? null : call.call_id)}
                      className="p-4 bg-[#fafbfc] hover:bg-[#f5f6f8] cursor-pointer flex flex-wrap items-center justify-between gap-4 select-none"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#137c69] text-white flex items-center justify-center font-bold">
                          <PhoneCall className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-[#172b35]">{call.topic || 'שיעור באנגלית'}</span>
                            <span className="text-[11px] text-[#718087]">• {call.bot_name}</span>
                          </div>
                          <span className="text-xs text-[#718087]">
                            {new Date(call.created_at).toLocaleString('he-IL')} • {Math.round(call.duration_seconds / 60)} דקות
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        {/* Scores */}
                        <div className="hidden sm:flex items-center gap-3 text-xs">
                          <span className="bg-[#e9f5f0] text-[#137c69] px-2.5 py-1 rounded-md font-bold tabular-nums">
                            דקדוק: {call.grammar_score}%
                          </span>
                          <span className="bg-[#eff4f3] text-[#102d32] px-2.5 py-1 rounded-md font-bold tabular-nums">
                            אוצר מילים: {call.vocabulary_score}%
                          </span>
                          <span className="bg-[#f7f5ff] text-[#6d5ce7] px-2.5 py-1 rounded-md font-bold tabular-nums">
                            שטף: {call.fluency_score}%
                          </span>
                        </div>

                        {isExpanded ? <ChevronUp className="w-4 h-4 text-[#718087]" /> : <ChevronDown className="w-4 h-4 text-[#718087]" />}
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="p-5 border-t border-[#e3e8eb] space-y-5">
                        {/* Summary & Pedagogical Feedback */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#f8fafc] p-4 rounded-xl border border-[#e2e8f0] text-xs">
                          <div>
                            <span className="font-bold text-[#172b35] block mb-1">סיכום השיחה הפדגוגי:</span>
                            <p className="text-slate-700 leading-relaxed">{call.summary_he}</p>
                          </div>
                          <div>
                            <span className="font-bold text-[#137c69] block mb-1">הצלחות ושלב הבא:</span>
                            <p className="text-slate-700 leading-relaxed">
                              <strong>הצלחה:</strong> {call.success_he}
                              <br />
                              <strong>בשיעור הבא:</strong> {call.next_step_he}
                            </p>
                          </div>
                        </div>

                        {/* Turn-by-Turn Bubbles */}
                        <div>
                          <span className="text-xs font-bold text-[#718087] block mb-3">
                            תמליל שלב-אחר-שלב (לחצו על האודיו להאזנה):
                          </span>
                          <div className="space-y-3">
                            {call.turns.map(turn => {
                              const isTutor = turn.speaker === 'tutor';
                              return (
                                <div
                                  key={turn.id}
                                  className={`p-3.5 rounded-xl border text-xs max-w-[85%] ${
                                    isTutor
                                      ? 'bg-[#e9f5f0] border-[#b8dfd1] text-[#102d32] mr-auto'
                                      : 'bg-white border-[#e3e8eb] text-[#172b35] ml-auto'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3 mb-1">
                                    <span className="font-bold text-[11px] opacity-75">
                                      {isTutor ? call.bot_name : currentCustomer.name}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-[#718087] tabular-nums">{turn.timestamp}</span>
                                      {isTutor && (
                                        <button
                                          onClick={() => playSpeech(turn.text, 'en-US')}
                                          className="p-1 hover:bg-black/5 rounded-md transition"
                                          title="השמעת משפט זה"
                                        >
                                          <Volume2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  <p className="text-sm font-medium mb-1" dir={/[a-zA-Z]/.test(turn.text) ? 'ltr' : 'rtl'}>
                                    {turn.text}
                                  </p>

                                  {turn.translation_he && (
                                    <p className="text-[11px] text-[#718087] border-t border-current/10 pt-1 mt-1">
                                      {turn.translation_he}
                                    </p>
                                  )}

                                  {/* Corrections Callout */}
                                  {turn.corrections && turn.corrections.length > 0 && (
                                    <div className="mt-2 p-2 bg-[#fff4df] border border-[#f5dfb8] rounded-lg text-[11px] text-[#93661e]">
                                      <span className="font-bold block mb-0.5">טיפ דקדוקי עדין:</span>
                                      {turn.corrections.map((corr, i) => (
                                        <div key={i}>
                                          <span>במקום <code className="bg-white/80 px-1 py-0.5 rounded">{corr.original}</code> מומלץ לומר <strong className="text-[#137c69]">{corr.correction}</strong>: {corr.explanation_he}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Live Web Practice Room */}
      {activeTab === 'practice' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controls Panel */}
          <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-sm h-fit">
            <h3 className="font-bold text-base text-[#172b35] mb-4">הגדרות האימון הישיר</h3>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-bold block text-[#718087] mb-1.5">בחירת מורה וירטואלי:</label>
                <select
                  value={selectedTeacherId}
                  onChange={e => setSelectedTeacherId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb] bg-[#fafbfc] text-[#172b35] font-semibold"
                >
                  {bots.filter(b => b.enabled).map(b => (
                    <option key={b.id} value={b.id}>{b.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold block text-[#718087] mb-1.5">סוג השיחה:</label>
                <select
                  value={practiceMode}
                  onChange={e => setPracticeMode(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb] bg-[#fafbfc] text-[#172b35]"
                >
                  <option value="free">שיחה חופשית והתאמה אישית</option>
                  <option value="course">קורס מובנה לפי שיעורים</option>
                  <option value="translation">תרגומון קולי מיידי</option>
                </select>
              </div>

              {practiceMode === 'translation' && (
                <div>
                  <label className="font-bold block text-[#718087] mb-1.5">שפת יעד לתרגום:</label>
                  <select
                    value={targetTranslationLang}
                    onChange={e => setTargetTranslationLang(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] bg-[#fafbfc] text-[#172b35]"
                  >
                    <option value="English">אנגלית (English)</option>
                    <option value="Hebrew">עברית</option>
                    <option value="Yiddish">יידיש</option>
                    <option value="French">צרפתית</option>
                    <option value="Arabic">ערבית</option>
                  </select>
                </div>
              )}

              {activePhoneMaterial && (
                <div className="p-3 bg-[#e9f5f0] border border-[#b8dfd1] rounded-xl text-[11px] text-[#137c69]">
                  <strong>חומר פעיל מוזרק לשיחה:</strong> {activePhoneMaterial.title}
                </div>
              )}
            </div>
          </div>

          {/* Interactive Turn Dialog Area */}
          <div className="lg:col-span-2 bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-sm flex flex-col min-h-[500px]">
            <div className="border-b border-[#e3e8eb] pb-3 mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-[#172b35]">חדר תרגול חי עם שוכי ומורי בית הספר</h3>
                <span className="text-xs text-[#718087]">כתבו משפט או שאלה באנגלית או עברית. המורה יענה בקול ובטקסט.</span>
              </div>
            </div>

            {/* Conversation Flow */}
            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
              <div className="p-3.5 bg-[#f5f6f8] rounded-xl text-xs text-[#172b35] max-w-[85%] mr-auto border border-[#e3e8eb]">
                <span className="font-bold text-[11px] text-[#137c69] block mb-1">שוכי (המורה הרובוט):</span>
                היי {currentCustomer.name}! אני שוכי. אני לא נלחץ ולא שופט טעויות, מוזמן לכתוב לי כל משפט שתרצה ונתרגל יחד!
              </div>

              {detailedCalls.filter(c => c.customer_id === currentCustomer.id).slice(0, 1).map(call => (
                <div key={call.call_id} className="space-y-3">
                  {call.turns.map(t => (
                    <div
                      key={t.id}
                      className={`p-3.5 rounded-xl text-xs max-w-[85%] ${
                        t.speaker === 'tutor'
                          ? 'bg-[#e9f5f0] border border-[#b8dfd1] text-[#102d32] mr-auto'
                          : 'bg-[#fafbfc] border border-[#e3e8eb] text-[#172b35] ml-auto'
                      }`}
                    >
                      <p className="font-semibold text-sm mb-1">{t.text}</p>
                      {t.translation_he && <p className="text-[11px] text-[#718087]">{t.translation_he}</p>}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Turn Form */}
            <form onSubmit={handleSendChat} className="flex gap-2 pt-2 border-t border-[#f0f3f4]">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="כתבו משפט באנגלית או בעברית..."
                className="flex-1 p-3 rounded-xl border border-[#e3e8eb] text-sm focus:outline-none focus:border-[#137c69]"
                dir="auto"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || isSending}
                className="bg-[#137c69] hover:bg-[#0f6656] disabled:opacity-50 text-white px-5 py-3 rounded-xl font-bold text-sm shadow-sm transition flex items-center gap-1.5 shrink-0"
              >
                <span>{isSending ? 'מעבד...' : 'שליחה למורה'}</span>
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Upload Material Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#e3e8eb] shadow-xl max-w-xl w-full p-6 text-right" dir="rtl">
            <div className="flex items-center justify-between border-b border-[#e3e8eb] pb-3 mb-4">
              <h3 className="font-bold text-lg text-[#172b35]">העלאת חומר לימוד וסריקה למאגר</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-[#718087] hover:text-[#172b35] text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveMaterial} className="space-y-4">
              {/* File upload scanner trigger */}
              <div className="border-2 border-dashed border-[#cbd5e1] rounded-xl p-4 text-center hover:bg-[#fafbfc] transition">
                <input
                  type="file"
                  id="fileUpload"
                  onChange={handleFileUpload}
                  className="hidden"
                  accept=".txt,.pdf,.docx,.doc"
                />
                <label htmlFor="fileUpload" className="cursor-pointer block">
                  <Upload className="w-8 h-8 text-[#137c69] mx-auto mb-1.5" />
                  <span className="text-xs font-bold text-[#172b35] block">
                    {isScanningFile ? 'סורק קובץ לחומר לימוד...' : 'לחצו להעלאת קובץ מסמך או ספר (PDF/Word/Text)'}
                  </span>
                  <span className="text-[11px] text-[#718087]">
                    המערכת תסרוק את הטקסט ותוציא מתוכו מילים ומשפטי תרגול
                  </span>
                </label>
              </div>

              <div>
                <label className="text-xs font-bold text-[#718087] block mb-1">כותרת החומר:</label>
                <input
                  type="text"
                  required
                  value={uploadTitle}
                  onChange={e => setUploadTitle(e.target.value)}
                  placeholder="למשל: שיחת משא ומתן עם לקוח אמריקאי"
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm focus:outline-none focus:border-[#137c69]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#718087] block mb-1">נושא:</label>
                  <input
                    type="text"
                    value={uploadTopic}
                    onChange={e => setUploadTopic(e.target.value)}
                    placeholder="עסקים, נדל״ן, תיירות וכו׳"
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm focus:outline-none focus:border-[#137c69]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#718087] block mb-1">רמת קושי:</label>
                  <select
                    value={uploadLevel}
                    onChange={e => setUploadLevel(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm focus:outline-none focus:border-[#137c69]"
                  >
                    <option value="beginner">מתחילים (Beginner)</option>
                    <option value="intermediate">בינוני (Intermediate)</option>
                    <option value="advanced">מתקדמים ועסקים (Advanced)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-[#718087] block mb-1">
                  טקסט חופשי או רשימת מילים (אנגלית - עברית):
                </label>
                <textarea
                  required
                  rows={6}
                  value={uploadText}
                  onChange={e => setUploadText(e.target.value)}
                  placeholder="הדביקו פה טקסט באנגלית, או זוגות מילים:&#10;Negotiation - משא ומתן&#10;Agreement - הסכם"
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs focus:outline-none focus:border-[#137c69] font-mono leading-relaxed"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#718087] hover:bg-[#f5f6f8]"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="bg-[#137c69] hover:bg-[#0f6656] text-white px-5 py-2 rounded-xl text-xs font-bold shadow-sm transition"
                >
                  שמור וסנכרן לשיחה הטלפונית
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
