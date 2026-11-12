import React, { useState, useEffect } from 'react';
import { AppProvider } from './store/AppContext';
import { Navbar } from './components/Navbar';
import { DashboardLayout } from './components/dashboard/DashboardLayout';
import { LearnerPortal } from './components/portal/LearnerPortal';
import { JoinLanding } from './components/join/JoinLanding';
import { LegacyConsole } from './components/legacy/LegacyConsole';
import { NavigationConsole } from './components/NavigationConsole';
import { CustomerApp } from './components/navigation/CustomerApp';
import { Signup } from './components/navigation/Signup';

export const AppContent: React.FC = () => {
  const [currentView, setCurrentView] = useState<'dashboard' | 'learn' | 'join' | 'legacy'>('learn');
  const [dashboardTab, setDashboardTab] = useState('overview');

  // Sync hash routing
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '') || 'learn';
      if (['learn', 'join', 'legacy'].includes(hash)) {
        setCurrentView(hash as any);
      } else if (hash === 'dashboard') {
        setCurrentView('dashboard');
        setDashboardTab('overview');
      } else if (
        [
          'overview',
          'campaigns',
          'economics',
          'bots',
          'customers',
          'courses',
          'packages',
          'narrations',
          'logs',
          'pbx',
          'connections',
        ].includes(hash)
      ) {
        setCurrentView('dashboard');
        setDashboardTab(hash);
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigateTo = (view: 'dashboard' | 'learn' | 'join' | 'legacy') => {
    setCurrentView(view);
    if (view === 'dashboard') {
      window.location.hash = dashboardTab;
    } else {
      window.location.hash = view;
    }
  };

  const handleSelectDashboardTab = (tab: string) => {
    setDashboardTab(tab);
    window.location.hash = tab;
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 font-sans flex flex-col antialiased selection:bg-emerald-500 selection:text-white">
      <Navbar currentView={currentView} onNavigate={navigateTo} />

      <div className="flex-1">
        {currentView === 'dashboard' && (
          <DashboardLayout currentTab={dashboardTab} onSelectTab={handleSelectDashboardTab} />
        )}
        {currentView === 'learn' && (
          <div className="p-4 sm:p-8 max-w-7xl mx-auto">
            <LearnerPortal />
          </div>
        )}
        {currentView === 'join' && <JoinLanding />}
        {currentView === 'legacy' && <LegacyConsole />}
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  if (/\/(?:english\/)?navigation\/?$/.test(window.location.pathname)) return <NavigationConsole />;
  if (/\/(?:english\/)?app\/?$/.test(window.location.pathname)) return <CustomerApp />;
  if (/\/(?:english\/)?join-navigation\/?$/.test(window.location.pathname)) return <Signup />;
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
};

export default App;
