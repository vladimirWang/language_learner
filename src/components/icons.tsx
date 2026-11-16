type IconProps = { size?: number };

export function SpeakerIcon({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9.5v5a1.5 1.5 0 0 0 1.5 1.5h2.3l3.9 3.06c.66.52 1.63.05 1.63-.79V5.73c0-.84-.97-1.31-1.63-.79L7.8 8H5.5A1.5 1.5 0 0 0 4 9.5Z"
        fill="currentColor"
      />
      <path
        d="M16.5 8.4a5 5 0 0 1 0 7.2M18.9 6a8.4 8.4 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LockIcon({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="10.2" width="15" height="10.3" rx="3" fill="currentColor" />
      <path
        d="M8 10V7.8a4 4 0 0 1 8 0V10"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15.2" r="1.7" fill="#fff" />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.8 9.6 17.4 19 8"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SyncIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M19 12a7 7 0 1 1-2.05-4.95"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M19 4.5V9h-4.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrophyIcon({ size = 34 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4h10v4.2a5 5 0 0 1-10 0V4Z"
        fill="#FFC531"
        stroke="#E2A413"
        strokeWidth="1.2"
      />
      <path
        d="M7 5.2H4.6v1.6A3.4 3.4 0 0 0 8 10.2M17 5.2h2.4v1.6a3.4 3.4 0 0 1-3.4 3.4"
        stroke="#E2A413"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M12 13.2V16" stroke="#E2A413" strokeWidth="2" strokeLinecap="round" />
      <rect x="8" y="16" width="8" height="3.4" rx="1.4" fill="#F2A93B" />
      <rect x="6.4" y="19.4" width="11.2" height="2.2" rx="1.1" fill="#E2A413" />
    </svg>
  );
}

export function SparkleIcon({ size = 18, color = "#FFC531" }: IconProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5c.9 4.8 2.7 6.6 7.5 7.5-4.8.9-6.6 2.7-7.5 7.5-.9-4.8-2.7-6.6-7.5-7.5 4.8-.9 6.6-2.7 7.5-7.5Z"
        fill={color}
      />
      <path
        d="M18.5 15c.45 2.4 1.35 3.3 3.75 3.75-2.4.45-3.3 1.35-3.75 3.75-.45-2.4-1.35-3.3-3.75-3.75 2.4-.45 3.3-1.35 3.75-3.75Z"
        fill={color}
        opacity=".7"
      />
    </svg>
  );
}
