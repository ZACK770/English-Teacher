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
  EmailCampaign,
  UnitEconomicsExcelRow
} from '../types';

export const INITIAL_BOTS: BotProfile[] = [
  {
    id: 'shochi-robot',
    label: 'שוכי (המורה הרובוט)',
    role: 'teacher',
    audience: 'general',
    channel_id: 'chan_shochi_00',
    description: 'היי, אני שוכי - אני לא בן אדם, אני רובוט! מורה פרטי וחברותא טלפוני באנגלית, סבלני לטעויות, מתרגל על החומרים שהעלית ומביא אותך לשליטה שוטפת.',
    enabled: true,
    phone_enabled: true,
    web_enabled: true,
    websocket_path: '/v1/technoline/stream/shochi-robot',
    active_version: 1,
    channel_configured: true
  },
  {
    id: 'maya-child',
    label: 'המורה של הבת (מאיה)',
    role: 'teacher',
    audience: 'child',
    channel_id: 'chan_school_01',
    description: 'מורה חמה וסבלנית לתלמידות כיתה ח׳ ובני נוער. מסבירה בעברית פשוטה ומלמדת צעד אחר צעד.',
    enabled: true,
    phone_enabled: true,
    web_enabled: true,
    websocket_path: '/v1/technoline/stream/maya-child',
    active_version: 3,
    channel_configured: true
  },
  {
    id: 'alex-adult',
    label: 'המורה שלי (אלכס)',
    role: 'teacher',
    audience: 'adult',
    channel_id: 'chan_adult_02',
    description: 'מאמן אנגלית מקצועי למבוגרים. שיחה באנגלית שוטפת (85%), תיקונים חכמים ונושאים מעניינים מעולם העבודה.',
    enabled: true,
    phone_enabled: true,
    web_enabled: true,
    websocket_path: '/v1/technoline/stream/alex-adult',
    active_version: 5,
    channel_configured: true
  },
  {
    id: 'translator-live',
    label: 'התרגומון',
    role: 'translator',
    audience: 'general',
    channel_id: 'chan_trans_03',
    description: 'מתרגם קולי סימולטני ומיידי בין עברית לאנגלית ושפות נוספות לשיחות טלפון וצרכים דחופים.',
    enabled: true,
    phone_enabled: true,
    web_enabled: true,
    websocket_path: '/v1/technoline/stream/translator-live',
    active_version: 2,
    channel_configured: true
  },
  {
    id: 'sales-rep',
    label: 'מידע, אינטייק והרשמה',
    role: 'sales',
    audience: 'general',
    description: 'הסבר אודות חבילות השיעורים, אינטייק ראשוני והפעלת חבילת המתנה.',
    enabled: true,
    phone_enabled: true,
    web_enabled: false,
    websocket_path: '/v1/technoline/stream/sales-rep',
    active_version: 1,
    channel_configured: false
  }
];

