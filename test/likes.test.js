import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLikeController} from '../public/likes.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('likes update immediately and collapse an even number of rapid clicks without a write',async()=>{
  const calls=[],changes=[];
  const controller=createLikeController({send:async(id,liked)=>{calls.push({id,liked});return {id,liked,like_count:1};},onChange:value=>changes.push(value),delay:10000});
  controller.observe('paint',0,false);controller.toggle('paint');
  assert.deepEqual(controller.get('paint'),{id:'paint',liked:true,count:1,pending:true});
  controller.toggle('paint');await controller.flush('paint');assert.equal(calls.length,0);assert.equal(controller.get('paint').count,0);assert.equal(controller.pending,false);
  assert.equal(changes[0].liked,true);controller.reset();
});
test('likes serialize writes and converge on the latest click without count flicker',async()=>{
  const writes=[],first=deferred(),second=deferred();
  const controller=createLikeController({send:(id,liked)=>{writes.push(liked);return writes.length===1?first.promise:second.promise;},delay:10000});
  controller.observe('paint',4,false);controller.toggle('paint');const flight=controller.flush('paint');
  controller.toggle('paint');assert.equal(controller.get('paint').count,4);assert.deepEqual(writes,[true]);
  first.resolve({id:'paint',liked:true,like_count:5});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(writes,[true,false]);assert.equal(controller.get('paint').liked,false);assert.equal(controller.get('paint').count,4);
  second.resolve({id:'paint',liked:false,like_count:4});await flight;assert.equal(controller.pending,false);assert.equal(controller.get('paint').count,4);controller.reset();
});
test('failed likes roll back to the last confirmed state and can be retried',async()=>{
  let fail=true;const errors=[];
  const controller=createLikeController({send:async(id,liked)=>{if(fail)throw new Error('Offline');return {id,liked,like_count:8};},onError:error=>errors.push(error.message),delay:10000});
  controller.observe('paint',7,false);controller.toggle('paint');await controller.flush('paint');
  assert.deepEqual(controller.get('paint'),{id:'paint',liked:false,count:7,pending:false});assert.deepEqual(errors,['Offline']);
  fail=false;controller.toggle('paint');await controller.flush('paint');assert.equal(controller.get('paint').count,8);assert.equal(controller.get('paint').liked,true);controller.reset();
});
test('stale reads and late mutations from a previous account cannot overwrite current intent',async()=>{
  const response=deferred(),changes=[];
  const controller=createLikeController({send:()=>response.promise,onChange:value=>changes.push(value),delay:10000});
  controller.observe('paint',2,false);const oldRead=controller.revision;controller.toggle('paint');const flight=controller.flush('paint');
  controller.observe('paint',0,false,oldRead);assert.equal(controller.get('paint').count,3);
  controller.reset();controller.observe('paint',12,true);response.resolve({id:'paint',liked:true,like_count:3});await flight;
  assert.equal(controller.get('paint').count,12);assert.equal(controller.get('paint').liked,true);controller.reset();
});
test('completed mutations reject older catalog responses and validate server results',async()=>{
  const errors=[];let valid=true;
  const controller=createLikeController({send:async(id,liked)=>valid?{id,liked,like_count:5}:{id,liked,like_count:-1},onError:error=>errors.push(error.message),delay:10000});
  controller.observe('paint',4,false);const read=controller.revision;controller.toggle('paint');await controller.flush('paint');
  assert.equal(controller.observe('paint',4,false,read).count,5);assert.equal(controller.get('paint').liked,true);
  valid=false;controller.toggle('paint');await controller.flush('paint');assert.equal(controller.get('paint').liked,true);assert.match(errors[0],/Invalid like response/);controller.reset();
});
