#!/usr/bin/env node
/**
 * Generates the VAPID keypair that Web Push needs and writes it into .env.
 * Run once. Regenerating invalidates existing device subscriptions.
 */
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const envPath = path.join(ROOT, '.env');

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

if (/VAPID_PUBLIC_KEY=\S/.test(env)) {
  console.log('VAPID keys already present in .env — leaving them alone.');
  console.log('Delete the VAPID_* lines and re-run if you really want new ones.');
  process.exit(0);
}

const keys = webpush.generateVAPIDKeys();

env = env.replace(/^VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=.*$/gm, '').trimEnd();
env += `${env ? '\n' : ''}VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:you@example.com
`;

fs.writeFileSync(envPath, env.replace(/\n{3,}/g, '\n\n'));
console.log('VAPID keys written to .env');
console.log('Public key:', keys.publicKey);
