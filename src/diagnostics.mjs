// Explicit allowlist: never serialize URLs, cookies, HTML, or raw errors.
export function responseDiagnostic(response) {
  if (!response) return {responseReceived:false};
  const headers=response.headers();
  const status=response.status();
  const mime=(headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const ray=headers['cf-ray'] ?? '';
  return {
    responseReceived:true,httpStatus:status,
    cloudflareChallenge:headers['cf-mitigated']==='challenge',
    cloudflareServer:headers.server==='cloudflare',
    ...( /^[a-f0-9]{16,32}-[A-Z]{3}$/i.test(ray) ? {cloudflareRay:ray} : {}),
    contentType:['text/html','application/json','text/plain'].includes(mime)?mime:'other',
    redirected:Boolean(response.request().redirectedFrom()),
  };
}
export function errorDiagnostic(error) {
  const errorType=['CollectionError','TimeoutError','TypeError','Error'].includes(error?.name)?error.name:'OtherError';
  const text=String(error?.message ?? '');
  const networkCode=['NS_ERROR_NET_RESET','NS_ERROR_CONNECTION_REFUSED','NS_ERROR_UNKNOWN_HOST','NS_ERROR_NET_TIMEOUT','NS_ERROR_ABORT','ERR_CONNECTION_RESET','ERR_NAME_NOT_RESOLVED'].find(code=>text.includes(code));
  return {errorType,...(networkCode?{networkCode}:{})};
}
