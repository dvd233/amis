import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,scenarios,summarize,stackLocation,matchesSdkFactory,matchesSdkRender,requireRenderCoverage,verifyBaselineConfirmation} from '../scripts/contract.mjs';
const good = {variant:'candidate',scenario:scenarios[0],phase:'initial',observed:false,errors:[],infraErrors:[],uiPassed:true,mobileProven:true,coverageProven:true};
test('candidate never becomes green from baseline failures',()=>{
  assert.equal(classify(good),'passed');
  assert.throws(()=>classify({...good,errors:[{knownCityAreaMapError:true}]}));
});
test('baseline needs exact observed failure at exact stage',()=>{
  const red={...good,variant:'baseline',observed:true,errors:[{knownCityAreaMapError:true}],uiPassed:false};
  assert.equal(classify(red),'expected-baseline-regression');
  for(const change of [{errors:[]},{errors:[{knownCityAreaMapError:false}]},{observed:false},{phase:'confirm'},{mobileProven:false},{coverageProven:false},{infraErrors:['404']}]) assert.throws(()=>classify({...red,...change}));
});
test('control failure is never expected',()=>assert.throws(()=>classify({...good,variant:'baseline',scenario:scenarios[3],errors:[{knownCityAreaMapError:true}]})));
test('every case must exist once with its actual required outcome',()=>{
  const entries=scenarios.map(x=>({id:x.id,status:'passed'}));
  assert.equal(summarize('candidate',entries).total,14);
  assert.throws(()=>summarize('candidate',entries.slice(1)));
  assert.throws(()=>summarize('baseline',entries));
});
test('error map binds first stack frame and exact SDK module offsets',()=>{
  const modules={CityArea:{file:'sdk.js',start:4,end:15}};
  const assets=new Map([['sdk.js','abcd\n0123456789rest']]);
  assert.equal(stackLocation('TypeError\n    at update (http://127.0.0.1:123/sdk/sdk.js:2:3)','http://127.0.0.1:123',modules,assets).offset,7);
  for(const stack of ['TypeError\n    at wrong (http://evil.test/sdk/sdk.js:2:3)','TypeError\n    at wrong (http://127.0.0.1:123/sdk/sdk.js:1:1)','TypeError\n    at app (http://127.0.0.1:123/harness/app.js:2:3)\n    at update (http://127.0.0.1:123/sdk/sdk.js:2:3)']) assert.equal(stackLocation(stack,'http://127.0.0.1:123',modules,assets),null);
});

test('native default-import/minified renderer signatures do not require a named CityArea export',()=>{
  const render='function(){const {mobileUI,allowDistrict,extractValue,env}=this.props;return mobileUI?jsx(alias.default,{allowDistrict,extractValue,popOverContainer:env.getModalContainer,onChange:this.handleChange}):jsx(desktop,{});}';
  assert.equal(render.includes('.CityArea'),false);
  assert.equal(matchesSdkRender('InputCity',render),true);
  assert.equal(matchesSdkFactory('InputCity',render+';register({type:"input-city"})'),true);
  assert.equal(matchesSdkFactory('InputCity','register({type:"input-city",getComponent:()=>load()})'),false);
  assert.equal(matchesSdkRender('InputCity','function(){const {allowDistrict,extractValue}=this.props;return desktop();}'),false);
});

test('executed class IIFE cannot substitute for an unexecuted inner renderer',()=>{
  const module={start:0,end:1000,render:{start:100,end:300}};
  const outer={ranges:[{startOffset:10,endOffset:900,count:5}]};
  const inner=count=>({ranges:[{startOffset:100,endOffset:300,count}]});
  assert.throws(()=>requireRenderCoverage(module,[outer]));
  assert.throws(()=>requireRenderCoverage(module,[outer,inner(0)]));
  assert.equal(requireRenderCoverage(module,[outer,inner(1)]).ranges[0].count,1);
});

function confirmationFixture() {
  const scenario=scenarios.find(x=>x.id==='controlled-roundtrip');
  const before={state:{errors:[],data:{address:500101},rendererEvents:[],formChanges:[],controlledUpdates:0},dom:{label:scenario.label,columns:[{selected:'重庆市',options:34},{selected:'城口县',options:20},{selected:null,options:0}]}};
  const after={errors:[{message:'fixture runtime error; bound identity is checked separately by classifier'}],rendererEvents:['500229'],formChanges:[],controlledUpdates:0,data:null};
  return {scenario,before,after};
}
test('baseline confirmation requires real pre-confirm state and one exact new renderer event, without inventing a Form callback',()=>{
  const {scenario,before,after}=confirmationFixture();
  const proof=verifyBaselineConfirmation(before,after,scenario,'500229','城口县');
  assert.equal(proof.formCallbacksObserved,0);assert.equal(proof.externalFeedbackCalls,0);
  after.formChanges=[{data:{address:'500229'}}];after.controlledUpdates=1;
  assert.equal(verifyBaselineConfirmation(before,after,scenario,'500229','城口县').formCallbacksObserved,1);
});
test('baseline confirmation rejects corrupted pre-state, event, crash and callback evidence',()=>{
  for(const corrupt of [
    f=>f.before.state.errors.push({message:'earlier error'}),
    f=>f.before.state.data.address=500230,
    f=>f.before.dom.label='wrong label',
    f=>f.before.dom.columns.pop(),
    f=>f.before.dom.columns[1].selected='丰都县',
    f=>f.before.dom.columns[2].options=1,
    f=>f.after.rendererEvents=[],
    f=>f.after.rendererEvents=['500230'],
    f=>f.after.rendererEvents=['500229','500229'],
    f=>f.after.errors=[],
    f=>{f.after.formChanges=[{data:{address:'500230'}}];f.after.controlledUpdates=1;},
    f=>f.after.controlledUpdates=1
  ]) {
    const f=confirmationFixture();corrupt(f);
    assert.throws(()=>verifyBaselineConfirmation(f.before,f.after,f.scenario,'500229','城口县'));
  }
});
