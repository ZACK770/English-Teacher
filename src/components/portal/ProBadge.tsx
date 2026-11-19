import { createContext, useContext, useState, type ReactNode } from "react";
import { isProDomain, isProLevel, isProSelection } from "../../../cloudflare/src/pro-access";
import { apiPrefix } from "./portalApi";
import "./pro-badge.css";

const ProAccess = createContext({ paid: false, selectPro: () => {} });
export const useProAccess = () => useContext(ProAccess);

export function ProBadge() {
  return <span className="sk-pro-badge" role="img" aria-label="פרו" dir="ltr"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m3 6 4 3 3-5 3 5 4-3-2 9H5L3 6Z" /><path d="M6 18h8" /></svg><span aria-hidden="true">PRO</span></span>;
}

export function ProNote() {
  return <p className="sk-pro-note" role="status">זמין במנוי פרו · <a href={apiPrefix + "/learn?plan=school-pace"}>למסלולים ולמנוי</a><small>בחינם נתרגל יומיום ונדל״ן ברמת מתחילים ובינוניים.</small></p>;
}

export function ProAccessProvider({ paid, children }: { paid: boolean; children: ReactNode }) {
  const [selected, setSelected] = useState(false);
  return <ProAccess.Provider value={{ paid, selectPro: () => { if (!paid) setSelected(true); } }}>{children}{selected && !paid && <aside className="sk-pro-notification" dir="rtl"><ProNote /><button type="button" onClick={() => setSelected(false)} aria-label="סגירת הודעת פרו">×</button></aside>}</ProAccess.Provider>;
}

export function SelectionBadge({ domain = "recommended", level = "beginner" }: { domain?: string; level?: string }) {
  return isProSelection(domain, level) ? <ProBadge /> : null;
}

export function ProChoices({ values, value, onChange, kind, label, isProOption }: { values: Record<string, string>; value?: string; onChange: (value: string) => void; kind: "domain" | "level"; label: string; isProOption?: (id: string) => boolean }) {
  const { selectPro } = useProAccess();
  const pro = (id: string) => !!id && (isProOption ? isProOption(id) : kind === "domain" ? isProDomain(id) : isProLevel(id));
  return <div className="sk-pro-choices" role="group" aria-label={label}>{Object.entries(values).map(([id, text]) => <button type="button" key={id} aria-pressed={value === id} className={"sk-choice " + (value === id ? "is-selected" : "")} onClick={() => { if (pro(id)) selectPro(); onChange(id); }}><span>{text}</span>{pro(id) && <ProBadge />}</button>)}</div>;
}
