import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let local, session, listeners, scripts, config;
const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) });
async function load(url = 'https://speakool.net/?utm_source=capsule&utm_medium=email&utm_campaign=capsule1') {
  vi.resetModules();
  vi.stubGlobal('location', new URL(url));
  return import('../../src/analytics');
}
beforeEach(() => {
  local = new Map(); session = new Map(); listeners = {}; scripts = [];
  config = { ga_measurement_id: '', cf_beacon_token: '' };
  vi.stubGlobal('localStorage', storage(local)); vi.stubGlobal('sessionStorage', storage(session));
  vi.stubGlobal('window', { addEventListener: (name, fn) => { listeners[name] = fn; } });
  vi.stubGlobal('history', { pushState() {}, replaceState() {} });
  vi.stubGlobal('document', { referrer: 'https://mail.example/newsletter?email=private', addEventListener: (name, fn) => { listeners[name] = fn; },
    querySelector: () => null, createElement: () => ({ dataset: {} }), head: { append: script => scripts.push(script) } });
  vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(config)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('browser attribution and runtime tracking', () => {
  it.each(['https://speakool.net/learn?plan=school-foundations', 'https://speakool.net/'])('sends stored last touch on an internal or direct load (%s)', async url => {
    const original = (await load()).attribution().last_touch;
    document.referrer = url.includes('/learn') ? 'https://speakool.net/' : '';
    const analytics = await load(url);
    analytics.initAnalytics();
    expect(analytics.attribution().last_touch).toEqual(original);
    expect(JSON.parse(local.get('analytics:last'))).toEqual(original);
    const body = JSON.parse(await navigator.sendBeacon.mock.calls[0][1].text());
    expect(body.attribution.last_touch).toEqual(original);
  });
  it('replaces last touch for external referrals and recovers corrupt last-touch storage', async () => {
    const original = (await load()).attribution();
    document.referrer = 'https://search.example/results?q=private';
    const next = (await load('https://speakool.net/learn')).attribution();
    expect(next.first_touch).toEqual(original.first_touch);
    expect(next.last_touch).toMatchObject({ referrer: 'https://search.example/results', landing_path: '/learn' });
    expect(next.last_touch.utm_campaign).toBeUndefined();
    local.set('analytics:last', '{');
    document.referrer = '';
    expect((await load('https://speakool.net/')).attribution().last_touch.landing_path).toBe('/');
  });
  it('preserves first touch for 90 days and updates last touch on the next visit', async () => {
    const first = (await load()).attribution();
    const next = (await load('https://speakool.net/learn?utm_source=capsule&utm_campaign=reminder')).attribution();
    expect(first.first_touch).toMatchObject({ utm_source: 'capsule', utm_medium: 'email', utm_campaign: 'capsule1', landing_path: '/', referrer: 'https://mail.example/newsletter' });
    expect(next.first_touch).toEqual(first.first_touch);
    expect(next.last_touch.utm_campaign).toBe('reminder');
    expect(next.visitor_id).toBe(first.visitor_id); expect(next.session_id).toBe(first.session_id);
    local.set('analytics:first', JSON.stringify({ ...first.first_touch, ts: '2000-01-01T00:00:00.000Z' }));
    const expired = (await load('https://speakool.net/?campaign=new')).attribution();
    expect(expired.first_touch.campaign).toBe('new');
  });
  it('handles direct visits, corrupt/blocked storage and a separate tab session', async () => {
    local.set('analytics:first', '{');
    const a = (await load('https://speakool.net/')).attribution();
    expect(a.first_touch.utm_source).toBeUndefined();
    session.clear();
    const b = (await load()).attribution();
    expect(b.visitor_id).toBe(a.visitor_id); expect(b.session_id).not.toBe(a.session_id);
    vi.stubGlobal('localStorage', { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
    expect((await load()).attribution()).toMatchObject({ path: '/' });
  });
  it('tracks SPA page changes and falls back to keepalive without interrupting UX', async () => {
    const analytics = await load(); analytics.initAnalytics();
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
    analytics.trackPage(); expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
    location.hash = '#learn'; listeners.hashchange();
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(2);
    const body = JSON.parse(await navigator.sendBeacon.mock.calls[0][1].text());
    expect(body).toMatchObject({ event: 'page_view', attribution: { first_touch: { utm_campaign: 'capsule1' } } });
    navigator.sendBeacon.mockReturnValue(false);
    fetch.mockRejectedValue(Error('offline'));
    expect(() => analytics.track('phone_click')).not.toThrow();
    expect(fetch).toHaveBeenLastCalledWith('/v1/public/events', expect.objectContaining({ keepalive: true }));
    await Promise.resolve();
  });
  it('loads no GA script for an empty ID and installs configured Cloudflare beacon', async () => {
    config.cf_beacon_token = 'a'.repeat(32);
    const analytics = await load(); analytics.initAnalytics();
    await vi.waitFor(() => expect(scripts).toHaveLength(1));
    expect(scripts[0]).toMatchObject({ src: 'https://static.cloudflareinsights.com/beacon.min.js', defer: true, dataset: { cfBeacon: JSON.stringify({ token: 'a'.repeat(32) }) } });
    expect(window.gtag).toBeUndefined();
  });
  it('queues and mirrors GA4 conversions with campaign, ILS and transaction id and deduplicates purchases', async () => {
    config.ga_measurement_id = 'G-TEST123';
    const analytics = await load(); analytics.initAnalytics();
    analytics.track('generate_lead', { reference: 'lead1' }, 'lead1');
    await vi.waitFor(() => expect(scripts.some(s => s.src.includes('gtag/js?id=G-TEST123'))).toBe(true));
    analytics.track('purchase', { reference: 'order1', value: 59, currency: 'ILS' }, 'order1');
    analytics.track('purchase', { reference: 'order1', value: 59, currency: 'ILS' }, 'order1');
    const events = window.dataLayer.map(args => Array.from(args));
    expect(events).toContainEqual(['config', 'G-TEST123', { send_page_view: false }]);
    expect(events.filter(e => e[1] === 'purchase')).toEqual([['event', 'purchase', expect.objectContaining({ transaction_id: 'order1', value: 59, currency: 'ILS', campaign_name: 'capsule1', campaign_source: 'capsule' })]]);
    expect(events.some(e => e[1] === 'generate_lead')).toBe(true);
  });
});