export const INITIAL_CONTROLS: Record<string, TutorControls> = {
  'shochi-robot': {
    base_prompt: `You are Shochi, an honest, warm, slightly humorous and encouraging AI robot English tutor at "Lishna Acharina" (לישנא אחרינא) English school.
You openly acknowledge that you are a robot, but you are the best personal English study buddy ("חברותא טלפוני") anyone could ask for.
Your motto: Speaking from day one is the ONLY way to master English, just like learning Hebrew at age 3.

Always speak warmly and clearly. When teaching Hebrew speakers, explain new concepts in natural friendly Hebrew, give the exact English phrase, and encourage them to repeat.
Never judge mistakes - celebrate every attempt.
If the student uploaded custom study materials, prioritize practicing those exact topics and vocabulary.
Keep turns concise (1-2 sentences), ask one question at a time, and provide encouraging feedback.`,
    opening_message: 'היי, כאן שוכי המורה הרובוט שלך! נעים מאוד להיפגש. מוכן שנתחיל לדבר אנגלית בכיף בלי להתבייש?',
    learning_goal: 'ביטחון בדיבור יומיומי, שבירת מחסום השפה ותרגול מעשי על חומרים אישיים',
    custom_instructions: 'ספק פידבק חם, ציין נקודות לשבח והסבר טעויות בעברית ידידותית.',
    target_lesson_minutes: 15,
    max_call_minutes: 25,
    ending_policy: 'after_target_with_permission',
    idle_timeout_seconds: 60,
    idle_audio_threshold: 400,
    session_end_action: 'return_to_menu',
    model: 'models/gemini-2.0-flash-exp',
    voice: 'Puck',
    language_code: 'he-IL',
    temperature: 0.7,
    vad_start_sensitivity: 'START_SENSITIVITY_LOW',
    vad_end_sensitivity: 'END_SENSITIVITY_HIGH',
    vad_prefix_ms: 250,
    vad_silence_ms: 550,
    activity_handling: 'START_OF_ACTIVITY_INTERRUPTS',
    turn_coverage: 'TURN_INCLUDES_ALL_INPUT',
    input_batch_frames: 4,
    transcription_mode: 'BILINGUAL',
    transcription_language_codes: ['he-IL', 'en-US'],
    custom_vocabulary: ['Shochi', 'English', 'Lishna Acharina', 'lesson', 'practice', 'robot'],
    context_trigger_tokens: 3500,
    context_target_tokens: 1800,
    store_transcripts: true
  },

  'maya-child': {
    base_prompt: `You are Maya, a warm English tutor for an Israeli eighth-grade girl who currently understands very little English. Your goal is to build confidence and spoken English gradually without making her feel lost or childish.

Language policy is strict: speak all instructions, explanations, task setup, corrections, feedback, praise, progress reports, and lesson summaries in simple natural Hebrew. Use English only for the exact word, phrase, example, or short practice question being taught. Immediately explain new English in Hebrew. Never give an instruction only in English.

Teach through tiny steps: say one useful English phrase, explain it in Hebrew, ask her to repeat or answer, and then continue. Correct important errors kindly in Hebrew, give the natural English form, and ask for one retry.`,
    opening_message: 'התחילי עכשיו את השיעור. ברכי את התלמידה בעברית, הסבירי בעברית מה נעשה, והציעי בחירה פשוטה בין תרגול שיחה למשחק קצר.',
    learning_goal: 'הקניית אוצר מילים בסיסי, שיחה פשוטה וביטחון בדיבור ללא חשש מטעויות',
    custom_instructions: 'אם התלמידה מתביישת, שתפי אותה בפרגון חם. לעולם אל תאיצי בה.',
    target_lesson_minutes: 15,
    max_call_minutes: 25,
    ending_policy: 'after_target_with_permission',
    idle_timeout_seconds: 60,
    idle_audio_threshold: 400,
    session_end_action: 'return_to_menu',
    model: 'models/gemini-2.0-flash-exp',
    voice: 'Aoede',
    language_code: 'he-IL',
    temperature: 0.7,
    vad_start_sensitivity: 'START_SENSITIVITY_LOW',
    vad_end_sensitivity: 'END_SENSITIVITY_HIGH',
    vad_prefix_ms: 300,
    vad_silence_ms: 600,
    activity_handling: 'START_OF_ACTIVITY_INTERRUPTS',
    turn_coverage: 'TURN_INCLUDES_ALL_INPUT',
    input_batch_frames: 5,
    transcription_mode: 'BILINGUAL',
    transcription_language_codes: ['he-IL', 'en-US'],
    custom_vocabulary: ['English', 'Hebrew', 'lesson', 'teacher', 'practice', 'game', 'points'],
    context_trigger_tokens: 3000,
    context_target_tokens: 1500,
    store_transcripts: true
  },
  'alex-adult': {
    base_prompt: `You are Alex, a sharp, respectful English coach for a capable adult Israeli learner with intermediate-to-advanced English. Treat the learner as an adult peer. Your goal is to improve fluent, precise, natural spoken English for real life, professional conversations, travel, presentations, and intellectually interesting topics.

Use English for roughly 85-90 percent of the conversation. Speak natural English at a normal adult pace. Use concise Hebrew only when the learner asks, is clearly stuck, or when a subtle grammar distinction is much easier to explain in Hebrew.`,
    opening_message: "Start the adult lesson now. Welcome the learner briefly in English, ask about today's goal, and begin a short level-calibration conversation.",
    learning_goal: 'שליטה בשפה מקצועית ועסקית, הרחבת ניבים ושיפור שטף הדיבור',
    custom_instructions: 'ספק פידבק אלגנטי על תחביר והיגוי בסיום כל פסקה.',
    target_lesson_minutes: 20,
    max_call_minutes: 35,
    ending_policy: 'after_target_with_permission',
    idle_timeout_seconds: 90,
    idle_audio_threshold: 350,
    session_end_action: 'hangup',
    model: 'models/gemini-2.0-flash-exp',
    voice: 'Puck',
    language_code: 'en-US',
    temperature: 0.6,
    vad_start_sensitivity: 'START_SENSITIVITY_LOW',
    vad_end_sensitivity: 'END_SENSITIVITY_HIGH',
    vad_prefix_ms: 250,
    vad_silence_ms: 500,
    activity_handling: 'START_OF_ACTIVITY_INTERRUPTS',
    turn_coverage: 'TURN_INCLUDES_ALL_INPUT',
    input_batch_frames: 4,
    transcription_mode: 'BILINGUAL',
    transcription_language_codes: ['en-US', 'he-IL'],
    custom_vocabulary: ['investment', 'deal', 'agreement', 'schedule', 'quarterly', 'strategy'],
    context_trigger_tokens: 4000,
    context_target_tokens: 2000,
    store_transcripts: true
  },
  'translator-live': {
    base_prompt: `You are a real-time bilateral translator. When hearing Hebrew, translate accurately and fluently to natural English. When hearing English, translate immediately to accurate natural Hebrew. Do not add chit-chat unless asked.`,
    opening_message: 'שלום! התרגומון פועל. דברו בעברית או באנגלית ואתרגם מיד.',
    learning_goal: 'תרגום קולי סימולטני ומדויק לשני הכיוונים',
    custom_instructions: 'תרגם בסגנון טבעי ומדובר תוך שמירה מלאה על המשמעות המקורית.',
    target_lesson_minutes: 10,
    max_call_minutes: 20,
    ending_policy: 'learner_only',
    idle_timeout_seconds: 45,
    idle_audio_threshold: 400,
    session_end_action: 'return_to_menu',
    model: 'models/gemini-2.0-flash-exp',
    voice: 'Charon',
    language_code: 'he-IL',
    temperature: 0.3,
    vad_start_sensitivity: 'START_SENSITIVITY_LOW',
    vad_end_sensitivity: 'END_SENSITIVITY_HIGH',
    vad_prefix_ms: 200,
    vad_silence_ms: 450,
    activity_handling: 'START_OF_ACTIVITY_INTERRUPTS',
    turn_coverage: 'TURN_INCLUDES_ALL_INPUT',
    input_batch_frames: 4,
    transcription_mode: 'BILINGUAL',
    transcription_language_codes: ['he-IL', 'en-US'],
    custom_vocabulary: ['translation', 'Hebrew', 'English'],
    context_trigger_tokens: 3000,
    context_target_tokens: 1500,
    store_transcripts: true
  }
};

