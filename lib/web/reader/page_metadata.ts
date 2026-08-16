export interface PageMetadata {
  faviconUrl?: string;
  previewImageUrl?: string;
}

function absoluteUrl(value: string | null | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
}

export function pageMetadata(document: Document): PageMetadata {
  const baseUrl = document.location.href;
  const image =
    document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content ??
    document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')?.content;
  const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href ?? '/favicon.ico';
  const faviconUrl = absoluteUrl(favicon, baseUrl);
  const previewImageUrl = absoluteUrl(image, baseUrl);

  return {
    ...(faviconUrl ? { faviconUrl } : {}),
    ...(previewImageUrl ? { previewImageUrl } : {}),
  };
}
