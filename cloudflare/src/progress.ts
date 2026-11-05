import { type TutorControls, TutorControlsSchema } from "./controls";
import { nowIso } from "./env";
import type { PromptArtifact } from "./prompt";

export interface Observation { skill: string; result: string; correction: string; score: number }
export interface LessonSummary { summary_he: string; success_he: string; next_step_he: string; points: number }
export interface UsageTotals {
  input_text_tokens: number; input_audio_tokens: number; output_text_tokens: number;
  output_audio_tokens: number; thoughts_tokens: number; estimated_cost_usd: number; cost_basis: string;
}
export interface Bot {
  id: string; label: string; role: string; description: string; audience: string;
  channel_id: string | null; channel_configured: boolean; enabled: boolean; phone_enabled: boolean;
  web_enabled: boolean; active_version: number; websocket_path: string; created_at: string; updated_at: string;
}

const BOT_COLUMNS =
  "id, label, role, description, audience, channel_id, enabled, phone_enabled, web_enabled, active_version, created_at, updated_at";

function botRow(r: Record<string, any>): Bot {
  return {
    id: String(r.id), label: r.label, role: r.role, description: r.description, audience: r.audience,
    channel_id: r.channel_id, channel_configured: !!r.channel_id, enabled: !!r.enabled,
    phone_enabled: !!r.phone_enabled, web_enabled: !!r.web_enabled, active_version: Number(r.active_version),
    websocket_path: `/v1/technoline/stream/bots/${r.id}`, created_at: r.created_at, updated_at: r.updated_at,
  };
}

export class ProgressStore {
  constructor(private db: D1Database) {}

  async listBots(): Promise<Bot[]> {
    const { results } = await this.db.prepare(`SELECT ${BOT_COLUMNS} FROM bots ORDER BY created_at, id`).all();
    return results.map(botRow);
  }

