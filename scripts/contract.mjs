import assert from 'node:assert/strict';
export const scenarios = [
  {id:'initial-chengkou',value:500229,label:'重庆市,城口县',regression:'initial'},
  {id:'initial-fengdu',value:'500230',label:'重庆市,丰都县',regression:'initial'},
  {id:'initial-xiantao',value:'429004',label:'湖北省,仙桃市',regression:'initial'},
  {id:'ordinary-beijing',value:110101,label:'北京市,北京市市辖区,东城区'},
  {id:'ordinary-shanghai',value:310101,label:'上海市,上海市市辖区,黄浦区'},
  {id:'ordinary-wanzhou',value:500101,label:'重庆市,重庆市市辖区,万州区'},
  {id:'ordinary-chengdu',value:510104,label:'四川省,成都市,锦江区'},
  {id:'controlled-roundtrip',value:500101,label:'重庆市,重庆市市辖区,万州区',regression:'confirm'},
  {id:'cancel-overlay-reopen',value:500101,label:'重庆市,重庆市市辖区,万州区'},
  {id:'cross-province',value:510104,label:'四川省,成都市,锦江区',regression:'confirm'},
  {id:'city-only',value:500229,label:'重庆市,城口县',props:{allowCity:true,allowDistrict:false},columns:2,result:'500229'},
  {id:'province-only',value:500229,label:'重庆市',props:{allowCity:false,allowDistrict:false},columns:1,result:'500000'},
  {id:'district-without-city',value:500229,label:'重庆市,城口县',props:{allowCity:false,allowDistrict:true},columns:1,result:'500229'},
  {id:'structured-roundtrip',value:{code:500101,provinceCode:500000,province:'重庆市',cityCode:500100,city:'重庆市市辖区',districtCode:500101,district:'万州区',street:''},label:'重庆市,重庆市市辖区,万州区',props:{extractValue:false},regression:'confirm'}
];
export function structured(code, city, provinceCode=500000, province='重庆市') {
  return {code,provinceCode,province,cityCode:code,city,street:''};
}
export function classify({variant, scenario, phase, observed, errors, infraErrors, uiPassed, mobileProven, coverageProven}) {
  assert.equal(infraErrors.length,0,'Infrastructure or unrelated browser error');
  assert.equal(mobileProven,true,'Real mobile renderer not proven');
  assert.equal(coverageProven,true,'Native CityArea and InputCity execution not proven');
  if (variant === 'baseline' && scenario.regression) {
    assert.equal(phase,scenario.regression,'Crash at wrong stage');
    assert.ok(errors.length > 0,'Baseline must actually reproduce the CityArea error');
    assert.ok(errors.every(e => e.knownCityAreaMapError === true),'Unrelated error must not be accepted');
    assert.equal(observed,true,'Baseline observation incomplete');
    return 'expected-baseline-regression';
  }
  assert.equal(errors.length,0,'Unexpected runtime error');
  assert.equal(uiPassed,true,'UI assertions did not all pass');
  return 'passed';
}
export function summarize(variant, entries) {
  assert.equal(entries.length, scenarios.length,'Incomplete scenario set');
  assert.deepEqual(entries.map(x=>x.id),scenarios.map(x=>x.id),'Scenario order/identity mismatch');
  for (let i=0;i<entries.length;i++) {
    assert.equal(entries[i].status, variant==='baseline' && scenarios[i].regression ? 'expected-baseline-regression' : 'passed');
  }
  return {completed:true,total:entries.length,passed:entries.filter(x=>x.status==='passed').length,
    expectedBaselineRegressions:entries.filter(x=>x.status==='expected-baseline-regression').length};
}
export function stackLocation(stack, origin, modules, assets) {
  // Require the actual first stack frame to belong to the freshly-built CityArea module.
  const frame = String(stack).split('\n').find(line => /^\s*at\s/.test(line));
  if (!frame) return null;
  const match = frame.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)\)?$/);
  if (!match || !match[1].startsWith(origin+'/sdk/')) return null;
  const file = decodeURIComponent(new URL(match[1]).pathname.slice('/sdk/'.length));
  const text = assets.get(file);
  if (text === undefined) return null;
  const line = +match[2], column = +match[3];
  const lines = text.split('\n');
  if (line < 1 || line > lines.length || column < 1) return null;
  const offset = lines.slice(0,line-1).reduce((n,s)=>n+s.length+1,0)+column-1;
  const module = modules.CityArea;
  if (module.file!==file || offset<module.start || offset>=module.end) return null;
  return {file,line,column,offset,excerpt:text.slice(Math.max(module.start,offset-80),Math.min(module.end,offset+100))};
}
// Signatures match both native Rollup's default-import bindings and FIS/Terser
// output. Do not depend on a .CityArea named export: native lib uses default.
export function matchesSdkFactory(name,code) {
  return name==='CityArea' ? code.includes('CityArea-popup') :
    ['input-city','mobileUI','allowDistrict','extractValue','getModalContainer','handleChange'].every(x=>code.includes(x));
}
export function matchesSdkRender(name,code) {
  return name==='CityArea' ? code.includes('CityArea-popup') :
    ['mobileUI','allowDistrict','extractValue','getModalContainer','handleChange'].every(x=>code.includes(x));
}
export function requireRenderCoverage(module,functions) {
  assert.ok(module.render,'Build must bind an exact inner render function before execution');
  const match=functions.find(f=>f.ranges[0]?.startOffset===module.render.start && f.ranges[0]?.endOffset===module.render.end);
  assert.ok(match && match.ranges[0].count>0,'Exact native inner render function did not execute');
  return match;
}
