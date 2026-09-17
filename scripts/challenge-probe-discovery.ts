export type FrameClassification = 'target-site' | 'blank' | 'cloudflare-challenge' | 'other' | 'invalid';

// Never return a complete URL: frame URLs can carry challenge/session tokens.
export function classifyFrame(rawUrl: string, targetOrigin: string): {
  classification: FrameClassification; origin: string | null; rejectionReason: string | null;
} {
  if (rawUrl === 'about:blank' || rawUrl === 'about:srcdoc') {
    return {classification:'blank',origin:null,rejectionReason:null};
  }
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password || !['https:','http:'].includes(url.protocol)) {
      return {classification:'invalid',origin:null,rejectionReason:'unsupported-or-credentialed-url'};
    }
    if (url.origin === targetOrigin) return {classification:'target-site',origin:url.origin,rejectionReason:null};
    if (url.origin === 'https://challenges.cloudflare.com') {
      return {classification:'cloudflare-challenge',origin:url.origin,rejectionReason:null};
    }
    return {classification:'other',origin:null,rejectionReason:'unapproved-frame-url'};
  } catch {
    return {classification:'invalid',origin:null,rejectionReason:'invalid-frame-url'};
  }
}
