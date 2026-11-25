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
