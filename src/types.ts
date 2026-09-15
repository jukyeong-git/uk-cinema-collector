export interface Performance {
  id: string;
  articleId: string;
  title: string;
  startsAtLocal: string;
  timeZone: 'Europe/London';
  status: 'available' | 'soldout' | 'unavailable';
}

export interface Collection {
  schemaVersion: 1;
  source: 'bfi-imax';
  collectedAt: string;
  complete: boolean;
  pages: {number: number; count: number}[];
  expectedPages: number;
  performances: Performance[];
}

export interface StoredState {
  version: 1;
  source: 'bfi-imax';
  hash: string;
}

export interface ChangePlan {
  hash: string;
  changed: boolean;
}
