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
    <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-40 px-4 sm:px-6 shadow-xs">
      <div className="max-w-7xl mx-auto h-full flex items-center justify-between">
        {/* Brand and Logo */}
        <div className="flex items-center gap-6">
          <div
            onClick={() => onNavigate('dashboard')}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-700 to-purple-600 flex items-center justify-center text-white font-extrabold text-lg shadow-md group-hover:scale-105 transition-transform">
              ד
            </div>
            <div>
              <div className="font-extrabold text-slate-900 text-base leading-tight group-hover:text-indigo-600 transition-colors">
                דיבורא <span className="text-xs font-normal text-slate-400 font-mono">· לישנא אחרינא</span>
              </div>
              <div className="text-[11px] text-slate-500 font-medium">
                בית ספר ללימוד אנגלית בטלפון ובאינטרנט
              </div>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl">
            <button
              onClick={() => onNavigate('dashboard')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'dashboard'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              מרכז ניהול עסקי
            </button>

            <button
              onClick={() => onNavigate('learn')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'learn'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              פורטל התלמיד (משחקונים וחומר)
            </button>

            <button
              onClick={() => onNavigate('join')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'join'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              דף נחיתה (שוכי · חבילת מתנה)
            </button>

            <button
              onClick={() => onNavigate('legacy')}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                currentView === 'legacy'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldAlert className="w-3 h-3 text-amber-500" />
              קונסולת מורה ישנה
            </button>
          </nav>
        </div>

        {/* Right Info: Streak, Balance, Phone Hotline */}
        <div className="flex items-center gap-3">
          {/* User Habit / Streak */}
          <div
            className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200 text-amber-800 rounded-full text-xs font-bold"
            title="רצף למידה יומי - מנגנון יצירת השתוקקות"
          >
            <Flame className="w-4 h-4 text-amber-500 fill-amber-500 animate-pulse" />
            <span>{streak.current_streak} ימי רצף 🔥</span>
          </div>

          {/* Student Balance */}
          {currentCustomer && (
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-100 rounded-full text-xs text-indigo-900 font-medium">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              <span>יתרה: <strong>{currentCustomer.balance_minutes} דק'</strong></span>
            </div>
          )}

          {/* Telephony Dial in badge */}
          <a
            href="tel:0795000880"
            className="flex items-center gap-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
            title="חיוג ישיר למרכזייה שלוחה 99"
          >
            <PhoneCall className="w-3.5 h-3.5 animate-bounce" />
            <span className="hidden sm:inline">חיוג למורה:</span>
            <span className="font-mono">079-5000-880</span>
          </a>
        </div>
      </div>
    </header>
  );
};
