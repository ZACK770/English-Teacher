import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';
import { blogArticles } from '../../src/blog/articles';
import { blogHtml, blogIndexMeta, blogRoute } from '../../src/blog/routes';

const index = readFileSync(new NodeURL('../../index.html', import.meta.url), 'utf8');
const env = () => ({ ASSETS: { fetch: vi.fn(async () => new Response(index)) } }) as unknown as Env;

describe('public blog routing', () => {
  it.each(['/blog', '/blog/', '/english/blog', `/blog/${blogArticles[0].slug}`, `/english/blog/${blogArticles[0].slug}/`])('serves page-specific metadata for %s even when assets falls back to index', async path => {
    const response = await worker.fetch(new Request(`https://example.com${path}?source=test`), env());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    const article = path.includes(blogArticles[0].slug) ? blogArticles[0] : undefined;
    const title = article ? `${article.title} | SpeakCall` : blogIndexMeta.title;
    const description = article?.description ?? blogIndexMeta.description;
    const canonical = `https://speakool.net/blog${article ? `/${article.slug}` : ''}`;
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<meta name="description" content="${description}"`);
    expect(html).toContain(`<meta property="og:title" content="${title}"`);
    expect(html).toContain(`<meta property="og:description" content="${description}"`);
    expect(html).toContain(`<meta property="og:url" content="${canonical}"`);
    expect(html).toContain(`<link rel="canonical" href="${canonical}"`);
    expect(html).toContain('id="root"');
  });

  it.each(['/blog/missing', '/english/blog/missing', '/blog/example/extra'])('redirects unknown article %s to the index', async path => {
    const response = await worker.fetch(new Request(`https://example.com${path}`), env());
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`https://example.com${path.startsWith('/english/') ? '/english' : ''}/blog`);
  });

  it('does not treat unrelated paths as blog pages', () => {
    expect(blogRoute('/blogging')).toBeUndefined();
    expect(blogRoute('/english-other/blog')).toBeUndefined();
  });

  it('escapes metadata and handles empty descriptions without interpreting replacement tokens', () => {
    const html = blogHtml(index, { path: '/blog/test', title: '<test> " & $&', description: '' });
    expect(html).toContain('<title>&lt;test&gt; &quot; &amp; $&amp;</title>');
    expect(html).toContain('<meta name="description" content=""');
  });
});
