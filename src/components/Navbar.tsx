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
import { SpeakCallLogo } from './brand/SpeakCallLogo';

interface NavbarProps {
  currentView: 'dashboard' | 'learn' | 'join' | 'legacy';
  onNavigate: (view: 'dashboard' | 'learn' | 'join' | 'legacy') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, onNavigate }) => {
  const { currentCustomer, streak, triggerIntakeCall } = useApp();

  return (
    <header className="h-16 bg-[#111a1a] border-b border-[#35423e]/80 sticky top-0 z-40 px-4 sm:px-6 shadow-md text-[#f0f5ef]">
      <div className="max-w-7xl mx-auto h-full flex items-center justify-between">
        {/* Brand and Logo */}
        <div className="flex items-center gap-6">
          <button
            onClick={() => onNavigate('dashboard')}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <SpeakCallLogo />
          </button>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-1 bg-[#1b2726]/80 p-1 rounded-xl border border-[#35423e]">
            <button
              onClick={() => onNavigate('dashboard')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'dashboard'
                  ? 'bg-[#35423e] text-white shadow-xs border border-[#35423e]'
                  : 'text-[#a9bbb4] hover:text-slate-200 hover:bg-[#35423e]/50'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              מרכז ניהול עסקי
            </button>

            <button
              onClick={() => onNavigate('learn')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'learn'
                  ? 'bg-[#c0f67d] text-[#111a1a] font-bold shadow-xs'
                  : 'text-[#a9bbb4] hover:text-slate-200 hover:bg-[#35423e]/50'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              אימון קולי חיה (Native)
            </button>

            <button
              onClick={() => onNavigate('join')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'join'
                  ? 'bg-[#35423e] text-white shadow-xs border border-[#35423e]'
                  : 'text-[#a9bbb4] hover:text-slate-200 hover:bg-[#35423e]/50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#c0f67d]" />
              הרשמה · פתיחה 10 דק׳ + 2 שיחות של 5 דקות בחודש
            </button>

            <button
              onClick={() => onNavigate('legacy')}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                currentView === 'legacy'
                  ? 'bg-[#35423e] text-slate-200 shadow-xs'
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
            className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-[#1b2726] border border-[#35423e] text-slate-300 rounded-full text-xs font-medium"
            title="רצף אימון יומי"
          >
            <Flame className="w-3.5 h-3.5 text-[#c0f67d] fill-[#c0f67d] animate-pulse" />
            <span>רצף: <strong>{streak.current_streak} ימים</strong></span>
          </div>

          {/* Student Balance */}
          {currentCustomer && (
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-[#1b2726] border border-[#35423e] rounded-full text-xs text-slate-300 font-medium">
              <Clock className="w-3.5 h-3.5 text-[#c0f67d]" />
              <span>יתרת מתנה: <strong className="text-[#c0f67d]">{currentCustomer.balance_minutes ?? 10} דק'</strong></span>
            </div>
          )}

          {/* Telephony Dial in badge */}
          <a
            href="tel:0765673575"
            className="flex items-center gap-2 px-3.5 py-1.5 bg-[#8fd14f] hover:bg-[#c0f67d] text-[#111a1a] font-bold rounded-xl text-xs transition shadow-sm"
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
