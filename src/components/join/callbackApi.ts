type CallbackRequest = {
  name: string;
  phone: string;
  for_whom: 'self' | 'daughter' | 'son' | 'other';
  goal: string;
  timing: 'now' | 'scheduled';
  preferred_time: string;
  preferred_at?: string;
  consent: true;
};

async function postCallback(request: CallbackRequest, source: 'pricing_join' | 'home_landing') {
  const prefix = location.pathname === '/english' || location.pathname.startsWith('/english/') ? '/english' : '';
  const response = await fetch(prefix + '/v1/public/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, source, website: '' }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error('לא הצלחנו לשלוח את הבקשה. נסו שוב.');
  return {
    duplicate: result.duplicate === true,
    status: result.status === 'dialing' || result.status === 'dialed' ? 'dialed' as const : 'queued' as const,
    reason: result.reason === 'shabbat' ? 'shabbat' as const : undefined,
  };
}

export async function submitCallback(request: CallbackRequest): Promise<void> {
  await postCallback(request, 'pricing_join');
}

export function submitLessonCallback(phone: string) {
  return postCallback({
    name: 'שיעור היכרות',
    phone,
    for_whom: 'self',
    goal: '',
    timing: 'now',
    preferred_time: '',
    consent: true,
  }, 'home_landing');
}
