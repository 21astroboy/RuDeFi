// Run with node --test tests/ui-regressions.cjs; no wallet/network required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('ui/index.html', 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  const asyncStart = source.indexOf(`  async function ${name}(`);
  const pos = start >= 0 ? start : asyncStart;
  const end = source.indexOf('\n  }', pos) + 4;
  assert.ok(pos >= 0 && end > pos);
  return source.slice(pos, end);
}
test('amount conversion is exact and rejects silent truncation/overflow', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extract('scaleAmount'), ctx);
  for (const [input, decimals, expected] of [
    ['12.345', 6, '12345000'], ['0.000001', 6, '1'],
    ['1.0000000', 6, '1000000'], ['1.0000001', 6, null],
    ['1e3', 18, null], ['-1', 18, null], ['1', -1, null],
    [(1n << 256n).toString(), 0, null],
    [((1n << 256n) - 1n).toString(), 0, ((1n << 256n) - 1n).toString()],
  ]) assert.equal(ctx.scaleAmount(input, decimals), expected);
});
test('reverted receipt fails immediately; transient RPC errors retry', async () => {
  let calls = 0;
  const ctx = vm.createContext({
    getWallet: () => ({ request: async () => {
      calls++;
      if (calls === 1) throw Error('RPC offline');
      return { status: '0x0' };
    }}),
    setTimeout: (cb) => cb(),
  });
  vm.runInContext(extract('waitForReceipt'), ctx);
  await assert.rejects(ctx.waitForReceipt('0x123'), /reverted/);
  assert.equal(calls, 2);
});
test('successful receipt returns after pending response', async () => {
  let calls = 0;
  const ctx = vm.createContext({
    getWallet: () => ({ request: async () => ++calls === 1 ? null : {status: '0x1'} }),
    setTimeout: (cb) => cb(),
  });
  vm.runInContext(extract('waitForReceipt'), ctx);
  assert.equal((await ctx.waitForReceipt('0x123')).status, '0x1');
  assert.equal(calls, 2);
});
new vm.Script(source.match(/<script>([\s\S]*?)<\/script>/)[1]);
test('swap uses captured quote inputs even after form changes', async () => {
  const requests = [];
  const wallet = '0x' + '1'.repeat(40);
  const token = '0x' + '2'.repeat(40);
  const context = { wallet, fromTokenAddr: token, rawAmount: '123456',
    fromChain: {chain_id: 1, key: 'ethereum', name: 'Ethereum'},
    toChain: {chain_id: 1} };
  const ctx = vm.createContext({
    bridgeRoutesByIdx: [{ id: 'quote', steps: [{}], quoteContext: context }],
    getWallet: () => ({request: async (req) => {
      requests.push(req);
      if (req.method === 'eth_requestAccounts') return [wallet];
      if (req.method === 'eth_chainId') return '0x1';
      return '0xtx';
    }}),
    isNativeAddr: () => false, showSwapModal() {}, setSwapStep() {},
    fetchBuildTx: async () => ({estimate: {approvalAddress: token}, transactionRequest: {to: token, data: '0x1234'}}),
    encodeApprove: (spender, amount) => { assert.equal(amount, '123456'); return '0xapprove'; },
    estimateGasCost: async () => ({}), linkTx: () => '', waitForReceipt: async () => ({}),
    alert: (message) => assert.fail(message), console,
    escapeHtml: (s) => s,
    $: () => assert.fail('Execution must not read mutable form fields'),
  });
  vm.runInContext(extract('executeSwap'), ctx);
  await ctx.executeSwap(0);
  const sent = requests.filter(r => r.method === 'eth_sendTransaction');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].params[0].to, token);
});
