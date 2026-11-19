import './logo.css';

type SpeakCallLogoProps = {
  variant?: 'wordmark' | 'symbol';
  reverse?: boolean;
  collapse?: boolean;
};

export function SpeakCallLogo({ variant = 'wordmark', reverse = true, collapse = false }: SpeakCallLogoProps) {
  const suffix = reverse ? '-reverse' : '';
  const symbol = `/brand/speakcall/symbol${suffix}.svg`;
  const src = variant === 'symbol' ? symbol : `/brand/speakcall/logo-en${suffix}.svg`;
  return <picture className={`sc-logo${variant === 'symbol' ? ' sc-logo-symbol' : ''}${collapse ? ' sc-logo-collapse' : ''}`}>
    {collapse && variant === 'wordmark' && <source media="(max-width: 960px)" srcSet={symbol} />}
    <img src={src} alt="SpeakCall — ספיקול" width={variant === 'symbol' ? 128 : 708} height={variant === 'symbol' ? 128 : 170} />
  </picture>;
}
