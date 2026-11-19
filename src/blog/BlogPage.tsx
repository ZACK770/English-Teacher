import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { SpeakCallLogo } from '../components/brand/SpeakCallLogo';
import { LegalFooter } from '../components/legal/LegalFooter';
import { legalBasePath } from '../legalRoutes';
import { blogArticles, type BlogArticle } from './articles';
import { blogRoute } from './routes';
import '../components/portal/portal.css';
import '../components/portal/landing.css';
import './blog.css';

const dateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function ArticleCard({ article, base }: { article: BlogArticle; base: string }) {
  return <article className="sk-blog-card">
    <p className="sk-land-kicker">{article.kicker}</p>
    <h2><a href={`${base}/blog/${article.slug}`}>{article.title}</a></h2>
    <p>{article.description}</p>
    <div className="sk-blog-meta"><time dateTime={article.date}>{dateLabel(article.date)}</time><span>{article.readMinutes} דקות קריאה</span></div>
    <a className="sk-blog-read" href={`${base}/blog/${article.slug}`}>לקריאת המאמר <ArrowLeft size={18} aria-hidden="true" /></a>
  </article>;
}

export function BlogPage() {
  const base = legalBasePath(location.pathname);
  const route = blogRoute(location.pathname);
  const article = route && 'article' in route ? route.article : undefined;
  useEffect(() => {
    if (!route) { location.replace(`${base}/blog`); return; }
    document.title = route.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', route.description);
  }, [base, route]);
  if (!route) return null;
  const others = blogArticles.filter(item => item.slug !== article?.slug);
  return <div className="speakool sk-land sk-blog" dir="rtl">
    <header className="sk-shell sk-land-head">
      <a className="sk-land-brand" href={`${base}/`} aria-label="SpeakCall — עמוד הבית"><SpeakCallLogo /></a>
      <nav aria-label="ניווט ראשי"><a href={`${base}/blog`} aria-current={!article ? 'page' : undefined}>מאמרים</a><a className="sk-land-login" href={`${base}/#free-lesson`}>לנסות בחינם</a></nav>
    </header>
    <main className="sk-shell sk-blog-main">
      {article ? <>
        <a className="sk-blog-back" href={`${base}/blog`}>כל המאמרים ←</a>
        <article className="sk-blog-article">
          <header className="sk-blog-intro"><p className="sk-land-kicker">{article.kicker}</p><h1>{article.title}</h1><p className="sk-blog-lede">{article.description}</p><div className="sk-blog-meta"><time dateTime={article.date}>{dateLabel(article.date)}</time><span>{article.readMinutes} דקות קריאה</span></div></header>
          <div className="sk-blog-body">{article.body.map((block, i) => {
            if (block.type === 'list') return <ul key={i}>{block.items.map((item, j) => <li key={j}>{item}</li>)}</ul>;
            if (block.type === 'h2') return <h2 key={i}>{block.text}</h2>;
            if (block.type === 'quote') return <blockquote key={i}>{block.text}</blockquote>;
            return <p key={i}>{block.text}</p>;
          })}</div>
          {article.sources.length > 0 && <section className="sk-blog-sources" aria-labelledby="sources-title"><h2 id="sources-title">מקורות</h2><ol>{article.sources.map((source, i) => <li key={i}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label} ↗</a></li>)}</ol></section>}
          <aside className="sk-blog-cta"><p className="sk-land-kicker">עכשיו תור הפה</p><h2>מהקריאה לשיחה.</h2><p>שיעור ראשון של שבע דקות בחינם, בטלפון או במחשב.</p><a className="sk-primary" href={`${base}/#free-lesson`}>לשיעור ראשון בחינם <ArrowLeft size={18} aria-hidden="true" /></a></aside>
        </article>
        {others.length > 0 && <section className="sk-blog-related" aria-labelledby="related-title"><h2 id="related-title">עוד רעיונות לשיחה הבאה</h2><div className="sk-blog-grid">{others.map(item => <ArticleCard key={item.slug} article={item} base={base} />)}</div></section>}
      </> : <>
        <header className="sk-blog-intro"><p className="sk-land-kicker">הבלוג של ספיקול · השיטה מאחורי השיחה</p><h1>פחות לשנן.<br /><span>יותר להבין איך לומדים.</span></h1><p className="sk-blog-lede">על אנגלית מדוברת, תרגול בקול והמילים שנשארות איתך. רעיונות שלוקחים לשיחה הבאה.</p></header>
        {blogArticles.length ? <div className="sk-blog-grid">{blogArticles.map(item => <ArticleCard key={item.slug} article={item} base={base} />)}</div> : <p>מאמרים חדשים יופיעו כאן בקרוב.</p>}
      </>}
    </main>
    <footer className="sk-shell sk-land-foot"><a href={`${base}/`}>לעמוד הבית</a><a href={`${base}/blog`}>מאמרים</a><a href={`${base}/#free-lesson`}>לשיעור ראשון בחינם</a></footer>
    <LegalFooter />
  </div>;
}