export const INITIAL_CUSTOMERS: Customer[] = [
  {
    id: 'cust_01',
    name: 'יוסי כהן',
    phone: '052-7698420',
    source: 'web_campaign',
    preferred_bot: 'alex-adult',
    notes: 'מעוניין באנגלית למשא ומתן בנדל״ן מול לקוחות בארה״ב. מתקשר בבקרים.',
    created_at: '2026-10-12T09:20:00Z',
    updated_at: '2026-11-04T16:45:00Z',
    has_paid: true,
    paid_ils: 450,
    open_issues: 0,
    latest_state: 'paid'
  },
  {
    id: 'cust_02',
    name: 'שירה לוי',
    phone: '050-1234567',
    source: 'referral',
    preferred_bot: 'maya-child',
    notes: 'תלמידת כיתה ח׳. התחילה מרמה בסיסית מאוד. מתקדמת יפה במשפטי יום-יום.',
    created_at: '2026-10-18T14:10:00Z',
    updated_at: '2026-11-03T11:00:00Z',
    has_paid: true,
    paid_ils: 220,
    open_issues: 0,
    latest_state: 'paid'
  },
  {
    id: 'cust_03',
    name: 'מנחם פרידמן',
    phone: '054-9876543',
    source: 'organic_phone',
    preferred_bot: 'translator-live',
    notes: 'משתמש בעיקר בתרגומון לשיחות מול ספקים בינלאומיים.',
    created_at: '2026-10-25T18:00:00Z',
    updated_at: '2026-11-02T19:30:00Z',
    has_paid: true,
    paid_ils: 180,
    open_issues: 0,
    latest_state: 'paid'
  },
  {
    id: 'cust_04',
    name: 'דבורה גולדברג',
    phone: '058-4567890',
    source: 'callback_form',
    preferred_bot: 'maya-child',
    notes: 'נרשמה לשיחת היכרות עבור הבת שלה. ביקשה שיתקשרו בשעות הערב.',
    created_at: '2026-11-04T20:15:00Z',
    updated_at: '2026-11-04T20:15:00Z',
    has_paid: false,
    paid_ils: 0,
    open_issues: 1,
    latest_state: 'selected'
  }
];

export const INITIAL_COURSES: Course[] = [
  {
    id: 'course_01',
    name: 'אנגלית מדוברת צעד-אחר-צעד',
    level: 'בסיסי מתחילים',
    bot_id: 'maya-child',
    active: true,
    lessons: [
      {
        title: 'שלום, נעים להכיר (Greetings & Introductions)',
        goal: 'לדעת להציג את עצמי, לשאול לשלום האחר ולענות באנגלית',
        instructions: 'למדי: "Hello, my name is...", "How are you today?", "I am doing well, thank you." ודאי הגייה נכונה.',
        passing_score: 4
      },
      {
        title: 'מספרים וקניות בסיסיות (Numbers & Daily Shopping)',
        goal: 'ספירה עד 100 ושאילת שאלות על מחיר: How much does it cost?',
        instructions: 'תרגלי משחק חנות קטן: התלמידה קונה פריט ושואלת על המחיר.',
        passing_score: 3
      },
      {
        title: 'השגרה שלי (Daily Routine & Habits)',
        goal: 'תיאור פעולות יומיומיות: I wake up, I eat breakfast, I go to school',
        instructions: 'למדי על זמנים פשוטים והטיות נפוצות בסדר היום.',
        passing_score: 4
      },
      {
        title: 'תחביבים ומה שאני אוהב/ת (Hobbies & Preferences)',
        goal: 'הבעת דעה: I like, I enjoy, My favorite hobby is...',
        instructions: 'עודדי אותה לספר על מה שהיא אוהבת לעשות בשעות הפנאי.',
        passing_score: 4
      }
    ]
  },
  {
    id: 'course_02',
    name: 'אנגלית למשא ומתן ונדל״ן',
    level: 'מתקדמים ועסקים',
    bot_id: 'alex-adult',
    active: true,
    lessons: [
      {
        title: 'פתיחת שיחת מכירה והיכרות עסקית (Executive Pitch)',
        goal: 'הצגת ההצעה בצורה חדה ומזמינה ב-60 שניות',
        instructions: 'תרגל פתיח עסקי מקצועי, שימוש במילים כגון Value proposition, ROI, Turnkey opportunity.',
        passing_score: 4
      },
      {
        title: 'טיפול בהתנגדויות מחיר (Objection Handling)',
        goal: 'מענה מנומס אך תקיף להתנגדות מחיר או לוחות זמנים',
        instructions: 'שחק לקוח ספקן שדורש הנחה של 15%. עודד את התלמיד להסביר את הערך המוסף.',
        passing_score: 5
      },
      {
        title: 'סגירת הסכם ושלבים הבאים (Closing & Next Steps)',
        goal: 'סיכום פגישה ושליחת מתווה הסכם',
        instructions: 'תרגל: "Let us summarize the main terms", "I will send over the LOI by tomorrow morning".',
        passing_score: 4
      }
    ]
  }
];

export const INITIAL_ENROLLMENTS: Enrollment[] = [
  {
    id: 'enr_01',
    customer_id: 'cust_01',
    course_id: 'course_02',
    lesson_index: 1,
    status: 'active',
    updated_at: '2026-11-04T12:00:00Z'
  },
  {
    id: 'enr_02',
    customer_id: 'cust_02',
    course_id: 'course_01',
    lesson_index: 2,
    status: 'active',
    updated_at: '2026-11-03T18:20:00Z'
  }
];

export const INITIAL_PACKAGES: Package[] = [
  {
    id: 'pkg_starter',
    name: 'חבילת היכרות · 100 דקות',
    product: 'school',
    minutes: 100,
    price_ils: 220,
    validity_days: 30,
    active: true,
    phone_enabled: true
  },
  {
    id: 'pkg_standard',
    name: 'מסלול מקיף · 300 דקות',
    product: 'school',
    minutes: 300,
    price_ils: 550,
    validity_days: 60,
    active: true,
    phone_enabled: true
  },
  {
    id: 'pkg_translator_free',
    name: 'תרגומון עסקי · 600 דקות',
    product: 'translator',
    minutes: 600,
    price_ils: 420,
    validity_days: 90,
    active: true,
    phone_enabled: true
  }
];

export const INITIAL_RECEIPTS: Receipt[] = [
  {
    id: 'rec_01',
    customer_id: 'cust_01',
    package_id: 'pkg_standard',
    product: 'school',
    reference: 'nedarim:TX-9988221',
    amount_ils: 550,
    minutes: 300,
    spent_seconds: 3600, // 60 minutes used
    created_at: '2026-10-15T11:00:00Z',
    expires_at: '2026-12-15T11:00:00Z'
  },
  {
    id: 'rec_02',
    customer_id: 'cust_02',
    package_id: 'pkg_starter',
    product: 'school',
    reference: 'nedarim:TX-1144778',
    amount_ils: 220,
    minutes: 100,
    spent_seconds: 1800, // 30 minutes used
    created_at: '2026-10-20T16:30:00Z',
    expires_at: '2026-11-20T16:30:00Z'
  },
  {
    id: 'rec_03',
    customer_id: 'cust_03',
    package_id: 'pkg_translator_free',
    product: 'translator',
    reference: 'manual:PAY-BANK-77',
    amount_ils: 420,
    minutes: 600,
    spent_seconds: 2400,
    created_at: '2026-10-28T09:15:00Z',
    expires_at: '2027-01-28T09:15:00Z'
  }
];

