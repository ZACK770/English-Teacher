import React, { useState } from "react";
import { ArrowLeft, Check, Plus, Trash2, Upload } from "lucide-react";
import { LearningProgress } from "./LearningProgress";
import type { Account } from "./portalApi";

type Props = {
  account: Account;
  token: string;
  onSave: (name: string, words: string[]) => Promise<boolean>;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
};

export function VocabularyPage({ account, token, onSave, onActivate, onDelete }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const words = [...new Set(text.split(/[\n,;]+/).map(w => w.trim()).filter(Boolean))];
  const file = async (file?: File) => {
    if (!file) return;
    if (!/\.(txt|csv)$/i.test(file.name) || file.size > 200000) { setError("אפשר קובץ TXT או CSV עד 200KB. לכל רשימה עד מאה מילים או ביטויים."); return; }
    const content = await file.text(); setText(content.replace(/^\uFEFF/, "")); if (!name) setName(file.name.replace(/\.[^.]+$/, "").slice(0, 80)); setError("");
  };
  const chosenTeacher = account.teachers.find(t => t.id === account.preferences.active_teacher);
  const activeId = chosenTeacher?.material_id || account.preferences.material_id || "";
  const form = adding && <form id="sk-personal-vocabulary-form" className="sk-material-form" aria-labelledby="sk-personal-vocabulary-title" onSubmit={e => {
    e.preventDefault();
    if (!words.length || words.length > 100 || words.some(w => w.length > 120)) { setError("עד מאה מילים או ביטויים, עד 120 תווים בכל שורה."); return; }
    void onSave(name.trim(), words).then(saved => { if (saved) { setAdding(false); setText(""); setName(""); setError(""); } });
  }}>
    <h2 id="sk-personal-vocabulary-title">יצירת אוצר מילים משלך</h2>
    <label htmlFor="word-name">שם הרשימה</label><input id="word-name" maxLength={80} required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="למשל: השיחה הבאה בעבודה" />
    <label htmlFor="word-text">אילו מילים נכנסות לשיחה?</label><textarea id="word-text" required dir="auto" maxLength={12500} value={text} onChange={e => setText(e.target.value)} placeholder={"appointment — פגישה\nopportunity — הזדמנות\nLet's give it a try"} rows={6} />
    <div className="sk-material-bottom"><label className="sk-file-button"><Upload size={16} />או קובץ משלך<input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={e => { void file(e.target.files?.[0]); e.target.value = ""; }} /><small>TXT / CSV · עד מאה מילים</small></label><span className="sk-muted">{words.length} / 100</span></div>
    {error && <p className="sk-error" role="alert">{error}</p>}
    <button className="sk-primary" disabled={!name.trim() || !words.length}>שומרים לשיחה הבאה<ArrowLeft size={16} /></button>
  </form>;
  return <LearningProgress token={token} account={account} personalForm={form} personalOptions={(openDomain, hasDomain) => <>
    <button type="button" className="sk-domain-card sk-vocab-create" aria-expanded={adding} aria-controls={adding ? "sk-personal-vocabulary-form" : undefined} onClick={() => setAdding(value => !value)}>
      <strong><Plus size={19} />יצירת אוצר מילים משלך</strong><small>אפשר להקליד מילים וביטויים או להעלות רשימה בקובץ.</small><span className="sk-domain-open">{adding ? "סגירת הטופס" : "לרשימה חדשה"} ←</span>
    </button>
    {account.materials.map(m => <article key={m.id} className="sk-domain-card sk-vocab-personal">
      <div className="sk-card-top"><strong dir="auto">{m.name}</strong><button type="button" className="sk-icon" aria-label={"מחיקת " + m.name} onClick={() => { if (confirm("למחוק את הרשימה " + m.name + "?")) onDelete(m.id); }}><Trash2 size={16} /></button></div>
      <small>רשימה אישית · {m.words.length} מילים וביטויים</small>
      {m.target_count === 0 && <small>לשיחה בלבד, ללא ציוני מילים.</small>}
      <div className="sk-tags">{m.words.slice(0, 5).map(w => <span className="sk-tag" dir="auto" key={w}>{w}</span>)}{m.words.length > 5 && <span className="sk-tag">ועוד {m.words.length - 5}</span>}</div>
      <div className="sk-vocab-actions">
        {hasDomain("material:" + m.id) && <button type="button" className="sk-link" aria-haspopup="dialog" onClick={e => openDomain("material:" + m.id, e.currentTarget)}>למילים ולתרגול</button>}
        <button type="button" aria-pressed={activeId === m.id} className={activeId === m.id ? "sk-quiet-link sk-accent" : "sk-link"} onClick={() => onActivate(activeId === m.id ? "" : m.id)}>{activeId === m.id ? <><Check size={15} />ברשימת השיחה הבאה</> : <>לקחת לשיחה הבאה<ArrowLeft size={14} /></>}</button>
      </div>
    </article>)}
  </>} />;
}
