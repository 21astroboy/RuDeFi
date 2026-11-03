const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('frontend/app.js', 'utf8');
const section = html.slice(html.indexOf('  // ---- MetaMask connection persistence'), html.indexOf('  // ---- Scan & render ----'));
const ADDRESS = '0x' + '1'.repeat(40);
const OTHER = '0x' + '2'.repeat(40);
function setup(ethereum) {
  const listeners = new Map();
  const nodes = new Map();
  const storage = new Map();
  const alerts = [];
  const window = {
    ethereum,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
  };
  const ctx = vm.createContext({window, document: {addEventListener() {}, visibilityState:'visible'},
    $: id => { if (!nodes.has(id)) nodes.set(id, {value:'', hidden:true}); return nodes.get(id); },
    localStorage: {getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    setStatus() {}, renderWalletBook() {}, doScan() {}, alert: message=>alerts.push(message),
    setTimeout, clearTimeout, Event, URL, location: {href:'https://app.example/path?tab=bridge#swap'},
    bridgeRoutesByIdx: [],
  });
  vm.runInContext(section, ctx);
  return {ctx, window, nodes, alerts, storage};
}
function provider(extra = {}) {
  const events = new Map();
  return {isMetaMask:true, request:async ({method})=> method==='eth_requestAccounts'||method==='eth_accounts' ? [ADDRESS] : '0x1',
    on:(n,f)=>events.set(n,f), removeListener:(n)=>events.delete(n),
    emit:(n,v)=>events.get(n)?.(v), events, ...extra};
}
test('prefers announced MetaMask over impostor legacy provider; deduplicates announcements', () => {
  const fake = provider({isRabby:true}); const mm = provider(); const env=setup(fake);
  assert.equal(env.ctx.getWallet(), null);
  const event={type:'eip6963:announceProvider',detail:{info:{rdns:'io.metamask',uuid:'mm'},provider:mm}};
  env.window.dispatchEvent(event);env.window.dispatchEvent(event);
  env.window.dispatchEvent({type:'eip6963:announceProvider',detail:null});
  assert.equal(env.ctx.getWallet(), mm);
  assert.equal(vm.runInContext('EIP6963_PROVIDERS.length',env.ctx),1);
});
test('waits for delayed MetaMask Mobile injection', async () => {
  const env=setup(); const pending=env.ctx.waitForMetaMask(100);
  const mm=provider();env.window.ethereum=mm;
  env.window.dispatchEvent({type:'ethereum#initialized'});
  assert.equal(await pending,mm);
});
test('connect handles account changes, revocation, disconnect and avoids duplicate listeners', async () => {
  const mm=provider();const {ctx,nodes}=setup(mm);
  assert.equal(await ctx.connectMetaMask(),ADDRESS);
  assert.equal(nodes.get('addrInput').value,ADDRESS);
  assert.equal(mm.events.size,3);
  await ctx.connectMetaMask();assert.equal(mm.events.size,3);
  mm.emit('accountsChanged',[OTHER]);assert.equal(nodes.get('addrInput').value,OTHER);
  mm.emit('accountsChanged',[]);
  assert.equal(vm.runInContext('walletConnectedAddress',ctx),null);
  assert.equal(nodes.get('connectBtn').textContent,'Подключить MetaMask');
  await ctx.connectMetaMask();mm.emit('disconnect',{code:4900});
  assert.equal(vm.runInContext('walletConnectedAddress',ctx),null);
});
test('does not silently connect Rabby when MetaMask is absent', async () => {
  let requested=false;const env=setup(provider({isRabby:true,request:async()=>{requested=true;return [ADDRESS]}}));
  vm.runInContext('waitForMetaMask = async () => pickMetaMaskProvider()',env.ctx);
  assert.equal(await env.ctx.connectMetaMask(),null);
  assert.equal(requested,false);
  assert.equal(env.nodes.get('walletHelp').hidden,false);
  assert.equal(env.nodes.get('openMetaMask').href,'https://link.metamask.io/dapp/app.example/path?tab=bridge#swap');
});
test('reject and pending errors restore button and explain next step',async()=>{
  for(const code of [4001,-32002]){
    const env=setup(provider({request:async()=>{throw {code}}}));
    assert.equal(await env.ctx.connectMetaMask(),null);
    assert.equal(env.nodes.get('connectBtn').disabled,false);
    assert.match(env.alerts[0],code===4001?/отменил/:/уже открыт/);
  }
});
test('duplicate clicks issue a single request',async()=>{
  let finish;let calls=0;
  const env=setup(provider({request:()=>{calls++;return new Promise(r=>finish=r)}}));
  const first=env.ctx.connectMetaMask();await Promise.resolve();
  assert.equal(await env.ctx.connectMetaMask(),null);
  finish([ADDRESS]);await first;assert.equal(calls,1);
});
test('restore uses current authorized account without a popup and retains watch-only address',async()=>{
  const calls=[];const mm=provider({request:async r=>{calls.push(r.method);return [ADDRESS]}});
  const env=setup(mm);await env.ctx.tryRestoreConnection();
  assert.deepEqual(calls,['eth_accounts']);assert.equal(env.nodes.get('addrInput').value,ADDRESS);
  env.nodes.get('addrInput').value=OTHER;await env.ctx.syncMetaMaskAccounts();
  assert.equal(env.nodes.get('addrInput').value,OTHER);
  assert.equal(vm.runInContext('walletConnectedAddress',env.ctx),ADDRESS);
});
test('switching provider removes old listeners',async()=>{
  const first=provider();const env=setup(first);await env.ctx.connectMetaMask();
  const second=provider();env.ctx.attachMetaMaskListeners(second);
  assert.equal(first.events.size,0);assert.equal(second.events.size,3);
});