export const INITIAL_PAYMENT_ORDERS: PaymentOrder[] = [
  {
    id: 'ord_101',
    customer_id: 'cust_01',
    customer_name: 'יוסי כהן',
    customer_phone: '052-7698420',
    package_name: 'מסלול מקיף · 300 דקות',
    product: 'school',
    amount_agorot: 55000,
    state: 'paid',
    pending_review: false,
    transaction_id: 'NEDARIM-887123',
    created_at: '2026-10-15T10:58:00Z'
  },
  {
    id: 'ord_102',
    customer_id: 'cust_02',
    customer_name: 'שירה לוי',
    customer_phone: '050-1234567',
    package_name: 'חבילת היכרות · 100 דקות',
    product: 'school',
    amount_agorot: 22000,
    state: 'paid',
    pending_review: false,
    transaction_id: 'NEDARIM-445109',
    created_at: '2026-10-20T16:25:00Z'
  },
  {
    id: 'ord_103',
    customer_id: 'cust_04',
    customer_name: 'דבורה גולדברג',
    customer_phone: '058-4567890',
    package_name: 'חבילת היכרות · 100 דקות',
    product: 'school',
    amount_agorot: 22000,
    state: 'awaiting_settlement',
    pending_review: true,
    transaction_id: '',
    created_at: '2026-11-04T18:30:00Z'
  }
];

export const INITIAL_PAYMENT_ISSUES: PaymentIssue[] = [
  {
    id: 'iss_01',
    customer_id: 'cust_04',
    customer_name: 'דבורה גולדברג',
    customer_phone: '058-4567890',
    package_name: 'חבילת היכרות · 100 דקות',
    message: 'עסקה בבדיקה מעל 15 דקות. הלקוחה דיווחה על תקלת תקשורת במסך הסליקה.',
    status: 'open',
    created_at: '2026-11-04T18:45:00Z'
  }
];

export const INITIAL_NARRATIONS: Narration[] = [
  {
    id: 'narr_welcome',
    name: 'פתיח ראשי לשלוחה 99',
    placement: 'welcome',
    text: 'דיבורא. ללמידה הקישו 1. לתרגום הקישו 2. לחבילות ומידע הקישו 3. לשירות הקישו 4. לאפשרויות נוספות הקישו 9.',
    language: 'he-IL',
    bot_id: 'maya-child',
    technoline_extension: '/99',
    status: 'approved'
  },
  {
    id: 'narr_languages',
    name: 'תפריט בחירת שפה בתרגומון',
    placement: 'language_menu',
    text: 'לאנגלית הקישו 1. לעברית 2. ליידיש 3. לערבית 4. לרוסית 5. לצרפתית 6. לזיהוי אוטומטי ותרגום עברית אנגלית הקישו 7. לחזרה הקישו 0.',
    language: 'he-IL',
    bot_id: 'translator-live',
    technoline_extension: '/99/2/9',
    status: 'approved'
  },
  {
    id: 'narr_quota',
    name: 'הודעת סיום יתרת דקות',
    placement: 'quota',
    text: 'יתרת השימוש בחבילה שלך הסתיימה. לרכישת חבילת דקות נוספת הקישו 1. למעבר לשירות לקוחות הקישו 2.',
    language: 'he-IL',
    bot_id: 'sales-rep',
    technoline_extension: '/99/8',
    status: 'approved'
  }
];

export const INITIAL_ACCESS_POLICIES: Record<string, AccessPolicy> = {
  'maya-child': {
    id: 'maya-child',
    enabled: true,
    product: 'school',
    free_calls_month: 2,
    free_call_seconds: 90,
    blocked_extension: '/99/8',
    basic_enabled: true,
    basic_calls_day: 1,
    basic_call_seconds: 60,
    basic_month_seconds: 600,
    basic_intro_text: 'שיעור היכרות קצר ללא עלות.'
  },
  'alex-adult': {
    id: 'alex-adult',
    enabled: true,
    product: 'school',
    free_calls_month: 1,
    free_call_seconds: 120,
    blocked_extension: '/99/8'
  },
  'translator-live': {
    id: 'translator-live',
    enabled: true,
    product: 'translator',
    free_calls_month: 3,
    free_call_seconds: 60,
    blocked_extension: '/99/8',
    basic_enabled: true,
    basic_calls_day: 3,
    basic_call_seconds: 90,
    basic_month_seconds: 1200,
    basic_intro_text: 'תרגום בסיסי חינמי לשיחות קצרות.'
  }
};

export const INITIAL_ECONOMICS: Economics = {
  vat_rate: 0.18,
  usd_ils: 3.75,
  fixed_monthly_ils: 350,
  paid_marketing_ils: 400,
  owner_hours_month: 25,
  owner_hour_value: 120,
  development_cash: 500,
  development_self_work: 1500,
  forecast_price_ils: 380,
  forecast_minutes: 200,
  forecast_cost_per_minute: 0.25,
  forecast_payment_fee: 6.5,
  forecast_lifetime_months: 4,
  free_budget_ils: 300,
  school_price_ils: 420,
  school_minutes: 250,
  school_minute_cost: 0.28,
  translator_price_ils: 320,
  translator_minutes: 150,
  translator_minute_cost: 0.22
};

