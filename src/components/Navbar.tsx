import React from 'react';
import {
  LayoutDashboard,
  GraduationCap,
  Sparkles,
  PhoneCall,
  Flame,
  Clock,
  User,
  ShieldAlert,
} from 'lucide-react';
import { useApp } from '../store/AppContext';

interface NavbarProps {
  currentView: 'dashboard' | 'learn' | 'join' | 'legacy';
  onNavigate: (view: 'dashboard' | 'learn' | 'join' | 'legacy') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, onNavigate }) => {
  const { currentCustomer, streak, triggerIntakeCall } = useApp();

  return (
    <header className="h-16 bg-[#0f172a] border-b border-slate-800/80 sticky top-0 z-40 px-4 sm:px-6 shadow-md text-slate-100">
      <div className="max-w-7xl mx-auto h-full flex items-center justify-between">
        {/* Brand and Logo */}
        <div className="flex items-center gap-6">
          <div
            onClick={() => onNavigate('dashboard')}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-700/80 flex items-center justify-center text-emerald-400 font-extrabold text-lg shadow-sm group-hover:border-emerald-500/50 transition-colors">
              ד
            </div>
            <div>
              <div className="font-extrabold text-slate-100 text-base leading-tight group-hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                <span>לישנא אחרינא</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  LIVE
                </span>
              </div>
              <div className="text-[11px] text-slate-400 font-medium">
                אימון אנגלית קולי בטלפון ובמחשב
              </div>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => onNavigate('dashboard')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'dashboard'
                  ? 'bg-slate-800 text-white shadow-xs border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              מרכז ניהול עסקי
            </button>

            <button
              onClick={() => onNavigate('learn')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'learn'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              אימון קולי חיה (Native)
            </button>

            <button
              onClick={() => onNavigate('join')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'join'
                  ? 'bg-slate-800 text-white shadow-xs border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              דף נחיתה והרשמה (20 דק' מתנה)
            </button>

            <button
              onClick={() => onNavigate('legacy')}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                currentView === 'legacy'
                  ? 'bg-slate-800 text-slate-200 shadow-xs'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <ShieldAlert className="w-3 h-3 text-slate-500" />
              קונסולה ישנה
            </button>
          </nav>
        </div>

        {/* Right Info: Streak, Balance, Phone Hotline */}
        <div className="flex items-center gap-3">
          {/* User Habit / Streak */}
          <div
            className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-slate-800 text-slate-300 rounded-full text-xs font-medium"
            title="רצף אימון יומי"
          >
            <Flame className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400 animate-pulse" />
            <span>רצף: <strong>{streak.current_streak} ימים</strong></span>
          </div>

          {/* Student Balance */}
          {currentCustomer && (
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-slate-900 border border-slate-800 rounded-full text-xs text-slate-300 font-medium">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>יתרת מתנה: <strong className="text-emerald-400">{currentCustomer.balance_minutes || 20} דק'</strong></span>
            </div>
          )}

          {/* Telephony Dial in badge */}
          <a
            href="tel:0765673575"
            className="flex items-center gap-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-xl text-xs transition shadow-sm"
            title="חיוג ישיר למרכזיית טכנוליין שלוחה 99"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">קו טכנוליין:</span>
            <span className="font-mono">076-567-3575 #99</span>
          </a>
        </div>
      </div>
    </header>
  );
};
