import {planChange,parseStoredState} from '../src/change.ts';
import {isRecord,requireCondition} from '../src/errors.ts';

export function parseRequest(event: unknown) {
  requireCondition(isRecord(event) && event.source === 'github-403-fallback' && typeof event.deliver === 'boolean' && 'previous' in event, 'INVALID_FALLBACK_REQUEST');
  return {deliver:event.deliver, previous:event.previous === null ? null : parseStoredState(event.previous)};
}
export async function completeCollection(payload: unknown, event: unknown, invoke: (payload: unknown)=>Promise<unknown>, onComparison: (plan: {hash:string;changed:boolean})=>void = ()=>{}) {
  const request=parseRequest(event);
  const plan=planChange(payload,request.previous);
  onComparison(plan);
  let delivered=false;
  if(plan.changed && request.deliver) {
    const response=await invoke(payload);
    requireCondition(isRecord(response) && response.accepted === true,'RECEIVER_NOT_ACKNOWLEDGED');
    delivered=true;
  }
  return {...plan,delivered};
}
