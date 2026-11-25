import type { BannerVM, ToastVM } from '../viewModel';

export function Toasts({ toasts }: { toasts: readonly ToastVM[] }) {
  return (
    <div class="toasts" data-testid="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`} data-testid="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Banner({ banner }: { banner: BannerVM | null }) {
  if (banner === null) return null;
  return (
    <div key={banner.id} class={`banner banner-${banner.kind}`} data-testid="banner" role="alert">
      <div class="banner-title">{banner.title}</div>
      <div class="banner-sub">{banner.subtitle}</div>
    </div>
  );
}
