const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const s=fs.readFileSync('frontend/app.js','utf8');
const start=s.indexOf('  function parseEtherscanTransactions(');
const end=s.indexOf('\n  async function fetchTxs',start);
const ctx=vm.createContext({});vm.runInContext(s.slice(start,end),ctx);
const parse=ctx.parseEtherscanTransactions;
test('returns successful and genuinely empty history',()=>{
 const list=[{hash:'0x123'}];assert.equal(parse({status:'1',result:list}),list);
 assert.equal(parse({status:'0',message:'No transactions found',result:[]}).length,0);
 assert.equal(parse({status:'0',message:'NOTOK',result:'No transactions found'}).length,0);
});
test('NOTOK exposes actionable reason rather than generic status',()=>{
 for(const [result,pattern] of [
  ['Invalid API Key',/Неверный API-ключ/],
  ['Free API access is not supported for this chain. Please upgrade your api plan for full chain coverage.',/Тариф Etherscan/],
  ['Max rate limit reached',/ограничил число запросов/],
  ['Query Timeout occurred',/Query Timeout/],
 ])assert.throws(()=>parse({status:'0',message:'NOTOK',result}),pattern);
});
test('malformed and failure payloads are not treated as empty history',()=>{
 for(const payload of [null,{}, {status:'0',message:'NOTOK',result:[]}, {status:'1',result:'oops'}]){
  assert.throws(()=>parse(payload));
 }
});
