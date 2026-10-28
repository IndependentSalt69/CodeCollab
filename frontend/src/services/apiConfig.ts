// Vite replaces this at build time. Empty means the browser's current origin.
export const API_BASE_URL: string = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
export const REALTIME_URL: string | undefined = (import.meta as any).env?.VITE_REALTIME_URL || API_BASE_URL || undefined;
