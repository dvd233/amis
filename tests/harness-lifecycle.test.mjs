// Harness-only SDK lifecycle fixtures. These do not test or replace real AMIS UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const app=fs.readFileSync(path.resolve(import.meta.dirname,'../harness/app.js'),'utf8');
function setup({earlyReady=false,invalidUpdate=false}={}) {
  const frames=[],root={},evidence={},state={form:null,calls:0},returned={updateProps:invalidUpdate?null:()=>{},updateSchema:()=>{},unmount:()=>{}};
  let ready,props,env;
  const context={window:{},document:{querySelector:selector=>selector==='#root'?root:evidence},
    MutationObserver:class {observe(){}},requestAnimationFrame:fn=>frames.push(fn),
    amisRequire:name=>{assert.equal(name,'amis/embed');return {embed:(target,schema,p,e,callback)=>{
      assert.equal(target,'#root');assert.equal(schema.type,'form');assert.equal(schema.body[0].type,'input-city');
      props=p;env=e;ready=callback;
      if(earlyReady) {returned.getComponentByName=()=>state.form;ready();}
      return returned;
    }}}};
  vm.runInNewContext(app,context);
  const tick=()=>{assert.ok(frames.length);frames.shift()();};
  const register=()=>state.form={props:{mobileUI:true},getValues:()=>({address:500101})};
  return {context,returned,state,tick,register,ready:()=>ready(),props:()=>props,env:()=>env,mount:()=>context.window.mountCity({value:500101,props:{}}),read:()=>context.window.readCity()};
}
test('does not call Scoped API before embed scope callback; then waits for Form registration',()=>{
  const f=setup();f.mount();assert.equal(f.read().sdkReady,false);
  f.tick();assert.equal(f.read().data,null); // Old harness threw here.
  f.returned.getComponentByName=name=>{f.state.calls++;assert.equal(name,'cityForm');return f.state.form;};
  assert.equal(f.state.calls,0);f.ready();assert.equal(f.read().sdkReady,true);
  f.tick();assert.equal(f.read().data,null); // Callback does not mean Form is mounted.
  f.register();f.tick();assert.equal(f.read().data.address,500101);assert.equal(f.read().mobileUI,true);
});
test('supports scope callback before embed returns, without using the unassigned handle',()=>{
  const f=setup({earlyReady:true});f.mount();assert.equal(f.read().sdkReady,true);
  f.register();f.tick();assert.equal(f.read().data.address,500101);
});
test('missing or malformed APIs after declared readiness still fail',()=>{
  const f=setup();f.mount();assert.throws(()=>f.ready(),/did not expose getComponentByName/);
  f.returned.getComponentByName=()=>({});f.ready();assert.throws(()=>f.read(),/does not expose getValues/);
  f.returned.getComponentByName=null;assert.throws(()=>f.read(),/lost getComponentByName/);
  assert.throws(()=>setup({invalidUpdate:true}).mount(),/did not expose updateProps/);
});
test('public Form change callback still records actual data and feeds updateProps',()=>{
  const f=setup({earlyReady:true});f.mount();f.register();let updated;
  f.returned.updateProps=props=>{updated=props;};
  f.props().onChange({address:'500229'},{address:'500229'});
  assert.equal(f.read().formChanges[0].data.address,'500229');
  assert.equal(f.read().controlledUpdates,1);assert.equal(updated.data.address,'500229');
});
