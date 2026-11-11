export type BotRole = 'teacher' | 'translator' | 'sales' | 'service' | 'custom';
export type Audience = 'child' | 'adult' | 'general';
export type ProductFamily = 'school' | 'translator';

export interface BotProfile {
  id: string;
  label: string;
  role: BotRole;
  audience: Audience;
  channel_id?: string;
  description: string;
  enabled: boolean;
  phone_enabled: boolean;
  web_enabled: boolean;
  websocket_path: string;
  active_version: number;
  channel_configured: boolean;
}

export interface TutorControls {
  base_prompt: string;
  opening_message: string;
  learning_goal: string;
  custom_instructions: string;
  target_lesson_minutes: number;
  max_call_minutes: number;
  ending_policy: 'learner_only' | 'after_target_with_permission' | 'model_discretion';
  idle_timeout_seconds: number;
  idle_audio_threshold: number;
  session_end_action: 'hangup' | 'return_to_menu';
  model: string;
  voice: string;
  language_code: string;
  temperature: number;
  vad_start_sensitivity: 'START_SENSITIVITY_LOW' | 'START_SENSITIVITY_HIGH';
  vad_end_sensitivity: 'END_SENSITIVITY_LOW' | 'END_SENSITIVITY_HIGH';
  vad_prefix_ms: number;
  vad_silence_ms: number;
  navigation_voice?: 'engine' | 'gemini';
  activity_handling: 'START_OF_ACTIVITY_INTERRUPTS' | 'NO_INTERRUPTION';
  turn_coverage: string;
  input_batch_frames: number;
  transcription_mode: string;
  transcription_language_codes: string[];
  custom_vocabulary: string[];
  context_trigger_tokens: number;
  context_target_tokens: number;
  store_transcripts: boolean;
}

export interface BotVersion {
  version: number;
  created_at: string;
  controls: TutorControls;
}

export interface Customer {
  id: string;
  name: string;
  full_name?: string;
  phone: string;
  source: string;
  preferred_bot: string;
  notes: string;
  created_at: string;
  updated_at: string;
  has_paid?: boolean;
  paid_ils?: number;
  open_issues?: number;
  latest_state?: string;
  balance_minutes?: number;
  current_level?: string;
  total_calls?: number;
  vocab_words_mastered?: number;
  streak_days?: number;
}

export interface Lesson {
  title: string;
  goal: string;
  instructions: string;
  passing_score: number;
}

export interface Course {
  id: string;
  name: string;
  level: string;
  bot_id: string;
  lessons: Lesson[];
  active: boolean;
}

export interface Enrollment {
  id: string;
  customer_id: string;
  course_id: string;
  lesson_index: number;
  status: 'active' | 'completed' | 'paused';
  updated_at: string;
}

export interface Package {
  id: string;
  name: string;
  product: ProductFamily;
  minutes: number;
  price_ils: number;
  validity_days: number;
  active: boolean;
  phone_enabled: boolean;
}

export interface Receipt {
  id: string;
  customer_id: string;
  package_id: string;
  product: ProductFamily;
  reference: string;
  amount_ils: number;
  spent_seconds: number;
  minutes: number;
  created_at: string;
  expires_at: string;
}

export interface PaymentOrder {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  package_name: string;
  product: ProductFamily;
  amount_agorot: number;
  state: 'selected' | 'issued' | 'awaiting_settlement' | 'paid' | 'failed' | 'cancelled';
  pending_review: boolean;
  transaction_id?: string;
  created_at: string;
}

export interface PaymentIssue {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  package_name: string;
  message: string;
  status: 'open' | 'resolved';
  created_at: string;
  resolution_note?: string;
}

export interface Narration {
  id: string;
  name?: string;
  title?: string;
  placement?: 'welcome' | 'language_menu' | 'quota' | 'upsell' | 'service' | 'other' | string;
  slot?: string;
  text?: string;
  hebrew_script?: string;
  english_script?: string;
  language?: string;
  bot_id?: string;
  voice?: string;
  technoline_extension?: string;
  status?: 'draft' | 'approved' | 'ready' | 'published';
  audio_url?: string;
}

export interface PbxRoute {
  extension: string;
  name: string;
  bot_id: string;
  description: string;
  ivr_file: string;
  is_active: boolean;
  system_prompt: string;
}

export interface AccessPolicy {
  id: string;
  enabled: boolean;
  product: ProductFamily;
  free_calls_month: number;
  free_call_seconds: number;
  blocked_extension: string;
  basic_enabled?: boolean;
  basic_calls_day?: number;
  basic_call_seconds?: number;
  basic_month_seconds?: number;
  basic_intro_text?: string;
}

