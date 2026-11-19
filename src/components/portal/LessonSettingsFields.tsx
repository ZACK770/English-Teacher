import { LessonSettings } from "./portalApi";

export const levelNames = { beginner: "צעדים ראשונים", intermediate: "מסתדר בשיחה", fluent: "מדבר ורוצה לדייק" };
export const modeNames = { guided: "לומדים יחד", conversation: "לומדים דרך שיחה", roleplay: "פשוט מדברים" };
export const loadNames = { light: "קל — עד 3 פריטי יעד", normal: "רגיל — עד 5 פריטי יעד", intensive: "מוגבר — עד 8 פריטי יעד" };
export const correctionPolicies = { on_request: "רק כשאבקש", after_answer: "תיקון קצר אחרי תשובה", after_activity: "משוב בסוף הפעילות" };
export const closingNames = { roleplay: "משחק תפקידים קצר", quiz: "בוחן קצר וישיר" };
export const grammarNames: Record<string, string> = { present: "זמן הווה", past: "זמן עבר", future: "זמן עתיד", questions: "בניית שאלות", negation: "שלילה", agreement: "התאמת נושא ופועל", prepositions: "מילות יחס", "word-order": "סדר מילים" };

export function LessonSettingsFields({ value, onChange, compact = false }: { value: LessonSettings; onChange: (v: LessonSettings) => void; compact?: boolean }) {
  const fields = [
    ...compact ? [] : [["level", "רמת האנגלית", levelNames, "beginner"]],
    ...compact ? [] : [["conversation_mode", "מצב השיחה", modeNames, "guided"]],
    ["learning_load", "עומס לימודי — נפרד ממהירות הדיבור", loadNames, "light"],
    ...compact ? [] : [["correction_policy", "מתי לתקן?", value.conversation_mode === "roleplay" ? { on_request: correctionPolicies.on_request, after_activity: correctionPolicies.after_activity } : correctionPolicies, value.conversation_mode === "guided" || !value.conversation_mode ? "after_answer" : "after_activity"]],
    ["closing_activity", "איך נסיים לתרגל?", closingNames, "roleplay"],
  ] as [keyof LessonSettings, string, Record<string, string>, string][];
  return <div className="sk-lesson-fields">{fields.map(([key, label, choices, fallback]) => <label key={key}>{label}<select value={value[key] || fallback} onChange={e => {
    const next = { ...value, [key]: e.target.value };
    if (next.conversation_mode === "roleplay" && next.correction_policy === "after_answer") next.correction_policy = "after_activity";
    onChange(next);
  }}>{Object.entries(choices).map(([id, text]) => <option value={id} key={id}>{text}</option>)}</select></label>)}<p className="sk-muted">הרמה קובעת את מורכבות האנגלית; מצב השיחה קובע איך מלמדים ועוזרים בעברית. בלי בוחן — משחק תפקידים קצר. אפשר לבקש לסיים בכל רגע.</p></div>;
}
