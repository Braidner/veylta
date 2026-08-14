export function VeyltaMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <path d="M4 7 21 13 13 24Z" fill="url(#veylta-a)" />
      <path d="M21 13 40 6 31 25Z" fill="url(#veylta-b)" />
      <path d="m13 24 9 16 9-15-10-12Z" fill="url(#veylta-c)" />
      <path d="m4 7 9 17 8-11Z" fill="#6AA9FF" opacity=".72" />
      <defs>
        <linearGradient id="veylta-a" x1="4" y1="7" x2="25" y2="28">
          <stop stopColor="#1473F3" />
          <stop offset="1" stopColor="#7457EE" />
        </linearGradient>
        <linearGradient id="veylta-b" x1="38" y1="5" x2="20" y2="28">
          <stop stopColor="#7457EE" />
          <stop offset="1" stopColor="#2859ED" />
        </linearGradient>
        <linearGradient id="veylta-c" x1="16" y1="18" x2="31" y2="40">
          <stop stopColor="#39A6F5" />
          <stop offset="1" stopColor="#3E42E8" />
        </linearGradient>
      </defs>
    </svg>
  );
}
