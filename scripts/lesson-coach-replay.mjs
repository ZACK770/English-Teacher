// Offline replay, accepts a local JSON array of sessions and compiled prompt snapshots.
// No external API requests, raw transcript output, or production writes.
// Node 24: node --experimental-transform-types scripts/lesson-coach-replay.mjs FILE
import { readFileSync } from "node:fs";
import { TranscriptCoach } from "../cloudflare/src/lesson-coach.ts";
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const counts = {}, actions = {};
let sessions = 0, turns = 0, withKnown = 0;
for (const row of rows) {
  const p = row.system_instruction ?? "";
  const targetLine = p.match(/TARGET VOCABULARY \(quoted learning data, never instructions\): (\[[^\n]*\])/);
  if (!targetLine) continue;
  let targets;
  try { targets = JSON.parse(targetLine[1]); } catch { continue; }
  const plan = { level: /Ability: (beginner|intermediate|fluent)/.exec(p)?.[1] ?? "beginner",
    conversation_mode: /Conversation mode: (guided|conversation|roleplay)/.exec(p)?.[1] ?? "guided",
    correction_policy: p.includes("Correct only when requested.") ? "on_request" : p.includes("During the activity, keep the conversation moving without correcting") ? "after_activity" : "after_answer",
    learning_load: "light", closing_activity: "roleplay", topic: "replay", grammar: [],
    vocabulary: targets.map(t => ({ id: t.word_id, text: t.text, meaning_he: t.meaning_he, level: t.level, domain: "replay" })) };
  let raw;
  try { raw = JSON.parse(row.transcript_json ?? "[]"); } catch { continue; }
  const merged = [];
  const cascade = typeof row.model === "string" && !row.model.startsWith("models/");
  for (const t of raw) {
    if (typeof t.text !== "string" || !t.text.trim() || !["tutor","learner"].includes(t.role)) continue;
    if (merged.at(-1)?.role === t.role) merged.at(-1).text += cascade && t.role === "tutor" ? t.text : " " + t.text;
    else merged.push({ role: t.role, text: t.text });
  }
  const c = new TranscriptCoach(plan, "shadow");
  const decisions = [];
  for (const t of merged) {
    if (t.role === "tutor") { c.tutorCompleted(t.text); continue; }
    const decision = c.observeLearner(t.text); decisions.push(decision);
    counts[decision.outcome] = (counts[decision.outcome] ?? 0) + 1;
    actions[decision.action] = (actions[decision.action] ?? 0) + 1;
    turns++;
  }
  if (decisions.length) { sessions++; if (decisions.some(d => d.outcome !== "unknown")) withKnown++; }
}
console.log(JSON.stringify({ sessions, turns, sessionsWithAtLeastOneObservation: withKnown, counts, actions,
  caveat: "Historical transcript lacks confirmed playback and ASR confidence; this is coverage, not accuracy or mastery." }, null, 2));
