import React, { useState, useEffect } from 'react';
import { AppProvider } from './store/AppContext';
import { Navbar } from './components/Navbar';
import { DashboardLayout } from './components/dashboard/DashboardLayout';
import { LearnerPortal } from './components/portal/LearnerPortal';
import { JoinLanding } from './components/join/JoinLanding';
import { SpeakoolLanding } from './components/portal/SpeakoolLanding';
import { LegacyConsole } from './components/legacy/LegacyConsole';
import { LegalPage } from './components/legal/LegalPage';
import { LegalFooter } from './components/legal/LegalFooter';
import { legalPageForPath } from './legalRoutes';
import { AdminAuthGate } from './components/dashboard/AdminAuthGate';

export const AppContent: React.FC = () => {
  const [currentView, setCurrentView] = useState<'dashboard' | 'learn' | 'join' | 'legacy' | 'home'>(() => !location.hash && !/\/(learn|join|dashboard)/.test(location.pathname) ? 'home' : 'learn');
  const [dashboardTab, setDashboardTab] = useState('overview');

  // Sync hash routing
  useEffect(() => {
    const handleHash = () => {
      const path = window.location.pathname.replace(/^\/english/, '');
      const fallback = path.startsWith('/dashboard/legacy') ? 'legacy' : path.startsWith('/dashboard') ? 'dashboard' : path.startsWith('/join') ? 'join' : path.startsWith('/learn') ? 'learn' : 'home';
      const hash = window.location.hash.replace('#', '') || fallback;
      if (['learn', 'join', 'legacy', 'home'].includes(hash)) {
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

  const navigateTo = (view: 'dashboard' | 'learn' | 'join' | 'legacy' | 'home') => {
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

  const content = (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 font-sans flex flex-col antialiased selection:bg-emerald-500 selection:text-white">
      {currentView !== 'learn' && currentView !== 'home' && <Navbar currentView={currentView} onNavigate={navigateTo} />}

      <div className="flex-1">
        {currentView === 'dashboard' && (
          <DashboardLayout currentTab={dashboardTab} onSelectTab={handleSelectDashboardTab} />
        )}
        {currentView === 'learn' && (
          <>
            <LearnerPortal />
            <LegalFooter />
          </>
        )}
        {currentView === 'join' && <JoinLanding />}
        {currentView === 'home' && <SpeakoolLanding />}
        {currentView === 'legacy' && <LegacyConsole />}
      </div>
    </div>
  );
  return currentView === 'dashboard' || currentView === 'legacy' ? <AdminAuthGate>{content}</AdminAuthGate> : content;
};

export const App: React.FC = () => {
  const legalPage = legalPageForPath(window.location.pathname);
  if (legalPage) {
    return <LegalPage page={legalPage} />;
  }
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
};

export default App;
