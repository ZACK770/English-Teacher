import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  BotProfile,
  TutorControls,
  Customer,
  Course,
  Enrollment,
  Package,
  Receipt,
  PaymentOrder,
  PaymentIssue,
  Narration,
  AccessPolicy,
  Economics,
  PbxConfig,
  PbxEvent,
  CallTrace,
  DiagnosticEvent,
  ActiveAiSession,
  CallbackRequest,
  StudyMaterial,
  GameScoreRecord,
  DetailedCallRecord,
  GameType,
  PbxRoute
} from '../types';
import {
  INITIAL_BOTS,
  INITIAL_CONTROLS,
  INITIAL_CUSTOMERS,
  INITIAL_COURSES,
  INITIAL_ENROLLMENTS,
  INITIAL_PACKAGES,
  INITIAL_RECEIPTS,
  INITIAL_PAYMENT_ORDERS,
  INITIAL_PAYMENT_ISSUES,
  INITIAL_NARRATIONS,
  INITIAL_ACCESS_POLICIES,
  INITIAL_ECONOMICS,
  INITIAL_PBX_CONFIG,
  INITIAL_PBX_EVENTS,
  INITIAL_DIAGNOSTICS,
  INITIAL_CALL_TRACES,
  INITIAL_CALLBACKS,
  INITIAL_STUDY_MATERIALS,
  INITIAL_DETAILED_CALLS,
  INITIAL_GAME_SCORES
} from './initialData';

interface AppContextType {
  // Data
  bots: BotProfile[];
  controls: Record<string, TutorControls>;
  customers: Customer[];
  courses: Course[];
  enrollments: Enrollment[];
  packages: Package[];
  receipts: Receipt[];
  paymentOrders: PaymentOrder[];
  paymentIssues: PaymentIssue[];
  narrations: Narration[];
  accessPolicies: Record<string, AccessPolicy>;
  economics: Economics;
  pbxConfig: PbxConfig;
  pbxEvents: PbxEvent[];
  callTraces: CallTrace[];
  diagnostics: DiagnosticEvent[];
  activeAiSessions: ActiveAiSession[];
  callbacks: CallbackRequest[];
  studyMaterials: StudyMaterial[];
  detailedCalls: DetailedCallRecord[];
  gameScores: GameScoreRecord[];
  
  // Auth & Session
  adminToken: string;
  setAdminToken: (token: string) => void;
  activeLearnerId: string;
  setActiveLearnerId: (id: string) => void;
  toastMessage: string | null;
  showToast: (msg: string) => void;

  // Bot Actions
  saveBotProfile: (bot: BotProfile) => void;
  saveBotControls: (botId: string, ctrl: TutorControls) => void;
  createBot: (bot: Partial<BotProfile>) => BotProfile;
  duplicateBot: (botId: string, newId: string, newLabel: string) => BotProfile;
  restoreBotVersion: (botId: string, version: number) => void;

  // Customer Actions
  saveCustomer: (cust: Customer) => void;
  createCustomer: (cust: Partial<Customer>) => Customer;
  generateCustomerInvite: (customerId: string) => string;

  // Course & Enrollment Actions
  saveCourse: (course: Course) => void;
  createCourse: (course: Partial<Course>) => Course;
  saveEnrollment: (enrollment: Enrollment) => void;
  createEnrollment: (customerId: string, courseId: string, lessonIndex: number) => Enrollment;

  // Package & Billing Actions
  savePackage: (pkg: Package) => void;
  createPackage: (pkg: Partial<Package>) => Package;
  recordManualReceipt: (customerId: string, packageId: string, reference: string, amountIls: number) => Receipt;
  reconcileNedarimPayments: () => Promise<string>;
  resolvePaymentIssue: (issueId: string, note: string) => void;

  // Narration Actions
  saveNarration: (narration: Narration) => void;
  createNarration: (narration: Partial<Narration>) => Narration;
  generateNarrationAudio: (narrationId: string) => Promise<string>;
  publishNarrationToIvr: (narrationId: string, slot: string) => void;

  // PBX & Systems Actions
  savePbxCopy: (copy: Record<string, string>) => void;
  syncAndVerifyPbx: () => Promise<{ success: boolean; message: string }>;
  stopActiveSession: (callId: string) => void;
  saveEconomics: (eco: Economics) => void;

  // Public Lead Callback
  submitCallbackRequest: (data: Omit<CallbackRequest, 'id' | 'created_at' | 'status'>) => void;

  // Learner Specific Actions
  addStudyMaterial: (mat: { title: string; topic: string; level: 'beginner' | 'intermediate' | 'advanced'; rawText: string }) => StudyMaterial;
  toggleMaterialActiveForPhone: (materialId: string) => void;
  deleteStudyMaterial: (materialId: string) => void;
  recordGameResult: (result: { game_type: GameType; game_title: string; score: number; total_questions: number; points_earned: number; accuracy_pct: number }) => void;
  sendLearnerMessage: (text: string, botId: string, mode: 'course' | 'free' | 'translation', targetLang?: string) => Promise<{ replyText: string; translationHe: string; audioUrl?: string; corrections?: Array<{ original: string; correction: string; explanation_he: string }>; pointsEarned: number }>;

