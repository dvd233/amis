import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {matchesSdkFactory,matchesSdkRender} from './contract.mjs';
import {packageMetadata} from './package-metadata.mjs';
const root=path.resolve(import.meta.dirname,'..');
const source=path.resolve(process.argv[2]), variant=process.argv[3], out=path.join(root,'results');
const require=createRequire(path.join(source,'package.json'));
const {parse}=require('@babel/parser');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourceRecord=JSON.parse(fs.readFileSync(path.join(out,'source-post.json')));
assert.equal(sourceRecord.variant,variant);
const sdk=path.join(source,'packages/amis/sdk');
const inventory={}, modules={};
const entries=fs.readdirSync(sdk,{recursive:true,withFileTypes:true}).filter(x=>x.isFile()).map(x=>path.relative(sdk,path.join(x.parentPath??x.path,x.name))).sort();
for(const name of entries) {
  const bytes=fs.readFileSync(path.join(sdk,name));
  inventory[name]={sha256:hash(bytes),bytes:bytes.length};
  if(!name.endsWith('.js')) continue;
  const text=bytes.toString('utf8');
  const wanted=[];
  if(text.includes('CityArea-popup')) wanted.push('CityArea');
  if(matchesSdkFactory('InputCity',text)) wanted.push('InputCity');
  if(!wanted.length) continue;
  const ast=parse(text,{sourceType:'unambiguous'});
  function visit(node) {
    if(!node || typeof node!=='object') return;
    if(node.type==='CallExpression' && node.arguments[0]?.type==='StringLiteral' &&
       ['FunctionExpression','ArrowFunctionExpression'].includes(node.arguments[1]?.type)) {
      const factory=node.arguments[1], code=text.slice(factory.start,factory.end);
      for(const label of wanted) {
        const match=matchesSdkFactory(label,code);
        if(match) {
          assert.equal(modules[label],undefined,`Ambiguous SDK module: ${label}`);
          const renders=[];
          function findRender(node) {
            if(!node || typeof node!=='object') return;
            if(node!==factory && ['FunctionExpression','ArrowFunctionExpression'].includes(node.type) && matchesSdkRender(label,text.slice(node.start,node.end))) renders.push({start:node.start,end:node.end});
            for(const value of Object.values(node)) if(Array.isArray(value)) value.forEach(findRender); else if(value && typeof value==='object') findRender(value);
          }
          findRender(factory);renders.sort((a,b)=>(a.end-a.start)-(b.end-b.start));
          assert.ok(renders.length,`Missing exact inner ${label} render`);
          assert.ok(renders.length===1 || renders[0].end-renders[0].start < renders[1].end-renders[1].start,`Ambiguous inner ${label} render`);
          const render={...renders[0],sha256:hash(text.slice(renders[0].start,renders[0].end))};
          modules[label]={file:name,id:node.arguments[0].value,start:factory.start,end:factory.end,sha256:hash(code),render};
          fs.writeFileSync(path.join(out,`${label}.sdk-render.js`),text.slice(render.start,render.end));
          fs.writeFileSync(path.join(out,`${label}.sdk-module.js`),code);
        }
      }
      return;
    }
    for(const value of Object.values(node)) if(Array.isArray(value)) value.forEach(visit); else if(value && typeof value==='object') visit(value);
  }
  visit(ast);
}
assert.deepEqual(Object.keys(modules).sort(),['CityArea','InputCity']);
for(const name of ['sdk.js','sdk.css','helper.css']) assert.ok(inventory[name],`Missing native SDK asset: ${name}`);
const css=fs.readFileSync(path.join(sdk,'sdk.css'),'utf8');
for(const selector of ['.cxd-CityArea','.cxd-PopUp','.cxd-PickerColumns-columnWrapper']) assert.ok(css.includes(selector),`Missing native CSS selector: ${selector}`);
const anchors={};
for(const name of ['packages/amis-ui/src/components/CityArea.tsx','packages/amis/src/renderers/Form/InputCity.tsx','packages/amis-ui/src/components/CityDB.ts','packages/amis-ui/lib/components/CityArea.js','packages/amis/lib/renderers/Form/InputCity.js','packages/amis-ui/lib/themes/cxd.css','packages/amis-ui/scss/components/_popup.scss','packages/amis-ui/scss/components/_picker-columns.scss','fis-conf.js','packages/amis/build.sh','examples/embed.tsx','examples/loader.ts','scripts/embed-packager.js']) anchors[name]=hash(fs.readFileSync(path.join(source,name)));
const dependencies={},dependencyManifests={};
for(const name of ['react','react-dom','@babel/parser','typescript','rollup','fis3','fis-parser-sass','fis-optimizer-terser','mobx','mobx-react','mobx-state-tree','react-transition-group']) {
  const metadata=packageMetadata(name,require,source);
  dependencies[name]=metadata.version;dependencyManifests[name]=metadata;
}
for(const name of ['amis-formula','amis-core','amis-ui','amis']) assert.equal(fs.realpathSync(path.join(source,'node_modules',name)),path.join(source,'packages',name),'Workspace must resolve to this checkout');
fs.writeFileSync(path.join(out,'build.json'),JSON.stringify({
  ...sourceRecord,completedAt:new Date().toISOString(),nativeCommands:['npm run build --workspace amis-formula','npm run build --workspace amis-core','npm run build --workspace amis-ui','npm run build --workspace amis'],
  inventory,modules,anchors,dependencies,dependencyManifests,
  sourceMaps:'Native SDK intentionally strips source maps. Exact native SDK module ranges and SHA-256, native source/lib hashes, V8 execution coverage and first-stack-frame offsets provide direct build/runtime binding without modifying source.'
},null,2)+'\n');
console.log(JSON.stringify({variant,modules,sdkAssets:entries.length,dependencies},null,2));
