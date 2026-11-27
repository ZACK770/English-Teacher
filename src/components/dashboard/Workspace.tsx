import { useEffect, useState, type ReactNode } from 'react';
import { LayoutDashboard, Users, Phone, Wallet, AudioLines, BookOpen, BarChart3, Megaphone, MessageSquare, ListChecks, Search, Menu, ChevronLeft, Activity, SlidersHorizontal } from 'lucide-react';

const groups = [
  { name: 'סביבת עבודה', items: [['today','לטיפול היום',LayoutDashboard],['people','לקוחות',Users],['active-calls','שיחות פעילות',Phone],['messages','הודעות ושירות',MessageSquare],['payments','תשלומים והוראות קבע',Wallet]] },
  { name: 'הוראה וקול', items: [['teachers','תבניות מורה',BookOpen],['voice-lab','מעבדת הקול',AudioLines],['returning','תרגול והתמדה',Activity],['call-reviews','סקירת שיחות',ListChecks]] },
  { name: 'ניהול וצמיחה', items: [['ads','פרסומות ומעקב',Megaphone],['analytics','פעילות בית הספר',BarChart3],['costs','עלויות ותובנות',Wallet],['site','אנליטיקת אתר',SlidersHorizontal]] },
] as const;
export const workspaceTitles = Object.fromEntries(groups.flatMap(group => group.items.map(([key,label]) => [key,label])));

export function Workspace({ base, view, owner, customerName, children }: { base: string; view: string; owner: boolean; customerName?: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(()=>setExpanded(false),[view,customerName]);
  return <div className={'sc-workspace' + (expanded ? ' sc-menu-open' : '')} dir="rtl">
    <aside className="sc-sidebar">
      <a className="sc-brand" href={base}><span className="sc-brand-mark">S</span><span>ספיקול<small>מרכז העבודה</small></span></a>
      <nav aria-label="ניווט ראשי">{groups.map(group => <section key={group.name}>
        <p className="sc-nav-group">{group.name}</p>
        {group.items.filter(([key]) => owner || !['call-reviews','voice-lab'].includes(key)).map(([key,label,Icon]) =>
          <a key={key} href={base + (key === 'today' ? '' : '?view=' + key)} aria-current={view === key ? 'page' : undefined}><Icon size={18}/><span>{label}</span>{view === key && <ChevronLeft size={14}/>}</a>)}
      </section>)}</nav>
      <div className="sc-sidebar-foot">סביבת ניהול ספיקול</div>
    </aside>
    <div className="sc-workspace-body">
      <header className="sc-topbar">
        <button className="sc-menu-button" aria-label="תפריט ניווט" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><Menu size={21}/></button>
        <div className="sc-breadcrumb"><a href={base}>מרכז העבודה</a><ChevronLeft size={13}/><span>{workspaceTitles[view] || 'לקוחות'}</span>{customerName && <><ChevronLeft size={13}/><strong>{customerName}</strong></>}</div>
        <form role="search" className="sc-search" action={base} onSubmit={event=>{ event.preventDefault(); history.pushState(null,'',base+'?'+new URLSearchParams({view:'people',q:query})); window.dispatchEvent(new PopStateEvent('popstate')); }}><Search size={16}/><input name="q" value={query} onChange={event => setQuery(event.target.value)} aria-label="חיפוש לקוח" placeholder="חיפוש שם, טלפון או דוא״ל"/><input name="view" type="hidden" value="people"/></form>
      </header>
      <main className="crm-main sc-content">{children}</main>
    </div>
  </div>;
}
