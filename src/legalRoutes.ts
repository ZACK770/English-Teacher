export const legalPages = ['terms', 'privacy', 'accessibility'] as const;

export const legalBasePath = (pathname: string) => /^\/english(?:\/|$)/.test(pathname) ? '/english' : '';

export const legalHref = (pathname: string, page: typeof legalPages[number]) => `${legalBasePath(pathname)}/${page}`;

export const legalPageForPath = (pathname: string) => {
  const path = pathname.slice(legalBasePath(pathname).length).replace(/\/$/, '');
  return legalPages.find(page => path === `/${page}`);
};
