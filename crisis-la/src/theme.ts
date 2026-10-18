import type { CSSProperties } from 'react';

/** The visual skin. Story data, approval rules and camera choreography live elsewhere. */
export const theme = {
  colors: {
    ink: '#edf2ee', muted: '#93a4a9', faint: '#60747d', canvas: '#101b22', panel: '#132028',
    border: '#31434a', cyan: '#9cded7', amber: '#e8be78', red: '#e39180', green: '#a6d5a1',
  },
  typography: {
    sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    display: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    scale: 1,
  },
  chrome: { radius: '12px', panelOpacity: '94%', blur: '20px', labelRadius: '6px' },
  labels: {padding:'12px 15px', titleSize:'14px', metaSize:'9px', surfaceOpacity:'93%'},
  map: { brightness: 0.68, contrast: 1.12, saturation: 0.68, gamma: 0.95, fog: false },
};

export const themeVariables = {
  ...Object.fromEntries(Object.entries(theme.colors).map(([key, value]) => [`--${key}`, value])),
  '--font-sans': theme.typography.sans, '--font-mono': theme.typography.mono,
  '--font-display': theme.typography.display, '--radius': theme.chrome.radius,
  '--panel-opacity': theme.chrome.panelOpacity, '--panel-blur': theme.chrome.blur,
  '--label-radius': theme.chrome.labelRadius,
  '--label-padding': theme.labels.padding, '--label-title-size': theme.labels.titleSize,
  '--label-meta-size': theme.labels.metaSize, '--label-surface-opacity': theme.labels.surfaceOpacity,
  '--type-scale': theme.typography.scale,
} as CSSProperties;