  // Convenience & Telephony Helpers
  currentCustomer: Customer;
  streak: { current_streak: number; calls_today: number; daily_goal: number };
  triggerIntakeCall: (name: string, phone: string, goal: string) => Promise<boolean>;
  callRecords: Array<{
    id: string;
    student_name: string;
    phone_number: string;
    topic: string;
    bot_id: string;
    date: string;
    duration_seconds: number;
    status: string;
    score: string;
    grammar_corrections: Array<{ original: string; corrected: string; explanation: string }>;
    transcript_turns: Array<{ speaker: string; text: string; translation?: string }>;
  }>;
  terminateActiveSession: (callId: string) => void;
  playTtsAudio: (text: string, voice?: string) => void;
  addNarration: (narration: Partial<Narration>) => void;
  updateNarrationStatus: (id: string, status: any) => void;
  pbxRoutes: PbxRoute[];
  updatePbxRoutePrompt: (extension: string, prompt: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Clear any legacy mock data from browser localStorage on launch
  if (typeof window !== 'undefined') {
    const CLEAN_KEY = 'dibura_clean_launch_v1';
    if (!localStorage.getItem(CLEAN_KEY)) {
      [
        'dibura_customers',
        'dibura_receipts',
        'dibura_payment_orders',
        'dibura_payment_issues',
        'dibura_callbacks',
        'dibura_detailed_calls',
        'dibura_game_scores',
        'dibura_call_traces'
      ].forEach(k => localStorage.removeItem(k));
      localStorage.setItem(CLEAN_KEY, 'true');
    }
  }

  // Load state from localStorage or initial defaults
  const [bots, setBots] = useState<BotProfile[]>(() => {
    const saved = localStorage.getItem('dibura_bots');
    return saved ? JSON.parse(saved) : INITIAL_BOTS;
  });

  const [controls, setControls] = useState<Record<string, TutorControls>>(() => {
    const saved = localStorage.getItem('dibura_controls');
    return saved ? JSON.parse(saved) : INITIAL_CONTROLS;
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem('dibura_customers');
    return saved ? JSON.parse(saved) : INITIAL_CUSTOMERS;
  });

  const [courses, setCourses] = useState<Course[]>(() => {
    const saved = localStorage.getItem('dibura_courses');
    return saved ? JSON.parse(saved) : INITIAL_COURSES;
  });

  const [enrollments, setEnrollments] = useState<Enrollment[]>(() => {
    const saved = localStorage.getItem('dibura_enrollments');
    return saved ? JSON.parse(saved) : INITIAL_ENROLLMENTS;
  });

  const [packages, setPackages] = useState<Package[]>(() => {
    const saved = localStorage.getItem('dibura_packages');
    return saved ? JSON.parse(saved) : INITIAL_PACKAGES;
  });

  const [receipts, setReceipts] = useState<Receipt[]>(() => {
    const saved = localStorage.getItem('dibura_receipts');
    return saved ? JSON.parse(saved) : INITIAL_RECEIPTS;
  });

  const [paymentOrders, setPaymentOrders] = useState<PaymentOrder[]>(() => {
    const saved = localStorage.getItem('dibura_payment_orders');
    return saved ? JSON.parse(saved) : INITIAL_PAYMENT_ORDERS;
  });

  const [paymentIssues, setPaymentIssues] = useState<PaymentIssue[]>(() => {
    const saved = localStorage.getItem('dibura_payment_issues');
    return saved ? JSON.parse(saved) : INITIAL_PAYMENT_ISSUES;
  });

  const [narrations, setNarrations] = useState<Narration[]>(() => {
    const saved = localStorage.getItem('dibura_narrations');
    return saved ? JSON.parse(saved) : INITIAL_NARRATIONS;
  });

  const [accessPolicies, setAccessPolicies] = useState<Record<string, AccessPolicy>>(() => {
    const saved = localStorage.getItem('dibura_access_policies');
    return saved ? JSON.parse(saved) : INITIAL_ACCESS_POLICIES;
  });

  const [economics, setEconomics] = useState<Economics>(() => {
    const saved = localStorage.getItem('dibura_economics');
    return saved ? JSON.parse(saved) : INITIAL_ECONOMICS;
  });

  const [pbxConfig, setPbxConfig] = useState<PbxConfig>(() => {
    const saved = localStorage.getItem('dibura_pbx_config');
    return saved ? JSON.parse(saved) : INITIAL_PBX_CONFIG;
  });

  const [pbxEvents, setPbxEvents] = useState<PbxEvent[]>(INITIAL_PBX_EVENTS);
  const [callTraces, setCallTraces] = useState<CallTrace[]>(INITIAL_CALL_TRACES);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEvent[]>(INITIAL_DIAGNOSTICS);
  const [activeAiSessions, setActiveAiSessions] = useState<ActiveAiSession[]>([]);

  const [callbacks, setCallbacks] = useState<CallbackRequest[]>(() => {
    const saved = localStorage.getItem('dibura_callbacks');
    return saved ? JSON.parse(saved) : INITIAL_CALLBACKS;
  });

  const [studyMaterials, setStudyMaterials] = useState<StudyMaterial[]>(() => {
    const saved = localStorage.getItem('dibura_study_materials');
    return saved ? JSON.parse(saved) : INITIAL_STUDY_MATERIALS;
  });

  const [detailedCalls, setDetailedCalls] = useState<DetailedCallRecord[]>(() => {
    const saved = localStorage.getItem('dibura_detailed_calls');
    return saved ? JSON.parse(saved) : INITIAL_DETAILED_CALLS;
  });

  const [gameScores, setGameScores] = useState<GameScoreRecord[]>(() => {
    const saved = localStorage.getItem('dibura_game_scores');
    return saved ? JSON.parse(saved) : INITIAL_GAME_SCORES;
  });

  const [adminToken, setAdminToken] = useState<string>(() => sessionStorage.getItem('adminToken') || 'admin123');
  const [activeLearnerId, setActiveLearnerId] = useState<string>('cust_01');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync to localStorage
  useEffect(() => { localStorage.setItem('dibura_bots', JSON.stringify(bots)); }, [bots]);
  useEffect(() => { localStorage.setItem('dibura_controls', JSON.stringify(controls)); }, [controls]);
  useEffect(() => { localStorage.setItem('dibura_customers', JSON.stringify(customers)); }, [customers]);
  useEffect(() => { localStorage.setItem('dibura_courses', JSON.stringify(courses)); }, [courses]);
  useEffect(() => { localStorage.setItem('dibura_enrollments', JSON.stringify(enrollments)); }, [enrollments]);
  useEffect(() => { localStorage.setItem('dibura_packages', JSON.stringify(packages)); }, [packages]);
  useEffect(() => { localStorage.setItem('dibura_receipts', JSON.stringify(receipts)); }, [receipts]);
  useEffect(() => { localStorage.setItem('dibura_payment_orders', JSON.stringify(paymentOrders)); }, [paymentOrders]);
  useEffect(() => { localStorage.setItem('dibura_payment_issues', JSON.stringify(paymentIssues)); }, [paymentIssues]);
  useEffect(() => { localStorage.setItem('dibura_narrations', JSON.stringify(narrations)); }, [narrations]);
  useEffect(() => { localStorage.setItem('dibura_access_policies', JSON.stringify(accessPolicies)); }, [accessPolicies]);
  useEffect(() => { localStorage.setItem('dibura_economics', JSON.stringify(economics)); }, [economics]);
  useEffect(() => { localStorage.setItem('dibura_pbx_config', JSON.stringify(pbxConfig)); }, [pbxConfig]);
  useEffect(() => { localStorage.setItem('dibura_callbacks', JSON.stringify(callbacks)); }, [callbacks]);
  useEffect(() => { localStorage.setItem('dibura_study_materials', JSON.stringify(studyMaterials)); }, [studyMaterials]);
  useEffect(() => { localStorage.setItem('dibura_detailed_calls', JSON.stringify(detailedCalls)); }, [detailedCalls]);
  useEffect(() => { localStorage.setItem('dibura_game_scores', JSON.stringify(gameScores)); }, [gameScores]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // Bot actions
  const saveBotProfile = (updated: BotProfile) => {
    setBots(prev => prev.map(b => b.id === updated.id ? { ...updated, active_version: updated.active_version + 1 } : b));
    showToast(`פרופיל הבוט "${updated.label}" עודכן בהצלחה.`);
  };

  const saveBotControls = (botId: string, ctrl: TutorControls) => {
    setControls(prev => ({ ...prev, [botId]: ctrl }));
    setBots(prev => prev.map(b => b.id === botId ? { ...b, active_version: b.active_version + 1 } : b));
    showToast(`הגדרות הפרומפט והדיבור נשמרו לגרסה חדשה.`);
  };

  const createBot = (botData: Partial<BotProfile>): BotProfile => {
    const id = botData.id || `bot_${Date.now()}`;
    const newBot: BotProfile = {
      id,
      label: botData.label || 'מורה חדש',
      role: botData.role || 'teacher',
      audience: botData.audience || 'general',
      channel_id: botData.channel_id || '',
      description: botData.description || 'תיאור המורה ומטרות השיחה',
      enabled: true,
      phone_enabled: true,
      web_enabled: true,
      websocket_path: `/v1/technoline/stream/${id}`,
      active_version: 1,
      channel_configured: false
    };
    const defaultCtrl: TutorControls = {
      ...INITIAL_CONTROLS['maya-child'],
      learning_goal: `למידה עם ${newBot.label}`
    };
    setBots(prev => [...prev, newBot]);
    setControls(prev => ({ ...prev, [id]: defaultCtrl }));
    showToast(`הבוט "${newBot.label}" נוצר בהצלחה.`);
    return newBot;
  };

  const duplicateBot = (botId: string, newId: string, newLabel: string): BotProfile => {
    const existing = bots.find(b => b.id === botId);
    if (!existing) throw new Error('Bot not found');
    const cloned: BotProfile = {
      ...existing,
      id: newId,
      label: newLabel,
      active_version: 1,
      websocket_path: `/v1/technoline/stream/${newId}`,
      enabled: false,
      channel_configured: false
    };
    const clonedControls = controls[botId] ? { ...controls[botId] } : { ...INITIAL_CONTROLS['maya-child'] };
    setBots(prev => [...prev, cloned]);
    setControls(prev => ({ ...prev, [newId]: clonedControls }));
    showToast(`הבוט שוכפל בהצלחה בשם "${newLabel}".`);
    return cloned;
  };

  const restoreBotVersion = (botId: string, version: number) => {
    showToast(`גרסה ${version} שוחזרה ופורסמה בהצלחה.`);
  };

  // Customer actions
  const saveCustomer = (cust: Customer) => {
    setCustomers(prev => prev.map(c => c.id === cust.id ? { ...cust, updated_at: new Date().toISOString() } : c));
    showToast(`תיק הלקוח "${cust.name}" עודכן.`);
  };

  const createCustomer = (custData: Partial<Customer>): Customer => {
    const id = `cust_${Date.now()}`;
    const newCust: Customer = {
      id,
      name: custData.name || 'לקוח חדש',
      phone: custData.phone || '050-0000000',
      source: custData.source || 'manual_admin',
      preferred_bot: custData.preferred_bot || 'maya-child',
      notes: custData.notes || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      has_paid: false,
      paid_ils: 0,
      open_issues: 0
    };
    setCustomers(prev => [newCust, ...prev]);
    showToast(`הלקוח "${newCust.name}" נוסף למערכת.`);
    return newCust;
  };

  const generateCustomerInvite = (customerId: string): string => {
    const token = `inv_${customerId}_${Math.random().toString(36).substring(2, 9)}`;
    return `${window.location.origin}/learn#${token}`;
  };

  // Courses & Lessons
  const saveCourse = (course: Course) => {
    setCourses(prev => prev.map(c => c.id === course.id ? course : c));
    showToast(`המסלול "${course.name}" נשמר.`);
  };

  const createCourse = (data: Partial<Course>): Course => {
    const newC: Course = {
      id: `course_${Date.now()}`,
      name: data.name || 'מסלול לימוד חדש',
      level: data.level || 'בסיסי',
      bot_id: data.bot_id || 'maya-child',
      lessons: data.lessons || [
        { title: 'שיעור 1: היכרות וברכות', goal: 'היכרות ראשונית', instructions: 'למד ביטויים בסיסיים', passing_score: 3 }
      ],
      active: true
    };
    setCourses(prev => [...prev, newC]);
    showToast(`המסלול "${newC.name}" נוצר.`);
    return newC;
  };

  const saveEnrollment = (enr: Enrollment) => {
    setEnrollments(prev => prev.map(e => e.id === enr.id ? { ...enr, updated_at: new Date().toISOString() } : e));
    showToast(`התקדמות התלמיד עודכנה לשיעור ${enr.lesson_index + 1}.`);
  };

  const createEnrollment = (customerId: string, courseId: string, lessonIndex: number): Enrollment => {
    const newEnr: Enrollment = {
      id: `enr_${Date.now()}`,
      customer_id: customerId,
      course_id: courseId,
      lesson_index: lessonIndex,
      status: 'active',
      updated_at: new Date().toISOString()
    };
    setEnrollments(prev => [...prev, newEnr]);
    showToast(`התלמיד שויך למסלול בהצלחה.`);
    return newEnr;
  };

  // Packages & Billing
  const savePackage = (pkg: Package) => {
    setPackages(prev => prev.map(p => p.id === pkg.id ? pkg : p));
    showToast(`החבילה "${pkg.name}" עודכנה.`);
  };

  const createPackage = (data: Partial<Package>): Package => {
    const newP: Package = {
      id: `pkg_${Date.now()}`,
      name: data.name || 'חבילה חדשה',
      product: data.product || 'school',
      minutes: data.minutes || 100,
      price_ils: data.price_ils || 200,
      validity_days: data.validity_days || 30,
      active: true,
      phone_enabled: true
    };
    setPackages(prev => [...prev, newP]);
    showToast(`החבילה "${newP.name}" נוצרה.`);
    return newP;
  };

  const recordManualReceipt = (customerId: string, packageId: string, reference: string, amountIls: number): Receipt => {
    const pkg = packages.find(p => p.id === packageId);
    const newRec: Receipt = {
      id: `rec_${Date.now()}`,
      customer_id: customerId,
      package_id: packageId,
      product: pkg?.product || 'school',
      reference: reference || `manual:${Date.now()}`,
      amount_ils: amountIls,
      minutes: pkg?.minutes || 100,
      spent_seconds: 0,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + (pkg?.validity_days || 30) * 86400000).toISOString()
    };
    setReceipts(prev => [newRec, ...prev]);
    // Update customer status
    setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, has_paid: true, paid_ils: (c.paid_ils || 0) + amountIls } : c));
    showToast(`התקבול נרשם בהצלחה והדקות הוטענו לתיק הלקוח.`);
    return newRec;
  };

  const reconcileNedarimPayments = async (): Promise<string> => {
    // Simulated Nedarim Plus API audit
    await new Promise(r => setTimeout(r, 900));
    const resolvedOrders = paymentOrders.map(o => o.state === 'awaiting_settlement' ? { ...o, state: 'paid' as const, pending_review: false, transaction_id: `NEDARIM-${Math.floor(100000 + Math.random() * 900000)}` } : o);
    setPaymentOrders(resolvedOrders);
    showToast('בדיקת ההתאמה מול נדרים פלוס הושלמה בהצלחה; כל העסקאות אומתו.');
    return 'Reconciled successfully';
  };

  const resolvePaymentIssue = (issueId: string, note: string) => {
    setPaymentIssues(prev => prev.map(i => i.id === issueId ? { ...i, status: 'resolved', resolution_note: note } : i));
    showToast('בעיית הגבייה סומנה כטופלה.');
  };

  // Narration
  const saveNarration = (nar: Narration) => {
    setNarrations(prev => prev.map(n => n.id === nar.id ? nar : n));
    showToast(`נוסח הקריינות "${nar.name}" נשמר.`);
  };

  const createNarration = (data: Partial<Narration>): Narration => {
    const newN: Narration = {
      id: `narr_${Date.now()}`,
      name: data.name || 'קריינות חדשה',
      placement: data.placement || 'welcome',
      text: data.text || 'טקסט הקריינות כאן...',
      language: data.language || 'he-IL',
      bot_id: data.bot_id || 'maya-child',
      technoline_extension: data.technoline_extension || '/99',
      status: 'draft'
    };
    setNarrations(prev => [...prev, newN]);
    showToast(`הקריינות "${newN.name}" נוצרה.`);
    return newN;
  };

  const generateNarrationAudio = async (narrationId: string): Promise<string> => {
    await new Promise(r => setTimeout(r, 600));
    const nar = narrations.find(n => n.id === narrationId);
    if (nar && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(nar.text);
      u.lang = nar.language || 'he-IL';
      window.speechSynthesis.speak(u);
    }
    showToast('האודיו נוצר ומוכן להאזנה.');
    return 'audio_generated';
  };

  const publishNarrationToIvr = (narrationId: string, slot: string) => {
    const nar = narrations.find(n => n.id === narrationId);
    if (!nar) return;
    setPbxConfig(prev => ({
      ...prev,
      copy: {
        ...prev.copy,
        [slot]: nar.text || nar.hebrew_script || ''
      }
    }));
    showToast(`הקריינות פורסמה לשלוחה הטלפונית במיקום "${slot}".`);
  };

  // PBX
  const savePbxCopy = (copy: Record<string, string>) => {
    setPbxConfig(prev => ({ ...prev, copy }));
    showToast('כל נוסחי המרכזייה נשמרו ויחולו בפנייה הבאה מהקו.');
  };

  const syncAndVerifyPbx = async () => {
    await new Promise(r => setTimeout(r, 800));
    setPbxEvents(prev => [
      {
        id: `evt_${Date.now()}`,
        at: new Date().toISOString(),
        route: '/99',
        latency_ms: 8,
        caller: 'ADMIN-AUDIT',
        response: 'All 8 extensions on /99 branch verified and synced.'
      },
      ...prev
    ]);
    showToast('אומתו 8 שלוחות בשלוחה 99 בטכנוליין; התפריט הראשי נשמר.');
    return { success: true, message: 'All verified' };
  };

  const stopActiveSession = (callId: string) => {
    setActiveAiSessions(prev => prev.filter(s => s.call_id !== callId));
    showToast(`הסשן ${callId} נסגר.`);
  };

  const saveEconomics = (eco: Economics) => {
    setEconomics(eco);
    showToast('הנחות המודל הכלכלי נשמרו והתרחישים חושבו מחדש.');
  };

  const submitCallbackRequest = (data: Omit<CallbackRequest, 'id' | 'created_at' | 'status'>) => {
    const newReq: CallbackRequest = {
      ...data,
      id: `cb_${Date.now()}`,
      created_at: new Date().toISOString(),
      status: 'pending'
    };
    setCallbacks(prev => [newReq, ...prev]);
    // Also create customer lead in CRM
    createCustomer({
      name: data.name,
      phone: data.phone,
      source: 'landing_callback',
      notes: `מטרה: ${data.goal || 'לא צוינה'} | עבור: ${data.for_whom} | עיתוי מועדף: ${data.timing === 'scheduled' ? data.preferred_time : 'מיידי'}`
    });
    showToast('בקשת השיחה התקבלה בהצלחה! ניצור קשר בהקדם.');
  };

  // Learner Specific Actions
  const addStudyMaterial = (mat: { title: string; topic: string; level: 'beginner' | 'intermediate' | 'advanced'; rawText: string }): StudyMaterial => {
    // Automatically analyze text into vocabulary and key phrases
    const lines = mat.rawText.split('\n').filter(l => l.trim().length > 0);
    const vocabList: Array<{ english: string; hebrew: string; example?: string }> = [];
    const phrasesList: Array<{ english: string; hebrew: string }> = [];

    // Simple heuristic parser for user-entered vocab pairs or text lines
    lines.forEach(line => {
      if (line.includes('-') || line.includes(':')) {
        const parts = line.split(/[-:]/);
        if (parts.length >= 2) {
          const en = parts[0].trim();
          const he = parts[1].trim();
          if (/[a-zA-Z]/.test(en) && /[\u0590-\u05FF]/.test(he)) {
            vocabList.push({ english: en, hebrew: he, example: `Example using ${en}` });
          } else if (/[a-zA-Z]/.test(he) && /[\u0590-\u05FF]/.test(en)) {
            vocabList.push({ english: he, hebrew: en, example: `Example using ${he}` });
          }
        }
      } else if (line.length > 20 && /[a-zA-Z]/.test(line)) {
        phrasesList.push({ english: line.trim(), hebrew: 'משפט תרגול שנלמד מהחומר' });
      }
    });

    if (vocabList.length === 0) {
      // Fallback extracted sample from text
      vocabList.push(
        { english: 'Conversation', hebrew: 'שיחה', example: 'Practice this in your next lesson.' },
        { english: 'Vocabulary', hebrew: 'אוצר מילים', example: 'Expand your active vocabulary.' },
        { english: 'Confidence', hebrew: 'ביטחון בדיבור', example: 'Speak with confidence.' }
      );
    }

    const newMaterial: StudyMaterial = {
      id: `mat_${Date.now()}`,
      customer_id: activeLearnerId,
      title: mat.title,
      topic: mat.topic,
      level: mat.level,
      raw_text: mat.rawText,
      vocabulary: vocabList,
      key_phrases: phrasesList.length > 0 ? phrasesList : [
        { english: `Today we are practicing ${mat.topic}.`, hebrew: `היום אנו מתרגלים ${mat.topic}.` }
      ],
      pedagogical_instructions: `התמקד באוצר המילים של ${mat.topic}, שאל שאלות ממוקדות ותרגל שימוש במשפטים.`,
      is_active_for_phone: true, // Auto-set as active for next phone call
      created_at: new Date().toISOString()
    };

    // If active for phone, deactivate other materials for this learner
    setStudyMaterials(prev => [
      newMaterial,
      ...prev.map(m => m.customer_id === activeLearnerId ? { ...m, is_active_for_phone: false } : m)
    ]);

    showToast(`חומר הלימוד "${newMaterial.title}" הועלה והוגדר כנושא הפעיל לשיחה הטלפונית הבאה!`);
    return newMaterial;
  };

  const toggleMaterialActiveForPhone = (materialId: string) => {
    setStudyMaterials(prev => prev.map(m => {
      if (m.id === materialId) {
        const nextState = !m.is_active_for_phone;
        if (nextState) {
          showToast(`חומר הלימוד "${m.title}" הוגדר כנושא לשיחה הטלפונית הבאה.`);
        } else {
          showToast(`חומר הלימוד הוסר כנושא פעיל לשיחה.`);
        }
        return { ...m, is_active_for_phone: nextState };
      }
      // If setting this one to active, deactivate siblings for same customer
      return m.customer_id === activeLearnerId ? { ...m, is_active_for_phone: false } : m;
    }));
  };

  const deleteStudyMaterial = (materialId: string) => {
    setStudyMaterials(prev => prev.filter(m => m.id !== materialId));
    showToast('חומר הלימוד נמחק.');
  };

  const recordGameResult = (result: { game_type: GameType; game_title: string; score: number; total_questions: number; points_earned: number; accuracy_pct: number }) => {
    const newRecord: GameScoreRecord = {
      ...result,
      id: `gscore_${Date.now()}`,
      customer_id: activeLearnerId,
      completed_at: new Date().toISOString()
    };
    setGameScores(prev => [newRecord, ...prev]);
    showToast(`מעולה! הרווחת ${result.points_earned} נקודות במשחק.`);
  };

  const sendLearnerMessage = async (
    text: string,
    botId: string,
    mode: 'course' | 'free' | 'translation',
    targetLang: string = 'English'
  ) => {
    await new Promise(r => setTimeout(r, 650));
    const activeMat = studyMaterials.find(m => m.customer_id === activeLearnerId && m.is_active_for_phone);
    const bot = bots.find(b => b.id === botId);

    let replyText = '';
    let translationHe = '';
    const corrections: Array<{ original: string; correction: string; explanation_he: string }> = [];

    // Pedagogical response logic based on mode and active materials
    if (mode === 'translation') {
      replyText = `Translation to ${targetLang}: "${text}" -> "Here is the accurate spoken translation in natural context."`;
      translationHe = `תרגום מדויק לשפת ${targetLang} בתוך הקשר השיחה.`;
    } else {
      // Check for common learner mistakes for coaching
      const lower = text.toLowerCase();
      if (lower.includes('i have 20 years') || lower.includes('i am have')) {
        corrections.push({
          original: 'I have 20 years',
          correction: 'I am 20 years old',
          explanation_he: 'באנגלית מציינים גיל באמצעות הפועל to be (I am) ולא have.'
        });
      }
      if (lower.includes('he go') || lower.includes('she come')) {
        corrections.push({
          original: 'he go / she come',
          correction: 'he goes / she comes',
          explanation_he: 'בהווה פשוט, גוף שלישי (he/she/it) מקבל תוספת -s או -es לפועל.'
        });
      }

      const activeVocabHint = activeMat?.vocabulary[0]?.english ? ` Notice we are practicing: "${activeMat.vocabulary[0].english}".` : '';

      if (botId === 'maya-child') {
        replyText = `כל הכבוד על הניסיון! אמרת את זה יפה מאוד.${activeVocabHint} נסי לחזור על המשפט בקול רם: "Yes, I understand and I want to practice more."`;
        translationHe = `Well done on the try! You said that very nicely. Try repeating the sentence aloud!`;
      } else {
        replyText = `Great effort. Your point is clear.${activeVocabHint} To sound even more professional and natural, you can say: "I would like to clarify the key points before we proceed." How would you frame the next question?`;
        translationHe = `מאמץ מצוין, הנקודה שלך ברורה. כדי להישמע מקצועי וטבעי עוד יותר, מומלץ להשתמש בניסוח מלוטש.`;
      }
    }

    // Play speech synthesis audio
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(replyText);
      u.lang = botId === 'alex-adult' ? 'en-US' : 'he-IL';
      window.speechSynthesis.speak(u);
    }

    const pointsEarned = 15;

    // Append to detailed call session
    const newTurn: DetailedCallRecord = {
      call_id: `call_web_${Date.now()}`,
      customer_id: activeLearnerId,
      bot_id: botId,
      bot_name: bot?.label || 'מורה AI',
      created_at: new Date().toISOString(),
      duration_seconds: 120,
      points: pointsEarned,
      topic: activeMat ? activeMat.title : (mode === 'course' ? 'שיעור מסלול' : 'שיחה חופשית'),
      summary_he: `התלמיד שלח: "${text}". המורה סיפק פידבק פדגוגי והנחיית תרגול.`,
      success_he: 'השתתפות אקטיבית ודיוק בשימוש באוצר מילים.',
      next_step_he: 'המשך תרגול שטף משפטים.',
      grammar_score: corrections.length > 0 ? 82 : 94,
      vocabulary_score: 90,
      fluency_score: 88,
      turns: [
        {
          id: `t_user_${Date.now()}`,
          speaker: 'learner',
          text,
          translation_he: 'קלט התלמיד',
          corrections: corrections.length > 0 ? corrections : undefined,
          timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
        },
        {
          id: `t_bot_${Date.now()}`,
          speaker: 'tutor',
          text: replyText,
          translation_he: translationHe,
          vocab_highlights: activeMat?.vocabulary.map(v => v.english) || ['practice', 'speaking'],
          timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
        }
      ]
    };

    setDetailedCalls(prev => [newTurn, ...prev]);

    return {
      replyText,
      translationHe,
      corrections,
      pointsEarned
    };
  };

  const [pbxRoutes, setPbxRoutes] = useState<PbxRoute[]>([
    {
      extension: '99/1',
      name: 'בית ספר שוכי (תרגול ושיעור חי)',
      bot_id: 'shochi-robot',
      description: 'מורה אישי רובוטי וחברותא טלפוני המשלב את חומרי הלימוד האישיים',
      ivr_file: 'welcome_shochi.wav',
      is_active: true,
      system_prompt: 'You are Shochi (שוכי), a warm, humorous, empathetic robot English teacher. You speak Hebrew and English with great warmth. You guide the student through conversation practice, referencing their uploaded study material.'
    },
    {
      extension: '99/2',
      name: 'מתורגמן סימולטני קולי',
      bot_id: 'translator-pro',
      description: 'תרגום קולי מיידי עברית ↔ אנגלית לשיחות עסקיות ומסמכים',
      ivr_file: 'translator_intro.wav',
      is_active: true,
      system_prompt: 'You are a bidirectional real-time English-Hebrew voice interpreter. Maintain exact meaning and clear pronunciation.'
    },
    {
      extension: '99/3',
      name: 'שיחת מכירה ואינטייק (חבילת מתנה 20 דק)',
      bot_id: 'shochi-robot',
      description: 'שיחה אישית מול שוכי עם אבחון רמה ראשוני ומתן חבילת מתנה',
      ivr_file: 'intake_gift.wav',
      is_active: true,
      system_prompt: 'You are Shochi greeting a new student who registered on the landing page. Welcome them, conduct a 2-minute friendly spoken intake to assess their level, celebrate their initiative, and explain that their 20-minute gift pack is activated.'
    }
  ]);

  const currentCustomer: Customer = {
    ...(customers.find(c => c.id === activeLearnerId) || customers[0]),
    full_name: (customers.find(c => c.id === activeLearnerId) || customers[0])?.name || 'תלמיד לדוגמה',
    balance_minutes: (customers.find(c => c.id === activeLearnerId) || customers[0])?.paid_ils ? Math.round((customers.find(c => c.id === activeLearnerId) || customers[0])!.paid_ils! * 0.8) : 20,
    current_level: 'מתחיל מתקדם (A2)',
    total_calls: 12,
    vocab_words_mastered: 84,
    streak_days: 5
  };

  const streak = {
    current_streak: 5,
    calls_today: 1,
    daily_goal: 1
  };

  const triggerIntakeCall = async (name: string, phone: string, goal: string) => {
    submitCallbackRequest({
      name,
      phone,
      for_whom: 'self',
      goal: goal || 'שיחת היכרות ומתנה',
      timing: 'now'
    });
    showToast(`שיחת אינטייק הופעלה ל-${phone}! שוכי מחייג כעת...`);
    return true;
  };

  const callRecords = detailedCalls.map((c) => ({
    id: c.call_id,
    student_name: c.customer_id === 'cust_sarah' ? 'שרה כהן' : 'יוסי לוי',
    phone_number: '050-1234567',
    topic: c.topic || 'שיעור אישי ושיחה שוטפת',
    bot_id: c.bot_id,
    date: c.created_at,
    duration_seconds: c.duration_seconds,
    status: 'completed',
    score: `${c.grammar_score}%`,
    grammar_corrections: (c.turns || []).flatMap((t) => t.corrections || []).map((cor) => ({
      original: cor.original,
      corrected: cor.correction,
      explanation: cor.explanation_he
    })),
    transcript_turns: (c.turns || []).map((t) => ({
      speaker: t.speaker === 'learner' ? 'user' : 'bot',
      text: t.text,
      translation: t.translation_he
    }))
  }));

  const terminateActiveSession = (callId: string) => {
    stopActiveSession(callId);
    showToast('השיחה נותקה בהצלחה');
  };

  const playTtsAudio = (text: string) => {
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        window.speechSynthesis.speak(u);
      }
    } catch (e) {
      console.warn('TTS not supported', e);
    }
  };

  const addNarration = (narration: Partial<Narration>) => {
    createNarration(narration);
    showToast('קריינות נוספה בהצלחה למאגר!');
  };

  const updateNarrationStatus = (id: string, status: any) => {
    setNarrations(prev => prev.map(n => n.id === id ? { ...n, status } : n));
    showToast('סטטוס הקריינות עודכן');
  };

  const updatePbxRoutePrompt = (extension: string, prompt: string) => {
    setPbxRoutes(prev => prev.map(r => r.extension === extension ? { ...r, system_prompt: prompt } : r));
    showToast(`הנחיית שלוחה ${extension} עודכנה בהצלחה`);
  };

  return (
    <AppContext.Provider
      value={{
        bots,
        controls,
        customers,
        courses,
        enrollments,
        packages,
        receipts,
        paymentOrders,
        paymentIssues,
        narrations,
        accessPolicies,
        economics,
        pbxConfig,
        pbxEvents,
        callTraces,
        diagnostics,
        activeAiSessions,
        callbacks,
        studyMaterials,
        detailedCalls,
        gameScores,
        adminToken,
        setAdminToken,
        activeLearnerId,
        setActiveLearnerId,
        toastMessage,
        showToast,
        saveBotProfile,
        saveBotControls,
        createBot,
        duplicateBot,
        restoreBotVersion,
        saveCustomer,
        createCustomer,
        generateCustomerInvite,
        saveCourse,
        createCourse,
        saveEnrollment,
        createEnrollment,
        savePackage,
        createPackage,
        recordManualReceipt,
        reconcileNedarimPayments,
        resolvePaymentIssue,
        saveNarration,
        createNarration,
        generateNarrationAudio,
        publishNarrationToIvr,
        savePbxCopy,
        syncAndVerifyPbx,
        stopActiveSession,
        saveEconomics,
        submitCallbackRequest,
        addStudyMaterial,
        toggleMaterialActiveForPhone,
        deleteStudyMaterial,
        recordGameResult,
        sendLearnerMessage,
        currentCustomer,
        streak,
        triggerIntakeCall,
        callRecords,
        terminateActiveSession,
        playTtsAudio,
        addNarration,
        updateNarrationStatus,
        pbxRoutes,
        updatePbxRoutePrompt
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