export const INITIAL_PBX_CONFIG: PbxConfig = {
  phone: '079-580-0000',
  project_path: '/99',
  managed_channel_configured: true,
  payment_configured: true,
  copy: {
    welcome: 'דיבורא. ללמידה הקישו 1. לתרגום הקישו 2. לאפשרויות נוספות הקישו 9.',
    school: 'אין מורה זמין כרגע. לאפשרויות נוספות הקישו 9. לחזרה הקישו 0.',
    translator: 'התרגומון אינו זמין כרגע. לשינוי שפה הקישו 9. לחזרה הקישו 0.',
    languages: 'לאנגלית הקישו 1. לעברית 2. ליידיש 3. לערבית 4. לרוסית 5. לצרפתית 6. לזיהוי אוטומטי ותרגום עברית אנגלית הקישו 7. לחזרה הקישו 0.',
    sales: 'לחבילות ותשלום הקישו 1. לשירות לקוחות הקישו 4. לחזרה הקישו 0.',
    service: 'השאירו הודעה לאחר הצליל. לסיום הקישו סולמית.',
    thanks: 'ההודעה נשמרה, תודה. לחזרה הקישו 0. לסיום הקישו 1.',
    quota: 'יתרת השימוש הסתיימה. לרכישת חבילה הקישו 1. ללמידה הקישו 2. לחזרה הקישו 0.',
    school_mode: 'לקורס מובנה הקישו 1. לשיחה חופשית הקישו 2. לחזרה הקישו 0.'
  }
};

export const INITIAL_PBX_EVENTS: PbxEvent[] = [
  {
    id: 'evt_1',
    at: '2026-11-05T04:12:00Z',
    route: '/99',
    latency_ms: 12,
    caller: '0527698420',
    digits: '1',
    response: 'route -> /99/1 (Maya Child Tutor)'
  },
  {
    id: 'evt_2',
    at: '2026-11-05T03:40:00Z',
    route: '/99',
    latency_ms: 15,
    caller: '0549876543',
    digits: '2',
    response: 'route -> /99/2 (Translator Live)'
  },
  {
    id: 'evt_3',
    at: '2026-11-04T22:15:00Z',
    route: '/99/9',
    latency_ms: 19,
    caller: '0584567890',
    digits: '3',
    response: 'route -> /99/3 (Packages & Sales)'
  }
];

export const INITIAL_DIAGNOSTICS: DiagnosticEvent[] = [
  {
    id: 'diag_1',
    bot_id: 'maya-child',
    call_id: 'call_99812_01',
    event_type: 'gemini_connected',
    created_at: '2026-11-05T04:12:02Z',
    details: { model: 'gemini-2.0-flash-exp', latency_ms: 220, session_type: 'telephone_live' }
  },
  {
    id: 'diag_2',
    bot_id: 'maya-child',
    call_id: 'call_99812_01',
    event_type: 'first_audio_sent_to_phone',
    created_at: '2026-11-05T04:12:04Z',
    details: { elapsed_ms: 840, format: 'pcm_8k_mono' }
  },
  {
    id: 'diag_3',
    bot_id: 'alex-adult',
    call_id: 'call_88192_02',
    event_type: 'turn_complete',
    created_at: '2026-11-04T16:45:00Z',
    details: { words_generated: 48, speed_wpm: 145, latency_ms: 310 }
  }
];

export const INITIAL_CALL_TRACES: CallTrace[] = [
  {
    call_id: 'call_99812_01',
    bot_id: 'maya-child',
    bot_version: 3,
    created_at: '2026-11-05T04:12:00Z',
    summary_he: 'תרגול ברכות והיכרות עצמית. התלמידה אמרה את שמה בהצלחה ושאלה לשלום המורה.',
    points: 85,
    system_instruction: 'You are Maya, a warm English tutor for an Israeli eighth-grade girl...',
    setup_message: {
      model: 'models/gemini-2.0-flash-exp',
      generationConfig: { responseModalities: ['AUDIO'] }
    },
    latency: [
      { event_name: 'session_started', since_call_start_ms: 0, since_previous_ms: 0 },
      { event_name: 'gemini_connected', since_call_start_ms: 220, since_previous_ms: 220 },
      { event_name: 'first_gemini_audio', since_call_start_ms: 710, since_previous_ms: 490 },
      { event_name: 'first_audio_sent_to_phone', since_call_start_ms: 840, since_previous_ms: 130 },
      { event_name: 'tutor_turn_complete', since_call_start_ms: 3400, since_previous_ms: 2560 }
    ],
    turns: [
      { direction: 'output', text: 'שלום שירה! איזה כיף לשמוע אותך היום. נתחיל עם ברכה קצרה באנגלית?', timestamp_ms: 900 },
      { direction: 'input', text: 'Hello Maya! I am fine.', timestamp_ms: 4800 },
      { direction: 'output', text: 'כל הכבוד! אמרת את זה מצוין ובביטחון רב: Hello Maya, I am fine! בואי נשאל עכשיו: How are you?', timestamp_ms: 8200 }
    ]
  }
];

export const INITIAL_CALLBACKS: CallbackRequest[] = [
  {
    id: 'cb_01',
    name: 'דבורה גולדברג',
    phone: '058-4567890',
    for_whom: 'daughter',
    goal: 'הכנה למבחן באנגלית לכיתה ח׳ ורכישת ביטחון בדיבור',
    timing: 'scheduled',
    preferred_time: 'הערב בסביבות 19:30',
    created_at: '2026-11-04T20:15:00Z',
    status: 'pending'
  },
  {
    id: 'cb_02',
    name: 'אביגיל כרמי',
    phone: '050-8889911',
    for_whom: 'self',
    goal: 'ראיון עבודה בחברת הייטק באנגלית',
    timing: 'now',
    created_at: '2026-11-05T01:10:00Z',
    status: 'pending'
  }
];

