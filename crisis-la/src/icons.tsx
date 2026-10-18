import type { CSSProperties } from 'react';
export type IconName = 'play'|'pause'|'previous'|'next'|'replay'|'captions'|'expand'|'crosshair'|'arrow'|'check'|'close'|'info'|'layers'|'chevron'|'water'|'power'|'access'|'hours'|'volume'|'mute'|'north'|'camera';
const paths: Record<IconName, React.ReactNode> = {
  camera:<><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-4v12l-6-4"/></>,
  play:<path d="m8 5 11 7-11 7Z"/>, pause:<><path d="M8 5v14M16 5v14"/></>,
  previous:<><path d="M5 5v14m14-14L8 12l11 7Z"/></>, next:<><path d="M19 5v14M5 5l11 7-11 7Z"/></>,
  replay:<><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></>,
  captions:<><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 9H7v6h3m9-6h-3v6h3"/></>,
  expand:<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>,
  crosshair:<><circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></>,
  arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>, check:<path d="m5 12 4 4L19 6"/>,
  close:<path d="m6 6 12 12M18 6 6 18"/>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/></>,
  layers:<><path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></>,
  chevron:<path d="m9 5 7 7-7 7"/>, water:<path d="M12 2s-7 8-7 13a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/>,
  power:<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>, access:<><path d="m4 20 5-16m6 0 5 16M12 5v3m0 4v3m0 4v2"/></>,
  hours:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  volume:<><path d="m4 9 4 0 5-4v14l-5-4H4Z"/><path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  mute:<><path d="m4 9 4 0 5-4v14l-5-4H4Zm13-1 4 8m0-8-4 8"/></>, north:<path d="m12 3 7 17-7-4-7 4Z"/>,
};
export function Icon({ name, size = 18, style }: {name:IconName;size?:number;style?:CSSProperties}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
