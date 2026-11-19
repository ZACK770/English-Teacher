import { legalBasePath } from '../legalRoutes';
import { blogArticles } from './articles';

export const blogIndexMeta = {
  title: 'מאמרים על השיטה | SpeakCall',
  description: 'על אנגלית מדוברת, תרגול בקול ושיטת הלמידה של ספיקול. רעיונות שלוקחים לשיחה הבאה.',
};

export function blogRoute(pathname: string) {
  const path = pathname.slice(legalBasePath(pathname).length).replace(/\/$/, '');
  if (path === '/blog') return { path, ...blogIndexMeta };
  if (!path.startsWith('/blog/')) return undefined;
  const article = blogArticles.find(item => `/blog/${item.slug}` === path);
  return article ? { path, title: `${article.title} | SpeakCall`, description: article.description, article } : undefined;
}

export const isBlogPath = (pathname: string) => /^\/blog(?:\/|$)/.test(pathname.slice(legalBasePath(pathname).length));

export function blogHtml(html: string, meta: { path: string; title: string; description: string }) {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const title = escape(meta.title);
  const description = escape(meta.description);
  const url = escape(`https://speakool.net${meta.path}`);
  return html.replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, () => `<meta name="description" content="${description}`)
    .replace(/(<link rel="canonical" href=")[^"]*/, () => `<link rel="canonical" href="${url}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, () => `<meta property="og:url" content="${url}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, () => `<meta property="og:title" content="${title}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, () => `<meta property="og:description" content="${description}`);
}