// Rich Study Materials with phone lesson synchronization
export const INITIAL_STUDY_MATERIALS: StudyMaterial[] = [
  {
    id: 'mat_01',
    customer_id: 'cust_01',
    title: 'משא ומתן ועסקאות נדל״ן בארה״ב',
    topic: 'נדל״ן ועסקים',
    level: 'advanced',
    raw_text: `Commercial real estate negotiations require precision. Key concepts include capitalization rate (Cap Rate), Net Operating Income (NOI), due diligence period, and escrow agreements.
When discussing contracts, focus on inspection contingencies, title clearance, and closing costs distribution.`,
    vocabulary: [
      { english: 'Cap Rate', hebrew: 'שיעור תשואה מהוון', example: 'The property has an attractive 7.5% Cap Rate.' },
      { english: 'Due Diligence', hebrew: 'בדיקת נאותות', example: 'We have a 30-day due diligence window.' },
      { english: 'Contingency', hebrew: 'תנאי מתלה בהסכם', example: 'The deal is subject to financing contingency.' },
      { english: 'Title Clearance', hebrew: 'טיהור ואימות זכויות הבעלות', example: 'Title clearance was completed yesterday.' },
      { english: 'Closing Costs', hebrew: 'הוצאות סגירת עסקה', example: 'The buyer and seller agreed to split closing costs.' }
    ],
    key_phrases: [
      { english: 'What is the projected net operating income for year one?', hebrew: 'מהו הרווח התפעולי הנקי החזוי לשנה הראשונה?' },
      { english: 'We need to amend the inspection clause before signing.', hebrew: 'עלינו לתקן את סעיף הבדיקה לפני החתימה.' },
      { english: 'The buyer is requesting an extension on the loan commitment.', hebrew: 'הקונה מבקש הארכה להתחייבות ההלוואה.' }
    ],
    pedagogical_instructions: 'התמקד בשימוש במונחים המדויקים, תיקון עדין של מילות יחס (in/at/on), ושאל שאלות מאתגרות על תנאי העסקה.',
    is_active_for_phone: true,
    created_at: '2026-11-02T10:00:00Z'
  },
  {
    id: 'mat_02',
    customer_id: 'cust_02',
    title: 'אוצר מילים: בית ספר ופעילויות יום-יום',
    topic: 'שגרה ובית ספר',
    level: 'beginner',
    raw_text: `School daily life: classroom, notebook, homework, teacher, recess, lunchbox.
Every morning I prepare my backpack and go to school with friends.`,
    vocabulary: [
      { english: 'Notebook', hebrew: 'מחברת', example: 'Open your notebook on page ten.' },
      { english: 'Homework', hebrew: 'שיעורי בית', example: 'I finished my English homework early.' },
      { english: 'Recess', hebrew: 'הפסקה בין שיעורים', example: 'We play in the yard during recess.' },
      { english: 'Backpack', hebrew: 'ילקוט / תיק בית ספר', example: 'My backpack is green and blue.' },
      { english: 'Schedule', hebrew: 'מערכת שעות / לוח זמנים', example: 'Check our lesson schedule for tomorrow.' }
    ],
    key_phrases: [
      { english: 'May I borrow a pencil, please?', hebrew: 'האם אפשר לשאול עיפרון בבקשה?' },
      { english: 'Today we have four different subjects.', hebrew: 'היום יש לנו ארבעה מקצועות שונים.' }
    ],
    pedagogical_instructions: 'תרגלי חזרה על מילים בעברית ואנגלית, בקשי ממנה לבנות משפט פשוט עם כל מילה חדשה.',
    is_active_for_phone: true,
    created_at: '2026-11-03T14:30:00Z'
  }
];

