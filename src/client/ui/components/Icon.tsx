import { createContext } from 'preact';
import type { JSX } from 'preact';
import { useContext } from 'preact/hooks';
import type { ResourceType } from '../../../sim/types';
import '../hud.css';

/** Resolves an `IconId` to an image URL (the asset manifest's `iconUrl`). */
export type IconResolver = (id: string) => string;

export const IconContext = createContext<IconResolver>(() => '');

/** Command glyphs are drawn here (the manifest only draws content icons). */
const COMMAND_GLYPHS: Readonly<Record<string, JSX.Element>> = {
  'icon.command.stop': <rect x="7" y="7" width="14" height="14" rx="2" />,
  'icon.command.cancel': <path d="M7 7 L21 21 M21 7 L7 21" />,
  'icon.command.back': <path d="M17 6 L9 14 L17 22 M9 14 H22" />,
  'icon.command.rally': <path d="M8 5 V23 M8 6 H20 L17 10 L20 14 H8" />,
  // M2: military commands and the combat line of the selection panel. Drawn here like the other command glyphs.
  'icon.command.attackMove': <path d="M5 23 L20 8 M12 8 H20 V16 M8 14 L14 20" />,
  'icon.command.hold': <path d="M14 4 L23 8 V15 C23 20 19 23 14 25 C9 23 5 20 5 15 V8 Z" />,
  'icon.command.aggressive': <path d="M6 6 L22 22 M22 6 L6 22 M5 19 L9 23 M23 19 L19 23" />,
  'icon.command.standGround': <path d="M14 4 V23 M9 9 L14 4 L19 9 M8 24 H20" />,
  'icon.command.repair': <path d="M6 23 L16 13 M12 6 L21 6 L23 8 L23 13 L19 13 L14 8 Z" />,
  'icon.stat.attack': <path d="M5 23 L19 9 M15 5 H23 V13 M7 17 L11 21" />,
  'icon.stat.range': <path d="M14 5 A9 9 0 1 0 14.01 5 M14 1 V8 M14 20 V27 M1 14 H8 M20 14 H27" />,
  'icon.alert': <path d="M14 4 L25 23 H3 Z M14 11 V16 M14 19.5 V20" />,
};

export function resourceIconId(resource: ResourceType): string {
  return `icon.resource.${resource}`;
}

interface IconProps {
  id: string;
  /** Pixel size (square). */
  size?: number;
  class?: string;
}

/** An icon from the manifest, a command glyph, or initials when the URL is empty. */
export function Icon({ id, size = 32, class: cls }: IconProps) {
  const resolve = useContext(IconContext);
  const style = { width: `${size}px`, height: `${size}px` };
  const glyph = COMMAND_GLYPHS[id];
  if (glyph !== undefined) {
    return (
      <svg
        class={`icon glyph ${cls ?? ''}`}
        style={style}
        viewBox="0 0 28 28"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        {glyph}
      </svg>
    );
  }
  const url = resolve(id);
  if (url === '') {
    const initials = id.split('.').pop()?.slice(0, 2).toUpperCase() ?? '?';
    return (
      <span class={`icon placeholder ${cls ?? ''}`} style={style} aria-hidden="true">
        {initials}
      </span>
    );
  }
  return <img class={`icon ${cls ?? ''}`} style={style} src={url} alt="" draggable={false} />;
}
