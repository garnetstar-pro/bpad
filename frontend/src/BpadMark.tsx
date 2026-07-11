// Značka bpad: zápisník (modré panely) se zámkem a zelenou záložkou.
export default function BpadMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="11 16 42 42" aria-hidden="true">
      <path d="M12 18 L32 23.5 L32 48 L12 42.5 Z" fill="#3A63B0" />
      <path d="M52 18 L32 23.5 L32 48 L52 42.5 Z" fill="#274B90" />
      <path d="M27 46 L37 46 L32 55 Z" fill="#22B183" />
      <path
        d="M26 30 v-2.4 a6 6 0 0 1 12 0 V30"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect x="23.5" y="30" width="17" height="14" rx="2.6" fill="#fff" />
      <circle cx="32" cy="36" r="2" fill="#1B8E69" />
      <rect x="31" y="36.4" width="2" height="5" rx="1" fill="#1B8E69" />
    </svg>
  )
}
