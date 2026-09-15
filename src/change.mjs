import {createHash} from 'node:crypto';
import {validateCollection} from './collection.mjs';
import {requireCondition} from './errors.mjs';

// Hash only normalized business data, not collection timestamps or page layout.
export function collectionHash(payload) {
  validateCollection(payload);
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

export function parseStoredState(value) {
  requireCondition(value && value.version === 1 && value.source === 'bfi-imax' && /^[a-f0-9]{64}$/.test(value.hash), 'INVALID_STORED_HASH');
  requireCondition(Object.keys(value).every(k => ['version','source','hash'].includes(k)), 'INVALID_STORED_HASH');
  return value;
}

export function planChange(payload, previous) {
  const hash = collectionHash(payload);
  if (previous) parseStoredState(previous);
  return {hash,changed:previous?.hash !== hash};
}

export function acknowledgedState(payload, pending, response) {
  requireCondition(response?.accepted === true, 'RECEIVER_NOT_ACKNOWLEDGED');
  const hash = collectionHash(payload);
  requireCondition(pending.changed === true && pending.hash === hash, 'PAYLOAD_CHANGED_AFTER_COMPARISON');
  return {version:1,source:payload.source,hash};
}
