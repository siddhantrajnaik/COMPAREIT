const S = ({ children, ...p }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
       strokeLinecap="round" strokeLinejoin="round" {...p}>{children}</svg>
);

export const IconSearch = (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></S>;
export const IconBell = (p) => <S {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></S>;
export const IconEye = (p) => <S {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></S>;
export const IconBasket = (p) => <S {...p}><path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9Z" /><path d="M9 8V5.5a3 3 0 0 1 6 0V8" /></S>;
export const IconSliders = (p) => <S {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></S>;
export const IconRefresh = (p) => <S {...p}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></S>;
export const IconPlus = (p) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IconTrash = (p) => <S {...p}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></S>;
export const IconExternal = (p) => <S {...p}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></S>;
export const IconPin = (p) => <S {...p}><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></S>;
export const IconFlame = (p) => <S {...p}><path d="M12 22c4 0 7-2.7 7-6.5 0-4.5-4.5-6-4.5-9.5 0 0-3 1.5-3 5 0 1.2-.8 2-1.8 1.4C8.4 11.4 8 10 8 10c-1 1.4-3 3-3 5.5C5 19.3 8 22 12 22Z" /></S>;
export const IconCheck = (p) => <S {...p}><path d="m5 13 4 4L19 7" /></S>;
export const IconClose = (p) => <S {...p}><path d="M6 6l12 12M18 6 6 18" /></S>;
export const IconBox = (p) => <S {...p}><path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></S>;
export const IconTrendDown = (p) => <S {...p}><path d="m3 7 6.5 6.5 4-4L21 17" /><path d="M15 17h6v-6" /></S>;
export const IconTarget = (p) => <S {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".6" fill="currentColor" /></S>;
export const IconTag = (p) => <S {...p}><path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.3" /></S>;
export const IconBowl = (p) => <S {...p}><path d="M3 11h18a9 9 0 0 1-9 9 9 9 0 0 1-9-9Z" /><path d="M8 8c0-1.5 1-2 1-3M12 7c0-1.5 1-2 1-3M16 8c0-1.5 1-2 1-3" /></S>;
export const IconCompare = (p) => <S {...p}><path d="M4 8h11M4 8l3-3M4 8l3 3" /><path d="M20 16H9m11 0-3-3m3 3-3 3" /></S>;
export const IconChevron = (p) => <S {...p}><path d="m9 6 6 6-6 6" /></S>;
