import React from 'react';
import { initAnalytics } from './analytics';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

if (!/^\/(english\/)?dashboard\/crm(\/|$)/.test(location.pathname)) initAnalytics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
