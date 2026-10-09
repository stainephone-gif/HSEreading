// Знак «Полей»: угловатый треугольник с градиентом фиолетовый → бирюзовый.
// Градиент допустим только здесь и в созвездии, интерфейс остаётся плоским.
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8052ff" />
          <stop offset="1" stopColor="#15846e" />
        </linearGradient>
      </defs>
      <path d="M3 21 L12 3 L21 21 Z M12 9 L8 17 L16 17 Z" fill="url(#logo-gradient)" fillRule="evenodd" />
    </svg>
  );
}
