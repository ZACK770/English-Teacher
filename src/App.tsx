import React, { useState, useEffect } from 'react';
import { AppProvider } from './store/AppContext';
import { Navbar } from './components/Navbar';
import { DashboardLayout } from './components/dashboard/DashboardLayout';
import { LearnerPortal } from './components/portal/LearnerPortal';
import { JoinLanding } from './components/join/JoinLanding';
import { SpeakoolLanding } from './components/portal/SpeakoolLanding';
import { LegacyConsole } from './components/legacy/LegacyConsole';
import { LegalPage } from './components/legal/LegalPage';
import { BlogPage } from './blog/BlogPage';
import { isBlogPath } from './blog/routes';
import { LegalFooter } from './components/legal/LegalFooter';
import { legalBasePath, legalPageForPath } from './legalRoutes';
import { AdminAuthGate } from './components/dashboard/AdminAuthGate';
import './components/dashboard/dashboard.css';
import './components/portal/portal-polish.css';

type View = 'dashboard' | 'learn' | 'join' | 'legacy' | 'home';

function viewForPath(pathname: string): View {
  const path = pathname.slice(legalBasePath(pathname).length);
  if (path.startsWith('/dashboard/legacy')) return 'legacy';
  if (path.startsWith('/dashboard')) return 'dashboard';
  if (path.startsWith('/join')) return 'join';
  if (path.startsWith('/learn')) return 'learn';
  return 'home';
}

export const AppContent: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>(() => viewForPath(location.pathname));
  const [dashboardTab, setDashboardTab] = useState('overview');

  // Sync hash routing
  useEffect(() => {
    const handleHash = () => {
      const fallback = viewForPath(location.pathname);
      const hash = window.location.hash.replace('#', '') || fallback;
      if (hash === 'learn' || hash === 'join' || hash === 'legacy' || hash === 'home') {
        setCurrentView(hash);
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
      } else {
        setCurrentView(fallback);
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigateTo = (view: View) => {
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
      {currentView !== 'learn' && currentView !== 'home' && <Navbar currentView={currentView} onNavigate={navigateTo} logoHref={currentView === 'join' ? `${legalBasePath(window.location.pathname)}/` : undefined} />}

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
  return currentView === 'dashboard' || currentView === 'legacy' ? <div className="pulse-dashboard"><AdminAuthGate>{content}</AdminAuthGate></div> : content;
};

export const App: React.FC = () => {
  if (isBlogPath(window.location.pathname)) return <BlogPage />;
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