  async getBot(id: string): Promise<Bot | null> {
    const row = await this.db.prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE id = ?`).bind(id).first();
    return row ? botRow(row) : null;
  }

  async loadControls(profileId: string, defaults: TutorControls): Promise<TutorControls> {
    const row = await this.db
      .prepare("SELECT settings_json FROM tutor_profile_settings WHERE profile_id = ?")
      .bind(profileId)
      .first<{ settings_json: string }>();
    if (!row) return defaults;
    try {
      const parsed = TutorControlsSchema.safeParse({ ...defaults, ...JSON.parse(row.settings_json) });
      return parsed.success ? parsed.data : defaults;
    } catch {
      return defaults;
    }
  }

  async saveControls(profileId: string, controls: TutorControls): Promise<number> {
    const now = nowIso();
    const json = JSON.stringify(controls);
    let bot = await this.db.prepare("SELECT active_version FROM bots WHERE id = ?").bind(profileId).first<{ active_version: number }>();
    const stmts: D1PreparedStatement[] = [];
    if (!bot) {
      stmts.push(
        this.db
          .prepare("INSERT INTO bots (id,label,role,description,audience,channel_id,enabled,active_version,created_at,updated_at) VALUES (?,?,'teacher','','general',NULL,1,0,?,?)")
          .bind(profileId, profileId, now, now),
      );
      bot = { active_version: 0 };
    }
    const version = Number(bot.active_version) + 1;
    stmts.push(
      this.db
        .prepare("INSERT INTO tutor_profile_settings (profile_id, settings_json, updated_at) VALUES (?,?,?) ON CONFLICT(profile_id) DO UPDATE SET settings_json=excluded.settings_json, updated_at=excluded.updated_at")
        .bind(profileId, json, now),
      this.db.prepare("INSERT INTO bot_versions (bot_id, version, settings_json, created_at) VALUES (?,?,?,?)").bind(profileId, version, json, now),
      this.db.prepare("UPDATE bots SET active_version = ?, updated_at = ? WHERE id = ?").bind(version, now, profileId),
    );
    await this.db.batch(stmts);
    return version;
  }

  async createBot(bot: Omit<Bot, "channel_configured" | "websocket_path" | "active_version" | "created_at" | "updated_at">, controls: TutorControls): Promise<Bot> {
    const now = nowIso();
    const json = JSON.stringify(controls);
    await this.db.batch([
      this.db
        .prepare(`INSERT INTO bots (${BOT_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`)
        .bind(bot.id, bot.label, bot.role, bot.description, bot.audience, bot.channel_id, +bot.enabled, +bot.phone_enabled, +bot.web_enabled, now, now),
      this.db.prepare("INSERT INTO tutor_profile_settings (profile_id, settings_json, updated_at) VALUES (?,?,?)").bind(bot.id, json, now),
      this.db.prepare("INSERT INTO bot_versions (bot_id, version, settings_json, created_at) VALUES (?,1,?,?)").bind(bot.id, json, now),
    ]);
    return (await this.getBot(bot.id))!;
  }

  async updateBot(id: string, u: { label: string; role: string; description: string; audience: string; channel_id: string | null; enabled: boolean; phone_enabled: boolean; web_enabled: boolean }) {
    const result = await this.db
      .prepare("UPDATE bots SET label=?, role=?, description=?, audience=?, channel_id=?, enabled=?, phone_enabled=?, web_enabled=?, updated_at=? WHERE id=?")
      .bind(u.label, u.role, u.description, u.audience, u.channel_id, +u.enabled, +u.phone_enabled, +u.web_enabled, nowIso(), id)
      .run();
    if (result.meta.changes !== 1) throw new Error("Bot not found");
    return this.getBot(id);
  }

  async botVersions(botId: string, limit = 50) {
    const { results } = await this.db
      .prepare("SELECT version, settings_json, created_at FROM bot_versions WHERE bot_id = ? ORDER BY version DESC LIMIT ?")
      .bind(botId, Math.max(1, Math.min(limit, 100)))
      .all<{ version: number; settings_json: string; created_at: string }>();
    return results.map((r) => ({ version: Number(r.version), created_at: r.created_at, controls: JSON.parse(r.settings_json) }));
  }

  async claimCall(callId: string, profileId: string, ownerId: string, leaseSeconds = 20): Promise<boolean> {
    const now = Date.now() / 1000;
    await this.db.prepare("DELETE FROM active_calls WHERE lease_expires_at <= ?").bind(now).run();
    const done = await this.db.prepare("SELECT 1 FROM sessions WHERE call_id = ? LIMIT 1").bind(callId).first();
    if (done) return false;
    const result = await this.db
      .prepare("INSERT OR IGNORE INTO active_calls (call_id, profile_id, owner_id, acquired_at, lease_expires_at) VALUES (?,?,?,?,?)")
      .bind(callId, profileId, ownerId, now, now + leaseSeconds)
      .run();
    return result.meta.changes === 1;
  }

  async renewCall(callId: string, ownerId: string, leaseSeconds = 20): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE active_calls SET lease_expires_at = ? WHERE call_id = ? AND owner_id = ?")
      .bind(Date.now() / 1000 + leaseSeconds, callId, ownerId)
      .run();
    return result.meta.changes === 1;
  }

  async releaseCall(callId: string, ownerId: string) {
    await this.db.prepare("DELETE FROM active_calls WHERE call_id = ? AND owner_id = ?").bind(callId, ownerId).run();
  }

  async activeCalls() {
    const { results } = await this.db
      .prepare("SELECT call_id, profile_id, acquired_at FROM active_calls WHERE lease_expires_at > ?")
      .bind(Date.now() / 1000)
      .all<{ call_id: string; profile_id: string; acquired_at: number }>();
    return results;
  }

  async logDiagnostic(profileId: string, callId: string, eventType: string, details: Record<string, unknown> = {}) {
    await this.db.batch([
      this.db
        .prepare("INSERT INTO diagnostic_events (created_at, profile_id, call_id, event_type, details_json) VALUES (?,?,?,?,?)")
        .bind(nowIso(), profileId, callId, eventType.slice(0, 80), JSON.stringify(details)),
      this.db.prepare("DELETE FROM diagnostic_events WHERE id <= COALESCE((SELECT MAX(id) - 5000 FROM diagnostic_events), 0)"),
    ]);
  }

  async recentDiagnostics(profileId: string, limit = 100) {
    const { results } = await this.db
      .prepare("SELECT created_at, call_id, event_type, details_json FROM diagnostic_events WHERE profile_id = ? ORDER BY id DESC LIMIT ?")
      .bind(profileId, Math.max(1, Math.min(limit, 300)))
      .all<Record<string, string>>();
    return results.map((r) => ({ created_at: r.created_at, call_id: r.call_id, event_type: r.event_type, details: JSON.parse(r.details_json) }));
  }

  async savePromptSnapshot(profileId: string, callId: string, a: PromptArtifact) {
    const bot = await this.db.prepare("SELECT active_version FROM bots WHERE id = ?").bind(profileId).first<{ active_version: number }>();
    await this.db
      .prepare(`INSERT INTO prompt_snapshots (created_at, profile_id, call_id, bot_version, fingerprint, system_instruction, opening_message, history_context, setup_json)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(call_id) DO UPDATE SET bot_version=excluded.bot_version, fingerprint=excluded.fingerprint,
        system_instruction=excluded.system_instruction, opening_message=excluded.opening_message, history_context=excluded.history_context, setup_json=excluded.setup_json`)
      .bind(nowIso(), profileId, callId, bot ? Number(bot.active_version) : 0, a.fingerprint, a.system_instruction, a.opening_message, a.history_context, JSON.stringify(a.setup_message))
      .run();
  }

  async logTurn(profileId: string, callId: string, direction: string, text: string, metadata: Record<string, unknown> = {}) {
    const cleaned = text.trim();
    if (!cleaned) return;
    await this.db
      .prepare("INSERT INTO conversation_turns (created_at, profile_id, call_id, direction, text, metadata_json) VALUES (?,?,?,?,?,?)")
      .bind(nowIso(), profileId, callId, direction.slice(0, 30), cleaned.slice(0, 20000), JSON.stringify(metadata))
      .run();
  }

  async logLatency(profileId: string, callId: string, eventName: string, sinceStart: number, sincePrevious: number, details: Record<string, unknown> = {}) {
    await this.db
      .prepare("INSERT INTO latency_events (created_at, profile_id, call_id, event_name, since_call_start_ms, since_previous_ms, details_json) VALUES (?,?,?,?,?,?,?)")
      .bind(nowIso(), profileId, callId, eventName.slice(0, 80), Math.round(Math.max(0, sinceStart) * 1000) / 1000, Math.round(Math.max(0, sincePrevious) * 1000) / 1000, JSON.stringify(details))
      .run();
  }

  async recentTraces(profileId: string, limit = 20) {
    const { results: snapshots } = await this.db
      .prepare("SELECT created_at, call_id, bot_version, fingerprint, system_instruction, opening_message, history_context, setup_json FROM prompt_snapshots WHERE profile_id = ? ORDER BY id DESC LIMIT ?")
      .bind(profileId, Math.max(1, Math.min(limit, 50)))
      .all<Record<string, any>>();
    const traces = [];
    for (const s of snapshots) {
      const [turns, latency] = await this.db.batch<Record<string, any>>([
        this.db.prepare("SELECT created_at, direction, text, metadata_json FROM conversation_turns WHERE call_id = ? ORDER BY id").bind(s.call_id),
        this.db.prepare("SELECT created_at, event_name, since_call_start_ms, since_previous_ms, details_json FROM latency_events WHERE call_id = ? ORDER BY id").bind(s.call_id),
      ]);
      traces.push({
        created_at: s.created_at, call_id: s.call_id, bot_version: Number(s.bot_version), fingerprint: s.fingerprint,
        system_instruction: s.system_instruction, opening_message: s.opening_message, history_context: s.history_context,
        setup_message: JSON.parse(s.setup_json),
        turns: turns.results.map((r) => ({ created_at: r.created_at, direction: r.direction, text: r.text, metadata: JSON.parse(r.metadata_json) })),
        latency: latency.results.map((r) => ({ created_at: r.created_at, event_name: r.event_name, since_call_start_ms: r.since_call_start_ms, since_previous_ms: r.since_previous_ms, details: JSON.parse(r.details_json) })),
      });
    }
    return traces;
  }

  async saveSession(v: {
    student_id: string; call_id: string; started_at: Date; learner_turns: number; tutor_turns: number;
    observations: Observation[]; transcript: { role: string; text: string }[] | null; summary: LessonSummary;
    usage: UsageTotals; model: string;
  }) {
    const ended = new Date();
    const duration = Math.max(0, Math.floor((ended.getTime() - v.started_at.getTime()) / 1000));
    await this.db
      .prepare(`INSERT OR IGNORE INTO sessions (student_id, call_id, started_at, ended_at, duration_seconds, learner_turns, tutor_turns, observations_json, transcript_json,
        summary_he, success_he, next_step_he, points, input_text_tokens, input_audio_tokens, output_text_tokens, output_audio_tokens, thoughts_tokens, estimated_cost_usd, cost_basis, model)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        v.student_id, v.call_id, v.started_at.toISOString().replace("Z", "+00:00"), ended.toISOString().replace("Z", "+00:00"), duration,
        v.learner_turns, v.tutor_turns, JSON.stringify(v.observations), v.transcript ? JSON.stringify(v.transcript) : null,
        v.summary.summary_he, v.summary.success_he, v.summary.next_step_he, v.summary.points,
        v.usage.input_text_tokens, v.usage.input_audio_tokens, v.usage.output_text_tokens, v.usage.output_audio_tokens,
        v.usage.thoughts_tokens, v.usage.estimated_cost_usd, v.usage.cost_basis, v.model,
      )
      .run();
    return duration;
  }

  async lessonContext(studentId: string, limit = 5): Promise<string> {
    const [rowsResult, lifetimeResult] = await this.db.batch<Record<string, any>>([
      this.db.prepare("SELECT observations_json, summary_he, next_step_he, points FROM sessions WHERE student_id = ? ORDER BY started_at DESC LIMIT ?").bind(studentId, limit),
      this.db.prepare("SELECT COUNT(*) AS call_count, COALESCE(SUM(points), 0) AS total_points FROM sessions WHERE student_id = ?").bind(studentId),
    ]);
    const rows = rowsResult.results;
    const lifetime = lifetimeResult.results[0] ?? { call_count: 0, total_points: 0 };
    const observations: unknown[] = [];
    const summaries: unknown[] = [];
    const nextSteps: string[] = [];
    for (const row of rows) {
      const step = String(row.next_step_he ?? "").trim();
      if (step && !nextSteps.includes(step)) nextSteps.push(step);
    }
    for (const row of [...rows].reverse()) {
      observations.push(...JSON.parse(row.observations_json));
      if (row.summary_he) summaries.push({ summary_he: row.summary_he, points: row.points });
    }
    const callCount = Number(lifetime.call_count);
    if (!observations.length && !summaries.length && !callCount) return "";
    return (
      "Previous privacy-safe learning notes. Use them to adapt the lesson and begin with the newest relevant next step; do not read this block aloud verbatim:\n" +
      JSON.stringify({
        lifetime_progress: { completed_calls: callCount, total_points: Number(lifetime.total_points) },
        recommended_next_steps: nextSteps.slice(0, 3),
        observations: observations.slice(-12),
        recent_summaries: summaries.slice(-3),
      }) +
      "\nPrioritize the newest recommended next step. Also revisit recurring corrections or skills scored 3 or lower."
    );
  }

  async report(studentId: string, limit = 20) {
    const [rowsResult, lifetimeResult] = await this.db.batch<Record<string, any>>([
      this.db.prepare(`SELECT started_at, duration_seconds, learner_turns, tutor_turns, observations_json, summary_he, success_he, next_step_he, points,
        input_text_tokens, input_audio_tokens, output_text_tokens, output_audio_tokens, thoughts_tokens, estimated_cost_usd, cost_basis, model
        FROM sessions WHERE student_id = ? ORDER BY started_at DESC LIMIT ?`).bind(studentId, limit),
      this.db.prepare(`SELECT COUNT(*) AS session_count, COALESCE(SUM(duration_seconds),0) AS duration_seconds, COALESCE(SUM(points),0) AS total_points,
        COALESCE(SUM(estimated_cost_usd),0) AS estimated_cost_usd FROM sessions WHERE student_id = ?`).bind(studentId),
    ]);
    const lifetime = lifetimeResult.results[0];
    const scores: number[] = [];
    const skills: Record<string, number[]> = {};
    const sessions = rowsResult.results.map((row) => {
      const observations = JSON.parse(row.observations_json) as Observation[];
      for (const o of observations) {
        scores.push(Number(o.score));
        (skills[String(o.skill)] ??= []).push(Number(o.score));
      }
      return {
        started_at: row.started_at, duration_seconds: row.duration_seconds, learner_turns: row.learner_turns, tutor_turns: row.tutor_turns,
        observations, summary_he: row.summary_he, success_he: row.success_he, next_step_he: row.next_step_he, points: row.points,
        estimated_cost_usd: Math.round(row.estimated_cost_usd * 1e6) / 1e6, cost_basis: row.cost_basis, model: row.model,
        usage: {
          input_text_tokens: row.input_text_tokens, input_audio_tokens: row.input_audio_tokens, output_text_tokens: row.output_text_tokens,
          output_audio_tokens: row.output_audio_tokens, thoughts_tokens: row.thoughts_tokens,
        },
      };
    });
    const avg = (v: number[]) => Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100;
    return {
      student_id: studentId,
      session_count: Number(lifetime.session_count),
      displayed_session_count: sessions.length,
      total_minutes: Math.round((Number(lifetime.duration_seconds) / 60) * 10) / 10,
      average_score: scores.length ? avg(scores) : null,
      total_points: Number(lifetime.total_points),
      estimated_cost_usd: Math.round(Number(lifetime.estimated_cost_usd) * 1e6) / 1e6,
      skill_averages: Object.fromEntries(Object.keys(skills).sort().map((k) => [k, avg(skills[k])])),
      sessions,
    };
  }
}
