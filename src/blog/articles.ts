export type BlogBlock = { type: 'p' | 'h2' | 'quote'; text: string } | { type: 'list'; items: string[] };
export type BlogSource = { label: string; url: string };
export type BlogArticle = { slug: string; title: string; description: string; date: string; readMinutes: number; kicker: string; body: BlogBlock[]; sources: BlogSource[] };

export const blogArticles: BlogArticle[] = [
  {
    slug: 'practice-example', title: 'איך הופכים ידע לשיחה? · מאמר לדוגמה',
    description: 'תוכן זמני להמחשת הבלוג. המאמר המלא יפורסם בקרוב.',
    date: '2026-11-19', readMinutes: 3, kicker: 'השיטה · תוכן לדוגמה',
    body: [
      { type: 'p', text: 'זהו מאמר לדוגמה בלבד, שיוחלף בתוכן המלא על שיטת הלמידה.' },
      { type: 'h2', text: 'מקום לשיחה חדשה' },
      { type: 'p', text: 'כאן יופיע הסבר על הדרך שבה מתרגלים אנגלית מדוברת, בקצב אישי ובקול שלך.' },
      { type: 'quote', text: 'מקום לרעיון שכדאי לקחת לשיחה הבאה.' },
      { type: 'list', items: ['נקודה ראשונה לדוגמה', 'נקודה נוספת לתרגול'] },
    ], sources: [{ label: 'מקור לדוגמה · British Council', url: 'https://learnenglish.britishcouncil.org/' }],
  },
  {
    slug: 'conversation-example', title: 'עוד שיחה, עוד הזדמנות · מאמר לדוגמה',
    description: 'מקום למאמר נוסף על תרגול ולמידה. תוכן זמני להמחשה בלבד.',
    date: '2026-11-19', readMinutes: 2, kicker: 'תרגול · תוכן לדוגמה',
    body: [{ type: 'p', text: 'המאמר המלא יופיע כאן בקרוב. זהו תוכן זמני לבדיקת תצוגת הבלוג.' }], sources: [],
  },
];
