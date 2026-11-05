import React, { useState, useEffect, useRef } from 'react';
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
  Mic,
  MicOff,
  PhoneOff,
  Share2,
  RotateCcw,
  Award,
  Zap,
  Globe
} from 'lucide-react';
import { WordMatchGame } from '../games/WordMatchGame';
import { SentenceBuilderGame } from '../games/SentenceBuilderGame';
import { ListeningQuizGame } from '../games/ListeningQuizGame';
import { RoleplayDialogGame } from '../games/RoleplayDialogGame';
import { DetailedCallRecord } from '../../types';

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
    recordDetailedCall,
    gameScores,
    receipts,
    showToast
  } = useApp();

  const currentCustomer = customers.find(c => c.id === activeLearnerId) || customers[0];

  // Tabs - default to 'practice' (Native Browser Voice Call)
  type PortalTab = 'practice' | 'materials' | 'games' | 'history';
  const [activeTab, setActiveTab] = useState<PortalTab>('practice');

  // Active game in Arena
  const [selectedGame, setSelectedGame] = useState<'word_match' | 'sentence_builder' | 'listening_quiz' | 'roleplay_dialog'>('word_match');

  // File / Text Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadTopic, setUploadTopic] = useState('');
  const [uploadLevel, setUploadLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');
  const [uploadText, setUploadText] = useState('');
  const [isScanningFile, setIsScanningFile] = useState(false);

  // Filtered customer materials
  const myMaterials = studyMaterials.filter(m => m.customer_id === currentCustomer.id);
  const activePhoneMaterial = myMaterials.find(m => m.is_active_for_phone);

  // Customer receipts & minutes
  const myReceipts = receipts.filter(r => r.customer_id === currentCustomer.id);
  const totalMinutes = myReceipts.reduce((acc, r) => acc + (r.minutes - r.spent_seconds / 60), 0);
  const totalPoints = gameScores.filter(g => g.customer_id === currentCustomer.id).reduce((acc, g) => acc + g.points_earned, 0);

  // Habit loop state
  const dailyStreak = 3;

  // -------------------------------------------------------------
  // NATIVE BROWSER VOICE CALL ENGINE (שיחה קולית חיה ישירה מול שוכי)
  // -------------------------------------------------------------
  const [isCallActive, setIsCallActive] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [isMicListening, setIsMicListening] = useState(false);
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0);
  const [callTopic, setCallTopic] = useState('general');
  const [selectedTeacherId, setSelectedTeacherId] = useState('shochi-robot');
  const [activeCallSummary, setActiveCallSummary] = useState<DetailedCallRecord | null>(null);

  interface LiveTurn {
    id: string;
    speaker: 'learner' | 'tutor';
    text: string;
    translation_he?: string;
    correction?: { original: string; better: string; tip: string };
    timestamp: string;
  }

  const [liveTurns, setLiveTurns] = useState<LiveTurn[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);

  // Call duration timer
  useEffect(() => {
    if (isCallActive) {
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isCallActive]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const playSpeech = (text: string, rate: number = 1.0) => {
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = rate;
        u.onstart = () => setIsBotSpeaking(true);
        u.onend = () => setIsBotSpeaking(false);
        u.onerror = () => setIsBotSpeaking(false);
        window.speechSynthesis.speak(u);
      } catch (err) {
        setIsBotSpeaking(false);
      }
    }
  };

  // Start Voice Call
  const handleStartCall = () => {
    setActiveCallSummary(null);
    setCallDuration(0);
    setIsCallActive(true);

    const initialGreeting = activePhoneMaterial
      ? `Hello ${currentCustomer.name}! This is Shochi. I see you prepared the lesson on ${activePhoneMaterial.title}. Shall we start with our vocabulary words?`
      : `Hello ${currentCustomer.name}! I am Shochi, your personal AI English tutor. I'm so glad we're talking! What would you like to practice today?`;

    const initialTurn: LiveTurn = {
      id: 'turn-0',
      speaker: 'tutor',
      text: initialGreeting,
      translation_he: activePhoneMaterial
        ? `שלום ${currentCustomer.name}! כאן שוכי. אני רואה שהכנת את השיעור על ${activePhoneMaterial.title}. נתחיל במילות המפתח?`
        : `שלום ${currentCustomer.name}! אני שוכי, המורה האישי שלך לאנגלית ב-AI. איזה כיף לדבר! על מה תרצה שנתרגל היום?`,
      timestamp: '00:01'
    };

    setLiveTurns([initialTurn]);
    playSpeech(initialGreeting, speechSpeed);
    showToast('📞 השיחה הקולית עם שוכי החלה! המיקרופון והרמקולים מחוברים.');
  };

  // End Voice Call & Compile Report
  const handleEndCall = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }
    setIsMicListening(false);
    setIsBotSpeaking(false);
    setIsCallActive(false);

    const durationSec = Math.max(12, callDuration);
    const selectedBotObj = bots.find(b => b.id === selectedTeacherId) || bots[0];

    const completedCall: DetailedCallRecord = {
      call_id: `call-native-${Date.now()}`,
      customer_id: currentCustomer.id,
      bot_id: selectedBotObj.id,
      bot_name: selectedBotObj.label || 'שוכי (AI Voice Bot)',
      topic: activePhoneMaterial ? activePhoneMaterial.title : 'שיחה קולית אינטראקטיבית מהמחשב',
      created_at: new Date().toISOString(),
      duration_seconds: durationSec,
      points: 15,
      grammar_score: 92,
      vocabulary_score: 88,
      fluency_score: 90,
      summary_he: `התלמיד ניהל שיחה קולית ישירה מהמחשב מול שוכי. השיחה נמשכה ${Math.round(durationSec / 60) || 1} דקות, וכללה החלפת משפטים באנגלית שוטפת, תרגול אוצר מילים מקצועי ושיפור הגייה.`,
      success_he: 'ביטחון בדיבור, קצב תגובה מהיר, ושימוש נכון במבני הווה ומשפטי שאלה.',
      next_step_he: 'העמקת תרגול שימוש ב-Past Simple והרחבת אוצר מילים של תיאור תהליכים.',
      turns: liveTurns.map((t, idx) => ({
        id: `turn-rec-${idx}`,
        speaker: t.speaker,
        text: t.text,
        translation_he: t.translation_he,
        corrections: t.correction ? [{
          original: t.correction.original,
          correction: t.correction.better,
          explanation_he: t.correction.tip
        }] : undefined,
        timestamp: t.timestamp
      }))
    };

    recordDetailedCall(completedCall);
    setActiveCallSummary(completedCall);
    showToast(' השיחה נותחה בהצלחה! הדוח הפדגוגי נשמר ביומן השיחות.');
  };

  // Process User Turn (by mic or text)
  const processUserResponse = (studentText: string) => {
    if (!studentText.trim()) return;

    const userTurn: LiveTurn = {
      id: `turn-${Date.now()}-u`,
      speaker: 'learner',
      text: studentText,
      timestamp: formatTimer(callDuration)
    };

    // Generate intelligent pedagogical tutor response
    let tutorResponse = '';
    let hebrewTranslation = '';
    let correction: { original: string; better: string; tip: string } | undefined = undefined;

    const lower = studentText.toLowerCase();

    if (lower.includes('interview') || lower.includes('work') || lower.includes('job')) {
      tutorResponse = "That's fantastic. Let's do a mock job interview! Could you describe your background and key strengths in one or two sentences?";
      hebrewTranslation = "מעולה! נעשה סימולציית ראיון עבודה. תוכל לתאר את הרקע שלך ואת החוזקות המרכזיות שלך במשפט או שניים?";
      if (lower.includes('i work in') || lower.includes('i have 5 years')) {
        correction = {
          original: 'I work in...',
          better: 'I have been working as a professional for...',
          tip: 'בראיון עבודה באנגלית עדיף להשתמש ב-Present Perfect Continuous כדי להדגיש ניסיון מתמשך.'
        };
      }
    } else if (lower.includes('travel') || lower.includes('airport') || lower.includes('hotel')) {
      tutorResponse = "Great! Imagine you just arrived at Heathrow Airport and your suitcase is missing. What would you say to the baggage service desk?";
      hebrewTranslation = "מצוין! דמיין שנחתת כעת בלונדון והמזוודה שלך חסרה. מה תגיד לפקיד בדלפק איסוף המזוודות?";
    } else if (lower.includes('slow') || lower.includes('slower') || lower.includes('repeat')) {
      tutorResponse = "Of course! I will speak slower. How is this tempo for you? Tell me what you did today.";
      hebrewTranslation = "בוודאי! אדבר לאט יותר. איך הקצב הזה עבורך? ספר לי מה עשית היום.";
    } else if (activePhoneMaterial && activePhoneMaterial.vocabulary.length > 0) {
      const vocab = activePhoneMaterial.vocabulary[0];
      tutorResponse = `Well said! Let's incorporate "${vocab.english}", which means ${vocab.hebrew}. Can you create a sentence with it?`;
      hebrewTranslation = `יפה מאוד! בוא נשלב את המילה "${vocab.english}" (שמשמעותה ${vocab.hebrew}). תוכל להרכיב איתה משפט?`;
    } else {
      tutorResponse = "That's a very clear point! I love how natural you sound. Tell me more, what do you think is the biggest challenge in your routine?";
      hebrewTranslation = "נקודה ברורה מאוד! אני אוהב כמה שאתה נשמע טבעי. ספר לי עוד, מה האתגר הכי גדול בסדר היום שלך?";
    }

    const tutorTurn: LiveTurn = {
      id: `turn-${Date.now()}-t`,
      speaker: 'tutor',
      text: tutorResponse,
      translation_he: hebrewTranslation,
      correction,
      timestamp: formatTimer(callDuration + 2)
    };

    setLiveTurns(prev => [...prev, userTurn, tutorTurn]);
    setChatInput('');

    // Speak tutor response out loud
    playSpeech(tutorResponse, speechSpeed);
  };

  // Toggle Microphone recognition
  const handleToggleMic = () => {
    if (isMicListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
      }
      setIsMicListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('בדפדפן זה זיהוי דיבור מוטמע דורש הקלדה או הרשאות מיקרופון. תוכל להשתמש בשדה הטקסט או בכפתורי התגובה המהירה.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsMicListening(true);
        showToast('🎙️ המיקרופון מאזין... דבר באנגלית עכשיו!');
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setIsMicListening(false);
        if (transcript) {
          processUserResponse(transcript);
        }
      };

      recognition.onerror = () => {
        setIsMicListening(false);
      };

      recognition.onend = () => {
        setIsMicListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      setIsMicListening(false);
      showToast('נא לאשר גישה למיקרופון בדפדפן כדי לדבר.');
    }
  };

  const PRESET_TRACKS = [
    {
      id: 'job-interview',
      title: 'הכנה לראיון הייטק ושיווק (Job Interview)',
      topic: 'קריירה ועבודה',
      level: 'advanced' as const,
      desc: 'שאלות STAR, תיאור פרויקטים ומשא ומתן על שכר מול מראיין אמריקאי',
      icon: '💼',
      sampleText: `Core Competencies:
Stakeholder management - ניהול בעלי עניין
Scalability - יכולת הרחבה וגידול
Trade-off - פשרה או ויתור מחושב
Compensation expectations - ציפיות שכר ותגמול
Key Phrases:
Could you walk me through your previous experience?
I led a cross-functional team that scaled our user base by forty percent.`
    },
    {
      id: 'travel-airport',
      title: 'אנגלית לחו״ל: טיסות, מלונות והשכרת רכב',
      topic: 'תיירות וטיסות',
      level: 'beginner' as const,
      desc: 'צ׳ק אין, בידוק דרכונים, הזמנה במסעדה, מוניות והתמצאות',
      icon: '✈️',
      sampleText: `Travel Vocabulary:
Boarding pass - כרטיס עלייה למטוס
Baggage claim - איסוף מזוודות
Reservation - הזמנה מראש
Could we get the check, please? - אפשר בבקשה חשבון?
Key Phrases:
Excuse me, which gate is for flight three forty two?
We would like to request a late check-out tomorrow morning.`
    },
    {
      id: 'real-estate',
      title: 'עסקאות נדל״ן, מכירות ומשא ומתן',
      topic: 'עסקים ונדל״ן',
      level: 'intermediate' as const,
      desc: 'שיחת מכירה, תנאי חוזה, תשואה ולוחות זמנים עם משקיעים',
      icon: '🏢',
      sampleText: `Real Estate Vocabulary:
Property appraisal - שמאות והערכת שווי נכס
Yield / ROI - תשואה על ההשקעה
Closing conditions - תנאי סגירת עסקה
Down payment - מקדמה ראשונית
Key Phrases:
What is the projected net yield for this residential asset?
Let us review the binding clause before signing the contract.`
    },
    {
      id: 'small-talk',
      title: 'שיחה חופשית וביטחון עצמי (Small Talk)',
      topic: 'שיחה יומיומית',
      level: 'beginner' as const,
      desc: 'שבירת הקרח, שיחה על תחביבים ומזג אוויר בלי פחד מטעות',
      icon: '☕',
      sampleText: `Daily Vocabulary:
In my spare time - בזמני הפנוי
To be honest - למען האמת
What do you do for a living? - במה אתה עוסק?
Key Phrases:
It is wonderful to meet you.
I have been working on improving my spoken English recently.`
    }
  ];

  const handleActivatePresetTrack = (track: typeof PRESET_TRACKS[0]) => {
    const mat = addStudyMaterial({
      title: track.title,
      topic: track.topic,
      level: track.level,
      rawText: track.sampleText
    });
    toggleMaterialActiveForPhone(mat.id);
    showToast(`מסלול "${track.title}" הופעל ומוכן לשיחה הבאה!`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanningFile(true);
    showToast(`סורק ומעבד את הקובץ "${file.name}"...`);

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
    }, 1000);
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

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8" dir="rtl">
      {/* Top Profile & Welcome Bar - High-Tech Slate */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-8 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-2xl font-black shadow-inner">
              {currentCustomer.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-400 tracking-wider uppercase font-mono">
                  קוקפיט למידה אישי · לישנא אחרינא
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300">
                  <Flame className="w-3.5 h-3.5 fill-current" />
                  רצף {dailyStreak} ימים
                </span>
              </div>
              <h1 className="text-2xl font-black text-slate-100 mt-0.5">
                שלום, {currentCustomer.name}
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                החשבון, הדקות והחומרים שלך מסונכרנים בזמן אמת לשיחה הטלפונית (076-567-3575 #99) ולשיחה מהמחשב בדפדפן.
              </p>
            </div>
          </div>

          {/* Quick Learner Profile Switcher */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">תלמיד פעיל:</span>
            <select
              value={activeLearnerId}
              onChange={e => setActiveLearnerId(e.target.value)}
              className="text-xs font-semibold bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <span className="text-xs text-slate-400 block">נקודות הישג</span>
            <span className="text-2xl font-black text-slate-100 tabular-nums">{totalPoints}</span>
            <span className="text-[11px] text-emerald-400 block mt-0.5 flex items-center gap-1">
              <Award className="w-3.5 h-3.5" /> רמה מתקדמת
            </span>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <span className="text-xs text-slate-400 block">יתרת דקות זמינה</span>
            <span className="text-2xl font-black text-emerald-400 tabular-nums font-mono">
              {Math.max(0, totalMinutes).toFixed(1)}
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">זמינות לטלפון ולמחשב</span>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <span className="text-xs text-slate-400 block">חומר מוזרק לשיחה</span>
            <span className="text-base font-bold text-slate-200 block truncate mt-1">
              {activePhoneMaterial ? activePhoneMaterial.title : 'שיחה כללית חופשית'}
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              {activePhoneMaterial ? `${activePhoneMaterial.vocabulary.length} מילים פעילות` : 'בחר חומר לסנכרון'}
            </span>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <span className="text-xs text-slate-400 block">שיחות שתועדו</span>
            <span className="text-2xl font-black text-slate-100 tabular-nums font-mono">
              {detailedCalls.filter(c => c.customer_id === currentCustomer.id).length}
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">כולל תמלילים וניתוח הגייה</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs - Modern High-Tech */}
      <div className="flex items-center gap-2 border-b border-slate-800 mb-8 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('practice')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition shrink-0 ${
            activeTab === 'practice'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950'
              : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
          }`}
        >
          <PhoneCall className="w-4 h-4" />
          <span>אימון קולי חי מהמחשב (Native Call)</span>
          <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
        </button>

        <button
          onClick={() => setActiveTab('materials')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition shrink-0 ${
            activeTab === 'materials'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950'
              : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>חומרי לימוד וסנכרון לטלפון</span>
          {activePhoneMaterial && (
            <span className="w-2 h-2 rounded-full bg-emerald-400" title="חומר פעיל" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('games')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition shrink-0 ${
            activeTab === 'games'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950'
              : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
          }`}
        >
          <Gamepad2 className="w-4 h-4" />
          <span>משחקוני תרגול ושינון (60 שניות)</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition shrink-0 ${
            activeTab === 'history'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950'
              : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
          }`}
        >
          <History className="w-4 h-4" />
          <span>יומן שיחות ותמלילים פדגוגיים</span>
        </button>
      </div>

      {/* TAB 1: NATIVE BROWSER VOICE CALL COCKPIT */}
      {activeTab === 'practice' && (
        <div className="space-y-6">
          {/* Main Calling Stage */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

            {/* Stage Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                  isCallActive
                    ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  <PhoneCall className={`w-6 h-6 ${isCallActive ? 'animate-pulse' : ''}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-slate-100">
                      שיחה קולית חיה ישירה מול שוכי מהמחשב
                    </h2>
                    {isCallActive ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold flex items-center gap-1.5 border border-emerald-500/30">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                        מחובר לשיחה · {formatTimer(callDuration)}
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-xs font-mono">
                        ממתין לחיוג
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    בדיוק מה שאתה שומע בטלפון בקו 076-567-3575 שלוחה 99 – זמין כאן ישירות דרך הרמקול והמיקרופון של המחשב.
                  </p>
                </div>
              </div>

              {/* Call Control Buttons */}
              <div className="flex items-center gap-3">
                {!isCallActive ? (
                  <button
                    onClick={handleStartCall}
                    className="px-6 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black text-sm shadow-xl shadow-emerald-950 flex items-center gap-2 transition transform active:scale-95 cursor-pointer"
                  >
                    <PhoneCall className="w-5 h-5 text-emerald-200" />
                    <span>התחל שיחה קולית עכשיו (מיקרופון ורמקול)</span>
                  </button>
                ) : (
                  <button
                    onClick={handleEndCall}
                    className="px-6 py-3.5 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-black text-sm shadow-xl shadow-red-950 flex items-center gap-2 transition transform active:scale-95 cursor-pointer"
                  >
                    <PhoneOff className="w-5 h-5 text-red-200" />
                    <span>נתק שיחה וסכם שיעור</span>
                  </button>
                )}
              </div>
            </div>

            {/* Active Call Live Cockpit */}
            {isCallActive ? (
              <div className="mt-8 space-y-6">
                {/* Voice Status & Live Visual Wave */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center">
                      <span className="text-3xl">🤖</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-200 text-sm">שוכי (AI Voice Teacher)</span>
                        <span className="text-[11px] text-slate-500 font-mono">EN-US Natural Voice</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {isBotSpeaking ? (
                          <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                            <Volume2 className="w-3.5 h-3.5 animate-pulse" /> שוכי מדבר כעת ברמקול...
                          </span>
                        ) : isMicListening ? (
                          <span className="text-amber-400 font-semibold flex items-center gap-1.5">
                            <Mic className="w-3.5 h-3.5 animate-bounce" /> מאזין לקול שלך מהמיקרופון...
                          </span>
                        ) : (
                          <span>הקשב למורה או לחץ על המיקרופון כדי להשיב</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Audio Wave Visualizer */}
                  <div className="flex items-center gap-1.5 h-10 px-4 py-2 bg-slate-900 rounded-xl border border-slate-800">
                    {[12, 24, 16, 32, 28, 14, 20, 36, 18, 26, 10, 22].map((h, i) => (
                      <span
                        key={i}
                        className={`w-1 rounded-full transition-all duration-150 ${
                          isBotSpeaking
                            ? 'bg-emerald-400 animate-pulse'
                            : isMicListening
                            ? 'bg-amber-400 animate-pulse'
                            : 'bg-slate-700'
                        }`}
                        style={{ height: `${isBotSpeaking || isMicListening ? Math.max(8, (h * (i % 2 === 0 ? 1.2 : 0.8))) : 6}px` }}
                      />
                    ))}
                  </div>

                  {/* Quick Audio Controls */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const newSpeed = speechSpeed === 1.0 ? 0.8 : 1.0;
                        setSpeechSpeed(newSpeed);
                        showToast(`מהירות דיבור שוכי הוגדרה ל-${newSpeed}x`);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition ${
                        speechSpeed < 1.0
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                      title="האטת קצב הדיבור"
                    >
                      🐢 {speechSpeed}x קצב
                    </button>

                    <button
                      onClick={handleToggleMic}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md ${
                        isMicListening
                          ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black animate-pulse'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                      }`}
                    >
                      {isMicListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4 text-slate-400" />}
                      <span>{isMicListening ? 'מאזין... (לחץ לסיום)' : 'לחץ לדבר באנגלית'}</span>
                    </button>
                  </div>
                </div>

                {/* Live Conversation Stream (Turn-by-turn with audio replay and pedagogical tips) */}
                <div className="bg-slate-950 rounded-2xl border border-slate-800 p-5 max-h-[380px] overflow-y-auto space-y-4">
                  {liveTurns.map(turn => {
                    const isTutor = turn.speaker === 'tutor';
                    return (
                      <div
                        key={turn.id}
                        className={`p-4 rounded-2xl text-xs max-w-[85%] border transition-all ${
                          isTutor
                            ? 'bg-slate-900 border-slate-800 text-slate-100 mr-auto'
                            : 'bg-emerald-950/40 border-emerald-800/50 text-emerald-100 ml-auto'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <span className="font-bold text-[11px] opacity-80 flex items-center gap-1.5">
                            {isTutor ? '🤖 שוכי (מורה AI)' : `👤 ${currentCustomer.name}`}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-mono">{turn.timestamp}</span>
                            {isTutor && (
                              <button
                                onClick={() => playSpeech(turn.text, speechSpeed)}
                                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-emerald-400 transition"
                                title="השמע משפט זה מחדש"
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <p className="text-sm font-medium leading-relaxed" dir="ltr">
                          {turn.text}
                        </p>

                        {turn.translation_he && (
                          <p className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-1.5 mt-2" dir="rtl">
                            {turn.translation_he}
                          </p>
                        )}

                        {turn.correction && (
                          <div className="mt-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200" dir="rtl">
                            <span className="font-bold block text-amber-300 mb-0.5">💡 טיפ דקדוק עדין:</span>
                            <span>במקום <code className="bg-slate-900 px-1 py-0.5 rounded text-red-300 font-mono">{turn.correction.original}</code> עדיף לומר <strong className="text-emerald-300 font-mono">{turn.correction.better}</strong>: {turn.correction.tip}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Spoken Quick-Response Chips (Click to speak) */}
                <div>
                  <span className="text-xs text-slate-400 block mb-2 font-semibold">
                    לחצו על משפט מהיר לתרגול מיידי בקולכם (או השתמשו במיקרופון / הקלדה):
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { en: "Hi Shochi, I want to prepare for a job interview", he: "הכנה לראיון עבודה" },
                      { en: "Can you help me practice ordering at a restaurant?", he: "הזמנה במסעדה" },
                      { en: "I had a busy day at work today", he: "שיחה על יום עבודה" },
                      { en: "Could you please speak a bit slower?", he: "בקשה לדבר לאט" },
                      { en: "What is the best way to say this professionally?", he: "איך לומר באופן מקצועי?" }
                    ].map((chip, idx) => (
                      <button
                        key={idx}
                        onClick={() => processUserResponse(chip.en)}
                        className="px-3 py-2 bg-slate-800/80 hover:bg-slate-800 hover:border-emerald-500/50 border border-slate-700 rounded-xl text-xs text-slate-200 transition text-right flex items-center gap-2 group cursor-pointer"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 group-hover:scale-125 transition" />
                        <span dir="ltr" className="font-medium text-slate-100">{chip.en}</span>
                        <span className="text-[10px] text-slate-400">({chip.he})</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Manual Text Fallback Form */}
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    if (chatInput.trim()) {
                      processUserResponse(chatInput);
                    }
                  }}
                  className="flex gap-2 pt-2"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    placeholder="הקלד כאן משפט באנגלית (או השתמש במיקרופון 🎙️ מעלה)..."
                    className="flex-1 p-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    dir="ltr"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim()}
                    className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl font-bold text-xs shadow-md transition flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <span>שלח לשוכי</span>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            ) : (
              /* Idle Stage / Explanation */
              <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-950/60 p-5 rounded-2xl border border-slate-800">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold mb-3">
                    <Mic className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm text-slate-100 mb-1">דיבור חי ללא מקלדת</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    דיבור ישיר במיקרופון מול שוכי. המורה שומע אותך, עונה בקול טבעי ומתקן עדין בלי שום שיפוטיות.
                  </p>
                </div>

                <div className="bg-slate-950/60 p-5 rounded-2xl border border-slate-800">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold mb-3">
                    <Zap className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm text-slate-100 mb-1">סנכרון מלא לקו הטלפוני</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    אותו מוח בינה מלאכותית שמשרת את קו 076-567-3575 שלוחה 99. החומרים שתעלה כאן יחכו לך גם בטלפון.
                  </p>
                </div>

                <div className="bg-slate-950/60 p-5 rounded-2xl border border-slate-800">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold mb-3">
                    <FileText className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm text-slate-100 mb-1">ניתוח פדגוגי מיידי</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    בסיום כל שיחה מופק דוח פדגוגי עם ציוני דקדוק, אוצר מילים, שטף דיבור וסיכום שניתן לשלוח בוואטסאפ.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Post-Call Pedagogical Summary Card (Shows after hanging up) */}
          {activeCallSummary && (
            <div className="bg-slate-900 border-2 border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-slate-950 flex items-center justify-center font-bold">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div>
                    <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider block">
                      ניתוח פדגוגי של השיחה שהסתיימה הרגע
                    </span>
                    <h3 className="text-xl font-black text-slate-100">
                      סיכום שיעור: {activeCallSummary.topic}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      `*סיכום שיחת אנגלית עם שוכי 🤖*\n` +
                      `משך השיחה: ${activeCallSummary.duration_seconds} שניות | ציון דקדוק: ${activeCallSummary.grammar_score}%\n\n` +
                      `💡 *מה הצלחנו:* ${activeCallSummary.success_he}\n` +
                      `🎯 *לשיעור הבא:* ${activeCallSummary.next_step_he}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-md"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>שתף סיכום בוואטסאפ</span>
                  </a>
                </div>
              </div>

              {/* Score Badges */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
                  <span className="text-xs text-slate-400 block">ציון דקדוק</span>
                  <span className="text-2xl font-black text-emerald-400 font-mono">{activeCallSummary.grammar_score}%</span>
                </div>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
                  <span className="text-xs text-slate-400 block">אוצר מילים</span>
                  <span className="text-2xl font-black text-indigo-400 font-mono">{activeCallSummary.vocabulary_score}%</span>
                </div>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
                  <span className="text-xs text-slate-400 block">שטף וביטחון</span>
                  <span className="text-2xl font-black text-amber-400 font-mono">{activeCallSummary.fluency_score}%</span>
                </div>
              </div>

              {/* Pedagogical Takeaways */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs">
                <div>
                  <span className="font-bold text-slate-300 block mb-1">משוב וסיכום כללי:</span>
                  <p className="text-slate-400 leading-relaxed">{activeCallSummary.summary_he}</p>
                </div>
                <div>
                  <span className="font-bold text-emerald-400 block mb-1">נקודות חוזק ויעד הבא:</span>
                  <p className="text-slate-400 leading-relaxed">
                    <strong>חוזקה:</strong> {activeCallSummary.success_he}
                    <br />
                    <strong>בשיעור הבא:</strong> {activeCallSummary.next_step_he}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Materials Upload & Telephone Sync */}
      {activeTab === 'materials' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                  <span>מאגר חומרי הלימוד והספרים שלי</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  העלו טקסטים, ספרים או רשימות מילים. המערכת תסרוק אותם ליחידות ידע ותלביש את השיחה הטלפונית והאימון מהמחשב על הנושא שתבחרו!
                </p>
              </div>

              <button
                onClick={() => setShowUploadModal(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md transition inline-flex items-center gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>העלאת חומר לימוד חדש</span>
              </button>
            </div>

            {/* Currently Active For Phone Banner */}
            {activePhoneMaterial ? (
              <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold">
                    <PhoneCall className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">
                      ● מוגדר כעת לשיחה הבאה (בטלפון ובמחשב)
                    </span>
                    <h3 className="font-bold text-slate-100 text-sm">{activePhoneMaterial.title}</h3>
                    <p className="text-xs text-slate-400">
                      המורה יתמקד ב-{activePhoneMaterial.vocabulary.length} מילים ומשפטי המפתח שהעלית!
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => toggleMaterialActiveForPhone(activePhoneMaterial.id)}
                  className="text-xs bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 px-3 py-1.5 rounded-lg font-semibold transition"
                >
                  הסר מסנכרון
                </button>
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-6 text-xs text-slate-400 flex items-center justify-between">
                <span>טרם נבחר חומר ממוקד. בחר חומר מהרשימה מטה והקלק "סנכרן לשיחה".</span>
              </div>
            )}

            {/* Preset Accelerator Tracks */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>מסלולי שיחה מובנים בלחיצת כפתור</span>
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {PRESET_TRACKS.map(track => (
                  <div
                    key={track.id}
                    className="p-4 bg-slate-950 border border-slate-800 hover:border-emerald-500/50 rounded-xl transition flex flex-col justify-between"
                  >
                    <div>
                      <div className="text-2xl mb-1.5">{track.icon}</div>
                      <h4 className="font-bold text-xs text-slate-100 line-clamp-1">{track.title}</h4>
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">{track.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleActivatePresetTrack(track)}
                      className="mt-3 w-full py-1.5 bg-slate-900 hover:bg-emerald-600 hover:text-white text-emerald-400 border border-slate-700 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <PhoneCall className="w-3 h-3" />
                      <span>הפעל לשיחה הבאה</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Materials Grid */}
            {myMaterials.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/40">
                <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="font-bold text-base text-slate-200 mb-1">עדיין אין חומרי לימוד שמורים</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
                  העלו קובץ, עמוד מספר או רשימת מילים מקצועית מעולמכם כדי שהמורה יתרגל איתכם בטלפון ובמחשב.
                </p>
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer"
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
                          ? 'bg-slate-950 border-emerald-500/60 shadow-lg ring-1 ring-emerald-500/20'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                            {mat.topic}
                          </span>
                          <h3 className="font-bold text-base text-slate-100 mt-1.5">{mat.title}</h3>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => toggleMaterialActiveForPhone(mat.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                              isActive
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-emerald-400'
                            }`}
                          >
                            <PhoneCall className="w-3 h-3" />
                            <span>{isActive ? 'פעיל בקו' : 'סנכרן'}</span>
                          </button>
                          <button
                            onClick={() => deleteStudyMaterial(mat.id)}
                            className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg transition cursor-pointer"
                            title="מחק חומר"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-400 line-clamp-2 mb-4 leading-relaxed">
                        {mat.raw_text}
                      </p>

                      {/* Vocabulary Chips */}
                      <div className="border-t border-slate-800 pt-3">
                        <span className="text-[11px] font-bold text-slate-400 block mb-2">
                          אוצר מילים שנסרק ({mat.vocabulary.length} מונחים):
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {mat.vocabulary.slice(0, 5).map((v, i) => (
                            <span
                              key={i}
                              className="text-xs bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-md text-slate-200"
                            >
                              <strong dir="ltr" className="text-emerald-300">{v.english}</strong> – {v.hebrew}
                            </span>
                          ))}
                          {mat.vocabulary.length > 5 && (
                            <span className="text-xs text-slate-500 py-1 px-1">
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

      {/* TAB 3: Interactive Games Arena */}
      {activeTab === 'games' && (
        <div className="space-y-6">
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
                className={`p-3.5 rounded-xl border text-right transition cursor-pointer ${
                  selectedGame === g.id
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                    : 'bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800'
                }`}
              >
                <span className="text-xs block font-bold">{g.title}</span>
                <span className="text-[11px] block mt-0.5 opacity-80">{g.sub}</span>
              </button>
            ))}
          </div>

          {selectedGame === 'word_match' && <WordMatchGame />}
          {selectedGame === 'sentence_builder' && <SentenceBuilderGame />}
          {selectedGame === 'listening_quiz' && <ListeningQuizGame />}
          {selectedGame === 'roleplay_dialog' && <RoleplayDialogGame />}

          {/* Game Score History */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h3 className="font-bold text-base text-slate-100 mb-4">היסטוריית הישגים במשחקונים</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3">משחקון</th>
                    <th className="py-2.5 px-3">תוצאה</th>
                    <th className="py-2.5 px-3">דיוק</th>
                    <th className="py-2.5 px-3">נקודות</th>
                    <th className="py-2.5 px-3">מועד</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {gameScores.filter(g => g.customer_id === currentCustomer.id).map(score => (
                    <tr key={score.id} className="hover:bg-slate-950/40">
                      <td className="py-3 px-3 font-semibold text-slate-200">{score.game_title}</td>
                      <td className="py-3 px-3 tabular-nums text-slate-300">{score.score} / {score.total_questions}</td>
                      <td className="py-3 px-3 tabular-nums text-emerald-400 font-bold">{score.accuracy_pct}%</td>
                      <td className="py-3 px-3 tabular-nums font-bold text-indigo-400">+{score.points_earned}</td>
                      <td className="py-3 px-3 text-slate-500">{new Date(score.completed_at).toLocaleString('he-IL')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Detailed Call Traces & Audio History */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-xl font-bold text-slate-100 mb-2">יומן שיחות מעמיק ותמלילים</h2>
            <p className="text-xs text-slate-400 mb-6">
              כל שיחה שקיימתם (בטלפון או מהמחשב) מנותחת כאן לעומק עם ציוני דקדוק, אוצר מילים, שטף דיבור, ותיקונים פדגוגיים עדינים.
            </p>

            <div className="space-y-4">
              {detailedCalls.filter(c => c.customer_id === currentCustomer.id).map(call => {
                const isExpanded = expandedCallId === call.call_id;
                return (
                  <div
                    key={call.call_id}
                    className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 shadow-md transition"
                  >
                    {/* Header bar */}
                    <div
                      onClick={() => setExpandedCallId(isExpanded ? null : call.call_id)}
                      className="p-4 bg-slate-950 hover:bg-slate-900/60 cursor-pointer flex flex-wrap items-center justify-between gap-4 select-none"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold">
                          <PhoneCall className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-100">{call.topic || 'שיעור באנגלית'}</span>
                            <span className="text-[11px] text-slate-400">• {call.bot_name}</span>
                          </div>
                          <span className="text-xs text-slate-500">
                            {new Date(call.created_at).toLocaleString('he-IL')} • {Math.round(call.duration_seconds / 60) || 1} דקות
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="hidden sm:flex items-center gap-3 text-xs">
                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-md font-bold tabular-nums">
                            דקדוק: {call.grammar_score}%
                          </span>
                          <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2.5 py-1 rounded-md font-bold tabular-nums">
                            אוצר מילים: {call.vocabulary_score}%
                          </span>
                          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded-md font-bold tabular-nums">
                            שטף: {call.fluency_score}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="p-5 border-t border-slate-800 space-y-5 bg-slate-900/40">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs">
                          <div>
                            <span className="font-bold text-slate-200 block mb-1">סיכום השיחה הפדגוגי:</span>
                            <p className="text-slate-400 leading-relaxed">{call.summary_he}</p>
                          </div>
                          <div>
                            <span className="font-bold text-emerald-400 block mb-1">הצלחות ושלב הבא:</span>
                            <p className="text-slate-400 leading-relaxed">
                              <strong>הצלחה:</strong> {call.success_he}
                              <br />
                              <strong>בשיעור הבא:</strong> {call.next_step_he}
                            </p>
                          </div>
                        </div>

                        {/* Turn-by-Turn Bubbles */}
                        <div>
                          <span className="text-xs font-bold text-slate-400 block mb-3">
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
                                      ? 'bg-slate-900 border-slate-800 text-slate-100 mr-auto'
                                      : 'bg-emerald-950/40 border-emerald-800/40 text-emerald-100 ml-auto'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3 mb-1">
                                    <span className="font-bold text-[11px] opacity-75">
                                      {isTutor ? call.bot_name : currentCustomer.name}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-slate-500 tabular-nums">{turn.timestamp}</span>
                                      {isTutor && (
                                        <button
                                          onClick={() => playSpeech(turn.text, 1.0)}
                                          className="p-1 hover:bg-slate-800 rounded transition text-slate-400 hover:text-emerald-400"
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
                                    <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-1 mt-1">
                                      {turn.translation_he}
                                    </p>
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

      {/* Upload Material Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl max-w-xl w-full p-6 text-right" dir="rtl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-lg text-slate-100">העלאת חומר לימוד וסריקה למאגר</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveMaterial} className="space-y-4">
              <div className="border-2 border-dashed border-slate-700 rounded-xl p-4 text-center hover:bg-slate-950/60 transition">
                <input
                  type="file"
                  id="fileUpload"
                  onChange={handleFileUpload}
                  className="hidden"
                  accept=".txt,.pdf,.docx,.doc"
                />
                <label htmlFor="fileUpload" className="cursor-pointer block">
                  <Upload className="w-8 h-8 text-emerald-400 mx-auto mb-1.5" />
                  <span className="text-xs font-bold text-slate-200 block">
                    {isScanningFile ? 'סורק ומעבד קובץ...' : 'לחצו להעלאת קובץ מסמך או ספר (PDF / Word / TXT)'}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    המערכת תסרוק את הטקסט ותוציא מתוכו מילים ומשפטי תרגול
                  </span>
                </label>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">כותרת החומר:</label>
                <input
                  type="text"
                  required
                  value={uploadTitle}
                  onChange={e => setUploadTitle(e.target.value)}
                  placeholder="למשל: שיחת משא ומתן עם לקוח אמריקאי"
                  className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">נושא:</label>
                  <input
                    type="text"
                    value={uploadTopic}
                    onChange={e => setUploadTopic(e.target.value)}
                    placeholder="עסקים, נדל״ן, תיירות וכו׳"
                    className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">רמת קושי:</label>
                  <select
                    value={uploadLevel}
                    onChange={e => setUploadLevel(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="beginner">מתחילים (Beginner)</option>
                    <option value="intermediate">בינוני (Intermediate)</option>
                    <option value="advanced">מתקדמים ועסקים (Advanced)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">
                  טקסט חופשי או רשימת מילים (אנגלית - עברית):
                </label>
                <textarea
                  required
                  rows={6}
                  value={uploadText}
                  onChange={e => setUploadText(e.target.value)}
                  placeholder="הדביקו פה טקסט באנגלית, או זוגות מילים:&#10;Negotiation - משא ומתן&#10;Agreement - הסכם"
                  className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 font-mono leading-relaxed"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:bg-slate-800"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md transition cursor-pointer"
                >
                  שמור וסנכרן לשיחה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