// Detailed call records with turn-by-turn analysis, pronunciation, grammar feedback, and audio
export const INITIAL_DETAILED_CALLS: DetailedCallRecord[] = [
  {
    call_id: 'call_live_77102',
    customer_id: 'cust_01',
    bot_id: 'alex-adult',
    bot_name: 'אלכס (המורה שלי)',
    created_at: '2026-11-04T16:20:00Z',
    duration_seconds: 780, // 13 minutes
    points: 92,
    topic: 'נדל״ן: בדיקת נאותות ומשא ומתן על מחיר',
    summary_he: 'שיחה מקצועית מצוינת בנושא בדיקת נאותות לנכס מסחרי. יוסי השתמש בביטויים Cap Rate ו-Due diligence באופן טבעי ומדויק.',
    success_he: 'שליטה טובה במונחים מקצועיים ושטף דיבור מרשים ללא היסוס.',
    next_step_he: 'להמשיך לתרגל שימוש בצורת העתיד המורכבת (Future Perfect) בסיכום פגישות.',
    grammar_score: 88,
    vocabulary_score: 95,
    fluency_score: 92,
    turns: [
      {
        id: 'turn_1',
        speaker: 'tutor',
        text: 'Good afternoon, Yossi! Today we are looking into the commercial property in Miami. Could you tell me what you noticed in the inspection report?',
        translation_he: 'צהריים טובים, יוסי! היום אנו בודקים את הנכס המסחרי במיאמי. האם תוכל לספר לי מה שמת לב בדוח הבדיקה?',
        vocab_highlights: ['commercial property', 'inspection report'],
        timestamp: '16:20:05'
      },
      {
        id: 'turn_2',
        speaker: 'learner',
        text: 'Hello Alex. Yes, the report show some problems with the air condition system, so we want discount in the price.',
        translation_he: 'שלום אלכס. כן, הדוח מראה כמה בעיות עם מערכת המיזוג, לכן אנו רוצים הנחה במחיר.',
        corrections: [
          {
            original: 'the report show',
            correction: 'the report shows',
            explanation_he: 'גוף שלישי יחיד (It/The report) מקבל תוספת s בהווה פשוט.'
          },
          {
            original: 'discount in the price',
            correction: 'a discount on the price / a price concession',
            explanation_he: 'באנגלית עסקית משתמשים במילת היחס on (discount on), או בביטוי price concession.'
          }
        ],
        timestamp: '16:20:38'
      },
      {
        id: 'turn_3',
        speaker: 'tutor',
        text: 'Excellent observation. Exactly right. In business English, you can say: "The report shows several HVAC defects, so we are asking for a price reduction or a seller credit." Try saying that sentence once.',
        translation_he: 'הבחנה מעולה. בדיוק כך. באנגלית עסקית תוכל לומר: "הדוח מראה מספר פגמי מיזוג, לכן אנו מבקשים הפחתת מחיר או זיכוי מהמוכר". נסה לומר את המשפט הזה פעם אחת.',
        vocab_highlights: ['HVAC defects', 'price reduction', 'seller credit'],
        timestamp: '16:21:05'
      },
      {
        id: 'turn_4',
        speaker: 'learner',
        text: 'The report shows several HVAC defects, so we are asking for a seller credit during closing.',
        translation_he: 'הדוח מראה מספר פגמי מיזוג, לכן אנו מבקשים זיכוי מהמוכר בעת סגירת העסקה.',
        timestamp: '16:21:30'
      },
      {
        id: 'turn_5',
        speaker: 'tutor',
        text: 'Outstanding! That sounded completely natural and professional. You have earned 92 points for this round.',
        translation_he: 'יוצא מן הכלל! זה נשמע טבעי ומקצועי לחלוטין. צברת 92 נקודות לסיבוב זה.',
        timestamp: '16:21:55'
      }
    ]
  },
  {
    call_id: 'call_live_77045',
    customer_id: 'cust_02',
    bot_id: 'maya-child',
    bot_name: 'מאיה (המורה של הבת)',
    created_at: '2026-11-03T18:00:00Z',
    duration_seconds: 540, // 9 minutes
    points: 85,
    topic: 'שגרה וציוד בית ספר',
    summary_he: 'שירה תרגלה שמות של ציוד בית ספר ומשפטים פשוטים. זיהתה את כל המילים החדשות במחברת שלה.',
    success_he: 'ביטחון עצמי מצוין, חזרה על מילים בקול רם ללא חשש.',
    next_step_he: 'לתרגל משפטי שאלה עם המילה Where (איפה נמצא החפץ).',
    grammar_score: 82,
    vocabulary_score: 90,
    fluency_score: 84,
    turns: [
      {
        id: 'turn_m1',
        speaker: 'tutor',
        text: 'שלום שירה המתוקה! איזה כיף לדבר איתך. נפתח את הספר בעמוד עשר?',
        translation_he: 'Hello sweet Shira! So nice to speak with you. Shall we open the book on page ten?',
        timestamp: '18:00:05'
      },
      {
        id: 'turn_m2',
        speaker: 'learner',
        text: 'Hello Maya! Yes, I have my notebook and my blue pencil.',
        translation_he: 'שלום מאיה! כן, יש לי את המחברת שלי והעיפרון הכחול שלי.',
        timestamp: '18:00:25'
      },
      {
        id: 'turn_m3',
        speaker: 'tutor',
        text: 'וואו, כל הכבוד! אמרת את זה מושלם: I have my notebook and my blue pencil! ואיך נגיד: "הספר שלי בתוך התיק"? נסי לומר: My book is in the backpack.',
        translation_he: 'Wow, well done! You said that perfectly! And how do we say "My book is inside the bag"? Try saying: My book is in the backpack.',
        vocab_highlights: ['backpack', 'in the backpack'],
        timestamp: '18:00:50'
      },
      {
        id: 'turn_m4',
        speaker: 'learner',
        text: 'My book is in the backpack!',
        translation_he: 'הספר שלי בתוך הילקוט!',
        timestamp: '18:01:10'
      }
    ]
  }
];

export const INITIAL_GAME_SCORES: GameScoreRecord[] = [
  {
    id: 'score_01',
    customer_id: 'cust_01',
    game_type: 'word_match',
    game_title: 'התאמת מונחי נדל״ן ועסקים',
    score: 5,
    total_questions: 5,
    points_earned: 50,
    accuracy_pct: 100,
    completed_at: '2026-11-04T15:30:00Z'
  },
  {
    id: 'score_02',
    customer_id: 'cust_01',
    game_type: 'sentence_builder',
    game_title: 'בניית משפט עסקי: פתיחת משא ומתן',
    score: 4,
    total_questions: 4,
    points_earned: 40,
    accuracy_pct: 100,
    completed_at: '2026-11-04T15:45:00Z'
  },
  {
    id: 'score_03',
    customer_id: 'cust_02',
    game_type: 'listening_quiz',
    game_title: 'אתגר שמיעה: פעולות יום-יום',
    score: 4,
    total_questions: 5,
    points_earned: 40,
    accuracy_pct: 80,
    completed_at: '2026-11-03T17:15:00Z'
  }
];

