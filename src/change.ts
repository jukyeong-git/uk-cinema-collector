import {createHash} from 'node:crypto';
import {validateCollection} from './collection.ts';
import type {StoredState, ChangePlan} from './types.ts';
import {isRecord,requireCondition} from './errors.ts';

// Hash only normalized business data, not collection timestamps or page layout.
export function collectionHash(value: unknown) {
  const payload = validateCollection(value);
  const rows = payload.performances.map(row => ({
    id: row.id.toLowerCase(),
    articleId: row.articleId.toLowerCase(),
    title: row.title,
    startsAtLocal: row.startsAtLocal,
    timeZone: row.timeZone,
    status: row.status,
  })).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return createHash('sha256').update(JSON.stringify({version:1,source:payload.source,performances:rows})).digest('hex');
}

export function parseStoredState(value: unknown): StoredState {
  requireCondition(isRecord(value) && value.version === 1 && value.source === 'bfi-imax' && typeof value.hash === 'string' && /^[a-f0-9]{64}$/.test(value.hash), 'INVALID_STORED_HASH');
  requireCondition(Object.keys(value).every(k => ['version','source','hash'].includes(k)), 'INVALID_STORED_HASH');
  return {version:1,source:'bfi-imax',hash:value.hash};
}

export function planChange(payload: unknown, previous: unknown): ChangePlan {
  const hash = collectionHash(payload);
  const stored = previous ? parseStoredState(previous) : null;
  return {hash,changed:stored?.hash !== hash};
}

export function acknowledgedState(payload: unknown, pending: unknown, response: unknown): StoredState {
  requireCondition(isRecord(response) && response.accepted === true, 'RECEIVER_NOT_ACKNOWLEDGED');
  const hash = collectionHash(payload);
  requireCondition(isRecord(pending) && pending.changed === true && pending.hash === hash, 'PAYLOAD_CHANGED_AFTER_COMPARISON');
  return {version:1,source:'bfi-imax',hash};
}
