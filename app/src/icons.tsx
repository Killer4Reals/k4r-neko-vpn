type P = { size?: number; className?: string };

const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const PowerIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v8" />
    <path d="M7.4 6.2a8 8 0 1 0 9.2 0" />
  </svg>
);

export const ServerIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="6" rx="2" />
    <rect x="3" y="14" width="18" height="6" rx="2" />
    <path d="M7 7h.01M7 17h.01" />
  </svg>
);

export const SplitIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 6h5l3 6h8" />
    <path d="M4 18h5l3-6" />
    <path d="m17 9 3 3-3 3" />
  </svg>
);

export const ShieldIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
    <path d="m9.2 11.6 1.9 1.9 3.7-3.9" />
  </svg>
);

export const LogIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 5h14v14H5z" />
    <path d="M8 9h8M8 13h8M8 17h5" />
  </svg>
);

export const GearIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11.5 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4Z" />
  </svg>
);

export const MinIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14" />
  </svg>
);

export const MaxIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
);

export const CloseIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const RefreshIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </svg>
);

export const SearchIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="6" />
    <path d="m16 16 4 4" />
  </svg>
);

export const BoltIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
  </svg>
);
