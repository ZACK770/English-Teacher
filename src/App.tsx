import React, { useState, useEffect } from 'react';
import { AppProvider } from './store/AppContext';
import { Navbar } from './components/Navbar';
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
import { CrmPage } from './components/dashboard/CrmPage';
import './components/dashboard/dashboard.css';
import './components/portal/portal-polish.css';

type View = 'dashboard' | 'learn' | 'join' | 'legacy' | 'home';
const crmPath = `${legalBasePath(location.pathname)}/dashboard/crm`;
const isCrm = /^\/dashboard(?:\/crm(?:\/|$)|\/?$)/.test(location.pathname.slice(legalBasePath(location.pathname).length));

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

  // Sync hash routing
  useEffect(() => {
    const handleHash = () => {
      if (viewForPath(location.pathname) === 'dashboard') { setCurrentView('dashboard'); return; }
      const fallback = viewForPath(location.pathname);
      const hash = window.location.hash.replace('#', '') || fallback;
      if (hash === 'learn' || hash === 'join' || hash === 'legacy' || hash === 'home') {
        setCurrentView(hash);
      } else if (hash === 'dashboard') {
        setCurrentView('dashboard');
      } else if (
        [
          'overview',
          'analytics',
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
        if (hash === 'customers') {
          window.location.replace(crmPath);
          return;
        }
        setCurrentView('dashboard');
      } else {
        setCurrentView(fallback);
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    window.addEventListener('popstate', handleHash);
    return () => {
      window.removeEventListener('hashchange', handleHash);
      window.removeEventListener('popstate', handleHash);
    };
  }, []);

  const navigateTo = (view: View) => {
    if (isCrm && view !== 'dashboard') {
      const prefix = legalBasePath(location.pathname);
      window.location.href = prefix + (view === 'legacy' ? '/dashboard/legacy' : view === 'home' ? '/' : '/' + view);
      return;
    }
    setCurrentView(view);
    if (view === 'dashboard') {
      window.location.href = crmPath;
    } else {
      window.location.hash = view;
    }
  };

  const content = (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 font-sans flex flex-col antialiased selection:bg-emerald-500 selection:text-white">
      {currentView !== 'dashboard' && currentView !== 'learn' && currentView !== 'home' && <Navbar currentView={currentView} onNavigate={navigateTo} logoHref={currentView === 'join' ? `${legalBasePath(window.location.pathname)}/` : undefined} />}

      <div className="flex-1">
        {currentView === 'dashboard' && (
          <CrmPage />
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
  return currentView === 'dashboard' || currentView === 'legacy' ? <div className={currentView === 'legacy' ? 'pulse-dashboard' : 'unified-crm'}><AdminAuthGate>{content}</AdminAuthGate></div> : content;
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
