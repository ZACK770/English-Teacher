import React, { useState } from 'react';
import {
  LayoutDashboard,
  Mail,
  Table,
  Bot,
  Users,
  GraduationCap,
  CreditCard,
  Volume2,
  Activity,
  PhoneCall,
  Radio,
  Settings,
  ChevronLeft,
  Bell,
  Search,
} from 'lucide-react';
import { OverviewView } from './OverviewView';
import { CampaignsView } from './CampaignsView';
import { EconomicsExcelView } from './EconomicsExcelView';
import { BotsView } from './BotsView';
import { CustomersView } from './CustomersView';
import { CoursesView } from './CoursesView';
import { PackagesView } from './PackagesView';
import { NarrationsView } from './NarrationsView';
import { LogsView } from './LogsView';
import { PbxView } from './PbxView';
import { ConnectionsView } from './ConnectionsView';

interface DashboardLayoutProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ currentTab, onSelectTab }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navItems = [
    { id: 'overview', label: 'סקירה כללית', icon: LayoutDashboard },
    { id: 'campaigns', label: 'קמפיינים ואינטייק', icon: Mail, badge: 'A/B' },
    { id: 'economics', label: 'אקסל רווח ועלויות', icon: Table, badge: 'חדש' },
    { id: 'bots', label: 'מורים ובוטים (שוכי)', icon: Bot },
    { id: 'customers', label: 'לקוחות ו-CRM', icon: Users },
    { id: 'courses', label: 'קורסים ומסלולים', icon: GraduationCap },
    { id: 'packages', label: 'חבילות וסליקה', icon: CreditCard },
    { id: 'narrations', label: 'קריינות IVR', icon: Volume2 },
    { id: 'logs', label: 'ניטור שיחות ו-Logs', icon: Activity, pulse: true },
    { id: 'pbx', label: 'מרכזיית טכנוליין 99', icon: PhoneCall },
    { id: 'connections', label: 'חיבורים ו-API', icon: Radio },
  ];

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-[#0b0f17]">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-slate-900 border-l border-slate-800 flex flex-col transition-all duration-300 shrink-0 shadow-xl z-10`}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          {sidebarOpen ? (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-sm">
                ד
              </div>
              <div>
                <div className="text-xs font-bold text-slate-100">קונסולת ניהול עסקית</div>
                <div className="text-[10px] text-emerald-400 font-mono">076-567-3575 #99</div>
              </div>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-sm mx-auto">
              ד
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition hidden sm:block"
          >
            <ChevronLeft className={`w-4 h-4 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} />
          </button>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`}
                title={!sidebarOpen ? item.label : undefined}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                {sidebarOpen && (
                  <span className="flex-1 text-right truncate flex items-center justify-between">
                    <span>{item.label}</span>
                    {item.badge && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                    {item.pulse && (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer info in sidebar */}
        {sidebarOpen && (
          <div className="p-3 border-t border-slate-800 bg-slate-950/60 m-2 rounded-xl text-[11px] text-slate-400">
            <div className="font-semibold text-slate-200 mb-0.5">גרסת מערכת v3.4.0</div>
            <div className="text-emerald-400 font-mono text-[10px]">טכנוליין 0765673575 #99</div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-6 bg-[#0b0f17]">
        <div className="max-w-7xl mx-auto">
          {currentTab === 'overview' && <OverviewView onNavigate={onSelectTab} />}
          {currentTab === 'campaigns' && <CampaignsView />}
          {currentTab === 'economics' && <EconomicsExcelView />}
          {currentTab === 'bots' && <BotsView />}
          {currentTab === 'customers' && <CustomersView />}
          {currentTab === 'courses' && <CoursesView />}
          {currentTab === 'packages' && <PackagesView />}
          {currentTab === 'narrations' && <NarrationsView />}
          {currentTab === 'logs' && <LogsView />}
          {currentTab === 'pbx' && <PbxView />}
          {currentTab === 'connections' && <ConnectionsView />}
        </div>
      </main>
    </div>
  );
};
