type Touch = Partial<Record<'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term' | 'gclid' | 'fbclid' | 'campaign', string>> & { ts: string; referrer: string; landing_path: string };
type Attribution = { visitor_id: string; session_id: string; path: string; referrer: string; first_touch: Touch; last_touch: Touch };
type AnalyticsEvent = 'page_view' | 'phone_click' | 'generate_lead' | 'sign_up' | 'begin_checkout' | 'purchase';
type Params = { reference?: string; value?: number; currency?: 'ILS'; method?: 'phone' | 'email' };
const prefix = () => location.pathname === '/english' || location.pathname.startsWith('/english/') ? '/english' : '';
const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'campaign'] as const;
const memory = new Map<string, string>();
function read(key: string, tab = false) { try { return (tab ? sessionStorage : localStorage).getItem(key) || memory.get(key); } catch { return memory.get(key); } }
function write(key: string, value: string, tab = false) { memory.set(key, value); try { (tab ? sessionStorage : localStorage).setItem(key, value); } catch { /* Storage can be disabled. */ } }
function id(key: string, tab = false) { let value = read(key, tab); if (!value) { value = crypto.randomUUID(); write(key, value, tab); } return value; }
function referrer() { try { const url = new URL(document.referrer); return (url.origin + url.pathname).slice(0, 500); } catch { return ''; } }
function touch(): Touch {
  const params = new URLSearchParams(location.search);
  return { ...Object.fromEntries(keys.filter(k => params.has(k)).map(k => [k, params.get(k)!.slice(0, 200)])),
    ts: new Date().toISOString(), referrer: referrer(), landing_path: location.pathname.slice(0, 500) };
}
let first: Touch, last: Touch;
function capture() {
  const current = touch();
  try { first = JSON.parse(read('analytics:first') || 'null'); } catch { /* Ignore corrupt storage. */ }
  if (!first?.ts || !Number.isFinite(Date.parse(first.ts)) || Date.now() - Date.parse(first.ts) > 90 * 86400000) {
    first = current; write('analytics:first', JSON.stringify(first));
  }
  last = current; write('analytics:last', JSON.stringify(last));
}
export function attribution(): Attribution | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    if (!first) capture();
    return { visitor_id: id('analytics:visitor'), session_id: id('analytics:session', true),
      path: location.pathname.slice(0, 500), referrer: referrer(), first_touch: first, last_touch: last };
  } catch { return undefined; }
}
type Gtag = (...args: unknown[]) => void;
let ga: Gtag | undefined;
const queue: { name: AnalyticsEvent; params: Record<string, unknown> }[] = [];
export function track(name: AnalyticsEvent, params: Params = {}, once?: string) {
  try {
    if (once && read('analytics:sent:' + name + ':' + once, true)) return;
    if (once) write('analytics:sent:' + name + ':' + once, '1', true);
    const a = attribution();
    if (!a) return;
    const body = JSON.stringify({ event: name, event_id: crypto.randomUUID(), attribution: a,
      reference: params.reference, value: params.value, currency: params.currency,
      meta: params.method ? { method: params.method } : {} });
    const endpoint = prefix() + '/v1/public/events';
    if (!navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'application/json' }))) {
      void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
    const gaParams = { ...a.last_touch, ...params, transaction_id: name === 'purchase' ? params.reference : undefined,
      first_utm_source: a.first_touch.utm_source, first_utm_campaign: a.first_touch.utm_campaign,
      campaign_source: a.last_touch.utm_source, campaign_medium: a.last_touch.utm_medium,
      campaign_name: a.last_touch.utm_campaign || a.last_touch.campaign,
      campaign_content: a.last_touch.utm_content, campaign_term: a.last_touch.utm_term,
      page_location: location.origin + location.pathname, page_referrer: a.referrer };
    if (ga) ga('event', name, gaParams);
    else if (queue.length < 100) queue.push({ name, params: gaParams });
  } catch { /* Analytics must not interrupt the lesson or payment. */ }
}
let previous = '';
export function trackPage() {
  const route = location.pathname + location.search + location.hash;
  if (route === previous) return;
  previous = route;
  if (keys.some(k => new URLSearchParams(location.search).has(k))) { last = touch(); write('analytics:last', JSON.stringify(last)); }
  track('page_view');
}
export function initAnalytics() {
  try {
    capture(); trackPage();
    window.addEventListener('hashchange', trackPage);
    window.addEventListener('popstate', trackPage);
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = (data: unknown, unused: string, url?: string | URL | null) => { original(data, unused, url); trackPage(); };
    }
    document.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('a[href^="tel:"]')) track('phone_click');
    });
    void fetch(prefix() + '/v1/public/analytics-config').then(r => r.json()).then(config => {
      if (/^[a-f0-9]{32}$/.test(config.cf_beacon_token) && !document.querySelector('script[src*="static.cloudflareinsights.com/beacon.min.js"]')) {
        const script = document.createElement('script'); script.defer = true;
        script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
        script.dataset.cfBeacon = JSON.stringify({ token: config.cf_beacon_token }); document.head.append(script);
      }
      if (!/^G-[A-Z0-9]+$/.test(config.ga_measurement_id)) return;
      const global = window as typeof window & { dataLayer?: unknown[]; gtag?: Gtag };
      global.dataLayer = global.dataLayer || [];
      global.gtag = function () { global.dataLayer!.push(arguments); };
      ga = global.gtag; ga('js', new Date()); ga('config', config.ga_measurement_id, { send_page_view: false });
      const script = document.createElement('script'); script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(config.ga_measurement_id); document.head.append(script);
      queue.splice(0).forEach(e => ga!('event', e.name, e.params));
    }).catch(() => {});
  } catch { /* Analytics is optional. */ }
}