export interface Economics {
  vat_rate: number;
  usd_ils: number;
  fixed_monthly_ils: number;
  paid_marketing_ils: number;
  owner_hours_month: number;
  owner_hour_value: number;
  development_cash: number;
  development_self_work: number;
  forecast_price_ils: number;
  forecast_minutes: number;
  forecast_cost_per_minute: number;
  forecast_payment_fee: number;
  forecast_lifetime_months: number;
  free_budget_ils: number;
  school_price_ils: number;
  school_minutes: number;
  school_minute_cost: number;
  translator_price_ils: number;
  translator_minutes: number;
  translator_minute_cost: number;
}

export interface ActiveAiSession {
  call_id: string;
  bot_id: string;
  customer_id?: string;
  started_at: string;
  channel: string;
  stopping?: boolean;
}

export interface TurnTrace {
  direction: 'input' | 'output';
  text: string;
  timestamp_ms: number;
}

export interface LatencyEvent {
  event_name: string;
  since_call_start_ms: number;
  since_previous_ms: number;
}

export interface CallTrace {
  call_id: string;
  bot_id: string;
  bot_version: number;
  created_at: string;
  turns: TurnTrace[];
  latency: LatencyEvent[];
  system_instruction: string;
  setup_message: Record<string, unknown>;
  summary_he?: string;
  points?: number;
}

export interface DiagnosticEvent {
  id: string;
  bot_id: string;
  call_id: string;
  event_type: string;
  created_at: string;
  details: Record<string, unknown>;
}

export interface PbxConfig {
  phone: string;
  project_path: string;
  managed_channel_configured: boolean;
  payment_configured: boolean;
  copy: Record<string, string>;
}

export interface PbxEvent {
  id: string;
  at: string;
  route: string;
  latency_ms: number;
  caller: string;
  digits?: string;
  response: string;
}

export interface CallbackRequest {
  id: string;
  name: string;
  phone: string;
  for_whom: 'self' | 'daughter' | 'son' | 'other';
  goal: string;
  timing: 'now' | 'scheduled';
  preferred_time?: string;
  created_at: string;
  status: 'pending' | 'called' | 'converted';
}

export interface StudyMaterial {
  id: string;
  customer_id: string;
  title: string;
  topic: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  raw_text: string;
  vocabulary: Array<{ english: string; hebrew: string; example?: string }>;
  key_phrases: Array<{ english: string; hebrew: string }>;
  pedagogical_instructions: string;
  is_active_for_phone: boolean;
  created_at: string;
}

export type GameType = 'word_match' | 'sentence_builder' | 'listening_quiz' | 'roleplay_dialog';

export interface GameScoreRecord {
  id: string;
  customer_id: string;
  game_type: GameType;
  game_title: string;
  score: number;
  total_questions: number;
  points_earned: number;
  accuracy_pct: number;
  completed_at: string;
}

export interface DetailedTurn {
  id: string;
  speaker: 'learner' | 'tutor';
  text: string;
  translation_he?: string;
  audio_url?: string;
  corrections?: Array<{
    original: string;
    correction: string;
    explanation_he: string;
  }>;
  vocab_highlights?: string[];
  timestamp: string;
}

export interface DetailedCallRecord {
  call_id: string;
  customer_id: string;
  bot_id: string;
  bot_name: string;
  created_at: string;
  duration_seconds: number;
  points: number;
  summary_he: string;
  success_he: string;
  next_step_he: string;
  topic?: string;
  grammar_score: number; // 1-100
  vocabulary_score: number; // 1-100
  fluency_score: number; // 1-100
  turns: DetailedTurn[];
}

export interface EmailCampaign {
  id: string;
  version: 'A' | 'B';
  name: string;
  subject: string;
  target_audience: string;
  body_text: string;
  cta_label: string;
  gift_value_text: string;
  sent_count: number;
  opened_count: number;
  clicks_count: number;
  conversions_count: number;
}

export interface UnitEconomicsExcelRow {
  category: string;
  item: string;
  cost_per_minute_ils: number;
  monthly_fixed_ils: number;
  notes: string;
}

export interface HabitStreak {
  current_streak_days: number;
  daily_call_used_today: boolean;
  next_available_call: string;
  daily_goal_minutes: number;
  minutes_today: number;
  reward_unlocked: boolean;
}