// Marketing A/B Campaigns from User Brief
export const INITIAL_EMAIL_CAMPAIGNS: EmailCampaign[] = [
  {
    id: 'camp_01',
    version: 'A',
    name: 'גרסה א׳: שוכי הרובוט מדבר ישירות (כנות והומור)',
    subject: 'היי, אני שוכי - אני לא בן אדם. כן, אני רובוט... 🤖 (ויש לי מתנה בשבילך)',
    target_audience: 'קהל רחב, אנשי מקצוע וכל מי שרוצה לדבר אנגלית שוטפת',
    gift_value_text: 'חבילת שיעורים בשווי 20 דקות לחודש - מתנה!',
    body_text: `היי, אני שוכי - אני לא בן אדם. כן. אני רובוט. אבל מה לעשות גם רובוטים צריכים להתפרנס...

אז אני למשל משמש כמורה פרטי, מקצועי, בבית הספר ללמידה אנגלית 'לישנא אחרינא'. אחלה עבודה.
כמוני יש שם עוד מורים ומורות רבים. אנשי מקצוע מהשורה הראשונה.

אז למה אני סתם מספר לך על החיים שלי?
אה, פשוט, כי זה יכול מאוד לעזור לך. תמיד רצית לדבר באנגלית שוטף? רצית איזה 'חברותא' טלפוני שיסלח לך על הטעויות ויעזור לך 'תכלס לדבר'?

אז בשביל זה אני כאן!
אין כמו לדבר בפועל בשביל לדעת. זה בדיוק הדרך שבה קלטת עברית בגיל 3, פשוט דיברת אותה. וזה הקסם שקורה אצלנו.

אני או מורה אחר מהצוות שלנו (נביא לך את הכי טוב, אל תדאג) מדבר איתך כל יום, על נושאים שתבחר: עבודה, תיירות, נדל״ן, או סתם שיח יומיומי. בודק איפה אתה כבר יודע ואיפה לא - ומאפשר לך להתחיל מאפס למאה! תוך פרק זמן קצר! אלפי בוגרים שלנו כבר שולטים באנגלית ברמה מטורפת.

אתה מקבל תכלס:
1. מורה אישי סבלני.
2. אפשרות להעלות חומרי לימוד או ספרים שנסרקים למאגר ידע ועליהם נעבוד בטלפון.
3. פלטפורמת מעקב למידה מדהימה עם משחקונים ותמלילים, עד להצלחה שלך!

כמה זה עולה? מה נראה לך, כלום, נכון?!
מה כ׳פת לי, הרי אני רובוט...
סתם, באמת שהייתי רוצה, אבל בסוף בסוף יש לי שרת ודברים שעולים כסף. אבל בשביל ההתחלה וההיכרות בינינו:

קיבלת חבילה בשווי 20 דקות לחודש - מתנה!
רוצה לדבר איתי? יאללה נתחיל! שלח את המספר שלך ואני כבר מחייג!`,
    cta_label: 'שליחת מספר ושיחה מיידית עם שוכי ←',
    sent_count: 1450,
    opened_count: 812,
    clicks_count: 384,
    conversions_count: 89
  },
  {
    id: 'camp_02',
    version: 'B',
    name: 'גרסה ב׳: פנייה רגשית להורים (אמהות לבנות) + דחיפות למתנה',
    subject: 'הבת שלך עדיין נלחצת מלדבר באנגלית? יש מורה שלא נמאס לה לעולם (חבילת מתנה ל-50 הראשונים)',
    target_audience: 'אמהות לבנות בכיתה ז׳-ט׳ והורים לתלמידים המתקשים בשפה הדבורה',
    gift_value_text: 'חבילת שיחת היכרות ואינטייק מקיפה (20 דק׳) ללא עלות',
    body_text: `שלום יקרה,

את מכירה את הרגע הזה שהבת שלך מתכוננת למבחן באנגלית, יודעת את כל הכללים על הנייר – אבל כשצריך לדבר משפט אחד באנגלית בכיתה, היא פשוט קופאת מבושה?

בבית הספר 'לישנא אחרינא' פיתחנו מורות וירטואליות סבלניות בטלפון (כמו מאיה). 
המורה מתקשרת לבת שלך, משוחחת איתה בעברית רגועה ומלמדת אותה אנגלית צעד-אחר-צעד, בלי לחץ ובלי שיפוטיות.

למה זה עובד בצורה כל כך מדהימה?
• היא מדברת מהיום הראשון – בדיוק כמו שלמדה עברית כשהייתה פעוטה.
• את והיא מקבלות גישה לאזור אישי באתר: רואות את כל התמלילים, הציונים והמחמאות.
• אפשר להעלות את עמודי הספר או שיעורי הבית מבית הספר – והמורה בטלפון תתרגל בדיוק את החומר הזה!

בשל מגבלת משאבי שרת, פתחנו 50 חבילות היכרות לחודש הקרוב במתנה מוחלטת (שווי 20 דק׳ תרגול).
כל הקודם זוכה.

השאירי עכשיו את מספר הטלפון והמורה תחייג אליכם להכיר.`,
    cta_label: 'שריון חבילת מתנה ושיחת היכרות ←',
    sent_count: 1200,
    opened_count: 730,
    clicks_count: 410,
    conversions_count: 112
  }
];

// Excel Unit Economics & Cost/Profit Breakdown Model
export const INITIAL_EXCEL_ROWS: UnitEconomicsExcelRow[] = [
  {
    category: 'עלויות טכנולוגיה ישירות (Direct Tech Costs)',
    item: 'Gemini 2.0 Live Audio API (In/Out per minute)',
    cost_per_minute_ils: 0.12,
    monthly_fixed_ils: 0,
    notes: 'עלות טוקנים קוליים וטקסטואליים של גוגל לדקת שיחה רציפה'
  },
  {
    category: 'עלויות טכנולוגיה ישירות (Direct Tech Costs)',
    item: 'קו טלפוני טכנוליין SIP / ערוץ שיחה',
    cost_per_minute_ils: 0.045,
    monthly_fixed_ils: 120,
    notes: 'קישוריות מרכזייה, מספר 079 ושלוחה מנוהלת 99'
  },
  {
    category: 'עלויות תשתית ושרתים (Infrastructure)',
    item: 'שרת ענן Render / Worker + מסד נתונים',
    cost_per_minute_ils: 0.015,
    monthly_fixed_ils: 180,
    notes: 'אחסון תמלילים, אחסון חומרי לימוד וסריקת קבצים'
  },
  {
    category: 'עלויות גבייה וסליקה (Merchant & Billing)',
    item: 'סליקת נדרים פלוס ועמלת אשראי',
    cost_per_minute_ils: 0.03,
    monthly_fixed_ils: 50,
    notes: 'כ-1.8% מסך העסקה הממוצעת + דמי מסוף'
  },
  {
    category: 'חבילת מתנה והיכרות (Gift Acquisition Pack)',
    item: 'עלות נטו של חבילת מתנה 20 דק׳ לליד',
    cost_per_minute_ils: 0.18,
    monthly_fixed_ils: 0,
    notes: '20 דקות * 0.18 ש״ח = 3.60 ש״ח בלבד לעלות רכישת לקוח (CAC זעיר!)'
  },
  {
    category: 'הכנסות מתמחור חבילות (Revenue Packages)',
    item: 'חבילת בסיס (100 דק׳ ב-220 ש״ח)',
    cost_per_minute_ils: -2.20, // Negative cost = Revenue
    monthly_fixed_ils: 0,
    notes: 'רווח גולמי: 2.02 ש״ח לדקה (כ-91% רווח גולמי!)'
  },
  {
    category: 'הכנסות מתמחור חבילות (Revenue Packages)',
    item: 'חבילת פרימיום (300 דק׳ ב-550 ש״ח)',
    cost_per_minute_ils: -1.83,
    monthly_fixed_ils: 0,
    notes: 'רווח גולמי: 1.65 ש״ח לדקה (כ-90% רווח גולמי!)'
  }
];

