export type FrameClassification = 'target-site' | 'blank' | 'cloudflare-challenge' | 'other' | 'invalid';

export function describeFrameUrl(rawUrl: string) {
  let parsed: URL | undefined;
  try { parsed=new URL(rawUrl); } catch { /* Report shape, never the input. */ }
  const protocol=parsed?.protocol;
  return {
    empty:rawUrl.length===0,
    relative:rawUrl.length>0 && !/^[a-z][a-z\d+.-]*:/i.test(rawUrl),
    opaque:Boolean(parsed && parsed.origin==='null'),
    parseable:Boolean(parsed),
    protocolCategory:protocol==='https:' ? 'https' : protocol==='http:' ? 'http' : protocol==='about:' ? 'about' : protocol==='data:' ? 'data' : protocol==='blob:' ? 'blob' : protocol ? 'other' : 'none',
    lengthBucket:rawUrl.length===0 ? 'empty' : rawUrl.length<=64 ? '1-64' : rawUrl.length<=256 ? '65-256' : rawUrl.length<=1024 ? '257-1024' : '1025+',
  };
}

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

// A missing/blank/unresolved browser URL is not origin evidence. Fall back only
// to an exact trusted origin; a known foreign document must never be upgraded
// merely because the iframe's declared src still names an earlier trusted URL.
export function resolveFrameEvidence(primaryUrl: string, targetOrigin: string, fallback: {documentUrl?:string; frameElementSrc?:string} = {}) {
  const primary=classifyFrame(primaryUrl,targetOrigin);
  const result=(classification:ReturnType<typeof classifyFrame>,evidenceSource:'frame-url'|'document-url'|'frame-element-src'|'none')=>({
    ...classification,evidenceSource,urlShape:describeFrameUrl(primaryUrl),
    ...(fallback.documentUrl===undefined ? {} : {documentUrlShape:describeFrameUrl(fallback.documentUrl)}),
    ...(fallback.frameElementSrc===undefined ? {} : {frameElementSrcShape:describeFrameUrl(fallback.frameElementSrc)}),
  });
  const trusted=(value:ReturnType<typeof classifyFrame>)=>value.classification==='target-site' || value.classification==='cloudflare-challenge';
  const unresolved=(raw:string)=>raw==='' || raw==='about:blank' || raw==='about:srcdoc' || describeFrameUrl(raw).relative;
  if (trusted(primary)) return result(primary,'frame-url');
  if (!unresolved(primaryUrl)) return result(primary,'frame-url');
  if (fallback.documentUrl!==undefined) {
    const document=classifyFrame(fallback.documentUrl,targetOrigin);
    if (trusted(document)) return result(document,'document-url');
    if (!unresolved(fallback.documentUrl)) return result(document,'document-url');
  }
  if (fallback.frameElementSrc!==undefined) {
    const declared=classifyFrame(fallback.frameElementSrc,targetOrigin);
    if (trusted(declared)) return result(declared,'frame-element-src');
  }
  return result({...primary,rejectionReason:primary.rejectionReason ?? 'missing-exact-origin-evidence'},'none');
}

// Export only fixed categories; browser errors may contain URLs or script text.
export function inspectionFailure(error: unknown): string {
  const message=error instanceof Error ? error.message : '';
  if (/INSPECTION_TIMEOUT|timeout|timed out/i.test(message)) return 'timeout';
  if (/detached|frame was removed|frame has been removed/i.test(message)) return 'detached';
  if (/execution context|cannot find context|context.*destroyed/i.test(message)) return 'execution-context';
  if (/target.*closed|browser.*closed|page.*closed/i.test(message)) return 'closed';
  if (/not supported|not implemented/i.test(message)) return 'unsupported';
  if (/unable to adopt|different document/i.test(message)) return 'adoption-failed';
  if (/protocol error/i.test(message)) return 'protocol-error';
  return 'other';
}

// Keep a bounded first line only; never publish URLs, quoted values, tokens or stacks.
export function inspectionErrorDetail(error: unknown) {
  const message=error instanceof Error ? error.message : '';
  const detail=message.split('\n',1)[0]
    .replace(/(?:https?|file|data|blob):[^\s]+/gi,'[REDACTED_URL]')
    .replace(/(["'`])[^"'`]*\1/g,'[REDACTED_VALUE]')
    .replace(/(?:token|cookie|authorization|password|secret)\s*[:=]\s*\S+/gi,'[REDACTED_SECRET]')
    .replace(/[a-z\d_+\/=.-]{24,}/gi,'[REDACTED_ID]')
    .slice(0,400);
  return {category:inspectionFailure(error),detail};
}
