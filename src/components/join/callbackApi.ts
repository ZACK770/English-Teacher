type CallbackRequest = {
  name: string;
  phone: string;
  for_whom: 'self' | 'daughter' | 'son' | 'other';
  goal: string;
  timing: 'now' | 'scheduled';
  preferred_time: string;
  consent: true;
};

export async function submitCallback(request: CallbackRequest): Promise<void> {
  const prefix = location.pathname === '/english' || location.pathname.startsWith('/english/') ? '/english' : '';
  const response = await fetch(prefix + '/v1/public/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, source: 'pricing_join' }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error('לא הצלחנו לשלוח את הבקשה. נסו שוב.');
}
