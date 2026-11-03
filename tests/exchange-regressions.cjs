const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const html=fs.readFileSync('ui/index.html','utf8');
const start=html.indexOf('  // Separate sections retain');const end=html.indexOf('  // ============== Protocol deep-links',start);
function setup(){
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',style:{},options:[],appendChild(child){this.child=child;}});return nodes.get(id);};
 const ctx=vm.createContext({$:get,bridgeRoutesByIdx:[],registryData:{chains:[{key:'ethereum'},{key:'arbitrum'}]},
 loadRegistry:async()=>{},populateBridgeChain(id,key){const n=get(id);n.options=['ethereum','arbitrum'].map(value=>({value}));n.value=key;},
 populateBridgeTokens(chain,id,symbol){const n=get(id);n.options=['ETH','USDC'].map(value=>({value}));n.value=symbol||'ETH';},
 updateBridgeBalance(){},updateMevBanner(){},updateToTokenSecurity(){},
 });vm.runInContext(html.slice(start,end),ctx);return {ctx,get};
}
test('swaps stay in one network and bridges require different networks',async()=>{
 const {ctx,get}=setup();await ctx.openExchangeSection('swap');
 assert.equal(get('bridgeFromChain').value,get('bridgeToChain').value);
 assert.equal(get('bridgeToChain').disabled,true);assert.equal(get('exchangeDestinationNetwork').hidden,true);
 get('bridgeFromChain').value='arbitrum';ctx.syncExchangeNetworks();assert.equal(get('bridgeToChain').value,'arbitrum');
 await ctx.openExchangeSection('bridge');assert.notEqual(get('bridgeFromChain').value,get('bridgeToChain').value);
 assert.equal(get('bridgeToChain').disabled,false);
 get('bridgeFromChain').value='arbitrum';ctx.syncExchangeNetworks();assert.equal(get('bridgeToChain').value,'ethereum');
 assert.equal(ctx.exchangeChainsValid('swap',1,1),true);assert.equal(ctx.exchangeChainsValid('swap',1,2),false);
 assert.equal(ctx.exchangeChainsValid('bridge',1,1),false);assert.equal(ctx.exchangeChainsValid('bridge',1,2),true);
});
test('sections preserve separate amounts and tokens and discard old routes',async()=>{
 const {ctx,get}=setup();await ctx.openExchangeSection('swap');get('bridgeAmount').value='1.25';get('bridgeFromToken').value='ETH';
 await ctx.openExchangeSection('bridge');get('bridgeAmount').value='100';get('bridgeFromToken').value='USDC';ctx.bridgeRoutesByIdx=[{id:'old'}];
 await ctx.openExchangeSection('swap');assert.equal(get('bridgeAmount').value,'1.25');assert.equal(get('bridgeFromToken').value,'ETH');assert.equal(ctx.bridgeRoutesByIdx.length,0);
 await ctx.openExchangeSection('bridge');assert.equal(get('bridgeAmount').value,'100');assert.equal(get('bridgeFromToken').value,'USDC');
});
test('late network loading cannot overwrite a newer section',async()=>{
 const {ctx,get}=setup();let finish;ctx.loadRegistry=()=>new Promise(resolve=>finish=resolve);
 const first=ctx.openExchangeSection('swap');const resolveFirst=finish;
 const second=ctx.openExchangeSection('bridge');finish();await second;resolveFirst();await first;
 assert.equal(get('exchangeTitle').textContent,'Мосты между сетями');assert.notEqual(get('bridgeFromChain').value,get('bridgeToChain').value);
});
