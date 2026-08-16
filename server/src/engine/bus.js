import { EventEmitter } from 'node:events';

/** In-process pub/sub feeding the SSE stream (live prices, alerts, scrape status). */
export const bus = new EventEmitter();
bus.setMaxListeners(50);
