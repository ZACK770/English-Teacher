export const LegalFooter = () => (
  <footer dir="rtl" className="border-t border-slate-800 px-6 py-6 text-sm text-slate-400">
    <nav aria-label="מידע משפטי" className="flex flex-wrap justify-center gap-x-6 gap-y-3">
      <a className="underline hover:text-emerald-400 focus-visible:outline-2 focus-visible:outline-emerald-400" href="/terms">תקנון ותנאי שימוש</a>
      <a className="underline hover:text-emerald-400 focus-visible:outline-2 focus-visible:outline-emerald-400" href="/privacy">מדיניות פרטיות</a>
      <a className="underline hover:text-emerald-400 focus-visible:outline-2 focus-visible:outline-emerald-400" href="/accessibility">הצהרת נגישות</a>
    </nav>
  </footer>
);
