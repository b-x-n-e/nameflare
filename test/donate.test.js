import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAppPath } from '../public/routes.js';

// Wallet addresses are money routes: pin them so an accidental edit fails CI.
const WALLETS = {
  Bitcoin: 'bc1q42zny3nsqfcj5p336gk7rcqjhjvv3ufy4y6sep',
  'USDT (Ethereum)': '0x6B57f42a2b82feFc92356546786580f247FdB754',
  Solana: 'BqbhDNxEcAFU71X7WwnreCsnQ98pNGZQTC57rJwqVGgK'
};

test('Support page lists exactly the published wallet addresses', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const found = [...html.matchAll(/<li class="wallet" data-coin="([^"]+)">[\s\S]*?<code class="wallet-address"[^>]*>([^<]+)<\/code>/g)].map(([, coin, address]) => [coin, address]);
  assert.deepEqual(Object.fromEntries(found), WALLETS);
  assert.equal(found.length, 3);
  assert.ok(isAppPath('/donate'));
});
