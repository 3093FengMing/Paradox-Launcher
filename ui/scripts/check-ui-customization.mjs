// Final suite protocol; retained runtime/Original regressions use the current renderer seam.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {loadApp,suiteRenderHost} from './lib/hook-test-host.mjs';
import {bundle} from './lib/suite-test-fixtures.mjs';
import './check-ui-suite-model.mjs';
const require=createRequire(new URL('../package.json',import.meta.url));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const app=loadApp(new Map(),{isolateCustomization:false});
const {SuiteViewContext}=app('ui-suite/View.tsx');
const {customComponent}=app('customization/Customizable.tsx');
const replacements=(rows)=>({id,props,Original})=>rows[id]?React.createElement(rows[id],{...props,Original}):Original?React.createElement(Original,props):null;
await test('a TSX replacement can wrap Original while retaining current data and business callbacks',()=>{
 let originalProps,selected;
 const Original=props=>{originalProps=props;return React.createElement('button',{disabled:props.disabled,'aria-label':props.label,className:props.className},props.profile.name);};
 const Target=customComponent('component.regression-test',Original);
 const Replacement=({Original,...props})=>React.createElement('section',{className:'custom-template'},React.createElement(Original,{...props,className:'custom-control'}));
 const props={profile:{instance_key:'world-id',name:'My world 🌏'},disabled:true,label:'Accessible profile',onSelect:key=>selected=key};
 const markup=renderToStaticMarkup(React.createElement(SuiteViewContext.Provider,{value:replacements({'component.regression-test':Replacement})},React.createElement(Target,props)));
 assert.match(markup,/custom-template/);assert.match(markup,/custom-control/);assert.match(markup,/My world 🌏/);assert.equal(originalProps.onSelect,props.onSelect);assert.equal(originalProps.disabled,true);originalProps.onSelect(props.profile.instance_key);assert.equal(selected,'world-id');
});
await test('instance CSS-only override preserves the shared component structure',async()=>{
 const host=suiteRenderHost(), captured=[], selected=[], parents=new Map();
 const instance={kind:'business',target:'component.profile-card',identity:{namespace:'profile',value:'first'}};
 const current=bundle({
  'Shared.tsx':{encoding:'utf8',text:'export default function Card({Original,props}){return <section data-custom-card="true"><Original {...props}/></section>}'},
  'Instance.css':{encoding:'utf8',text:':scope{outline:3px solid rgb(35,90,160)}'},
 });
 current.manifest.overrides=[
  {selector:{kind:'type',target:'component.profile-card'},enabled:true,entry:'Shared.tsx',stylesheet:null},
  {selector:instance,enabled:true,entry:null,stylesheet:'Instance.css'},
 ];
 const registry=host.app('customization/ownership.ts');
 const {UiOwnerContext}=host.app('customization/context.ts');
 const Original=props=>{
  captured.push({props,frame:React.useContext(UiOwnerContext)});
  return React.createElement('button',{onClick:()=>props.onSelect(props.profile.instance_key)},props.profile.name);
 };
 const Target=host.app('customization/Customizable.tsx').customComponent('component.profile-card',Original);
 const {UiOwnerBoundary}=host.app('customization/runtime.tsx');
 const Instrumented=props=>{const frame=React.useContext(UiOwnerContext);parents.set(frame.ownerId,frame);return React.createElement(Target,props);};
 const releases=[];
 let detach,scope;
 const previousNode=globalThis.Node;
 try{
  const prepared=await host.compile(current);
  host.activate(prepared,await host.compile(bundle()));
  assert.equal(prepared.targetBindings[1].Component,undefined,'the narrower change really is CSS-only');
  const onSelect=key=>selected.push(key);
  const markup=host.render(React.createElement(React.Fragment,null,
   React.createElement(UiOwnerBoundary,{target:'component.regression-host',site:'i1:first',callKey:'first'},React.createElement(Instrumented,{profile:{instance_key:'first',name:'First stable instance'},onSelect})),
   React.createElement(UiOwnerBoundary,{target:'component.regression-host',site:'i1:second',callKey:'second'},React.createElement(Instrumented,{profile:{instance_key:'second',name:'Second stable instance'},onSelect})),
  ));
  assert.equal((markup.match(/data-custom-card="true"/g)||[]).length,2,'both instances retain the actual shared TSX wrapper');
  assert.match(markup,/First stable instance/);assert.match(markup,/Second stable instance/);
  assert.equal(captured.length,2);
  for(const {props} of captured){assert.equal(props.onSelect,onSelect);props.onSelect(props.profile.instance_key);}
  assert.deepEqual(selected,['first','second']);
  // SSR does not commit refs. Register the captured real Original owner frames
  // with attribute-only nodes, then exercise the product style/selector leases.
  const roots=captured.map(({frame})=>{
   const attributes=new Map();
   const root={contains:()=>false,getClientRects:()=>[],setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),getAttribute:key=>attributes.get(key)||''};
   assert.equal(frame.ownerIds.length,2);assert.equal(frame.stability,'stable');
   const parent=parents.get(frame.ownerIds[0]);
   const register=(value,target,parentOwnerId)=>registry.registerOwner({ownerId:value.ownerId,parentOwnerId,target,site:value.locator.calls.at(-1).site,locator:value.locator,stability:value.stability,roots:new Set(),metadata:{nameKey:null,type:'component',sourcePath:null,routeId:null},catalogPresentation:false,viewId:null,layerId:null});
   releases.push(register(parent,'component.regression-host',null));
   releases.push(register(frame,'component.profile-card',parent.ownerId));
   releases.push(registry.registerDom(root,{ownerIds:frame.ownerIds,rootOwnerIds:[],leafOwnerId:frame.ownerId}));
   return root;
  });
  let style;
  const document={nodeType:9,head:{append:value=>{style=value;}},createElement:()=>({dataset:{},remove(){}})};
  globalThis.Node={DOCUMENT_NODE:9};
  scope=registry.getSuiteStyleRoot('launcher.main');
  detach=host.app('ui-suite/prepared.ts').attachSuiteStyles(document,prepared,scope);
  registry.listOwners();
  const boundary=scope.resolveTarget(instance);
  const token=boundary.match(/data-ui-selector~="([^"]+)"/)[1];
  assert.ok(style.textContent.includes(boundary),'the actual stylesheet has the current instance boundary');
  assert.match(style.textContent,/outline:3px solid rgb\(35,90,160\)/);
  assert.ok(roots[0].getAttribute('data-ui-selector').split(' ').includes(token),'only the intended instance belongs to that CSS scope');
  assert.ok(!roots[1].getAttribute('data-ui-selector').split(' ').includes(token),'the sibling is excluded from the instance stylesheet');
 }finally{
  detach?.();scope?.dispose();releases.reverse().forEach(release=>release());host.dispose();
  if(previousNode===undefined)delete globalThis.Node;else globalThis.Node=previousNode;
 }
});
await test('each nested shared control receives its own replacement around Original',()=>{
 const Inner=customComponent('control.inner',()=>React.createElement('input',{defaultValue:'draft'}));
 const Outer=customComponent('control.outer',()=>React.createElement(Inner));
 const markup=renderToStaticMarkup(React.createElement(SuiteViewContext.Provider,{value:replacements({'control.outer':({Original,...props})=>React.createElement('section',{className:'outer'},React.createElement(Original,props)),'control.inner':({Original,...props})=>React.createElement('article',{className:'inner'},React.createElement(Original,props))})},React.createElement(Outer)));
 assert.match(markup,/class="outer"/);assert.match(markup,/class="inner"/);assert.match(markup,/value="draft"/);
});
await test('Original retains its owner when passed through another customized component',()=>{
 let originalProps;
 const Inner=customComponent('control.inner',({children})=>React.createElement('article',null,children));
 const Outer=customComponent('control.outer',props=>{originalProps=props;return React.createElement('button',{className:props.className},'Owned');});
 const callback=()=>{};
 const markup=renderToStaticMarkup(React.createElement(SuiteViewContext.Provider,{value:replacements({'control.outer':({Original,...props})=>React.createElement(Inner,null,React.createElement(Original,props)),'control.inner':({Original,...props})=>React.createElement(Original,props)})},React.createElement(Outer,{className:'caller',onClick:callback})));
 assert.match(markup,/<article/);assert.match(markup,/class="caller"/);assert.equal(originalProps.onClick,callback);
});
await test('HTML slots preserve original content and ui-prop escapes property text', () => {
  const { renderHtml } = app('customization/html.ts');
  let originalProps;
  const Original = (props) => {
    originalProps = props;
    return React.createElement(
      'button',
      { disabled: props.disabled, onClick: props.onClick, 'aria-label': props['aria-label'] },
      'Original button',
    );
  };
  const onClick = () => {};
  const props = {
    Original,
    disabled: true,
    onClick,
    'aria-label': 'Accessible original',
    profile: { name: '<img src=x onerror=alert(1)>' },
  };
  const nodes = [
    {
      tag: 'section',
      attributes: { class: 'my-template' },
      children: [
        { tag: 'ui-prop', attributes: { name: 'profile.name' }, children: [] },
        { tag: 'ui-slot', attributes: {}, children: [] },
      ],
    },
  ];
  const html = renderToStaticMarkup(
    React.createElement(React.Fragment, null, renderHtml(nodes, props, ['component.test'])),
  );
  assert.match(html, /class="my-template"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(!html.includes('<img'));
  assert.match(html, /Original button/);
  assert.match(html, /aria-label="Accessible original"/);
  assert.equal(originalProps.onClick, onClick);
  assert.equal(originalProps.disabled, true);
});

await test('library DOM boundaries scope only the library root and do not leak metadata', () => {
  const runtime = app('customization/jsx-runtime.tsx');
  const FakePopup = ({ children, ...props }) => React.createElement('section', props, children);
  let html = renderToStaticMarkup(
    runtime.jsx(FakePopup, {
      'data-ui-node': 'node.test.popup',
      'data-ui-dom-boundary': true,
      children: runtime.jsx('div', {
        'data-ui-node': 'node.test.heading',
        children: 'Library heading',
      }),
    }),
  );
  const root = html.match(/<section[^>]*>/)[0];
  const child = html.match(/<div[^>]*>/)[0];
  assert.match(root, /data-ui-root-target="[^"]*node\.test\.popup/);
  const childRoots = child.match(/data-ui-root-target="([^"]*)"/)?.[1] ?? '';
  assert.ok(!childRoots.split(' ').includes('node.test.popup'));
  assert.ok(!html.includes('data-ui-dom-boundary'));
  const Application = ({ children }) => runtime.jsx('section', { children });
  html = renderToStaticMarkup(
    runtime.jsx(Application, {
      'data-ui-node': 'node.test.application',
      children: 'Application content',
    }),
  );
  assert.match(
    html.match(/<section[^>]*>/)[0],
    /data-ui-root-target="[^"]*node\.test\.application/,
  );
});

await test('target CSS scopes selectors and root shorthand without corrupting animation keyframes', () => {
  const { compileCss } = app('customization/css.ts');
  const css = compileCss(
    ':scope { color: #a78bfa; } .profile-info h3::before { content: "title"; }',
    'component.profile-card',
  );
  assert.match(css, /data-ui-root-target/);
  assert.match(css, /component\.profile-card/);
  assert.match(css, /::before/);
  const shorthand = compileCss('& { border-radius: 20px; }', 'component.profile-card');
  assert.ok(
    !shorthand.includes('&'),
    'top-level & must resolve to the target rather than a dangling nesting selector',
  );
  const animation = compileCss(
    '@keyframes fade { 0% { opacity: 0; } 100% { opacity: 1; } } .profile-card { animation: fade 1s; }',
    'component.profile-card',
  );
  assert.match(animation, /0%\{opacity:0\}/);
  assert.match(animation, /100%\{opacity:1\}/);
  assert.ok(
    !animation.includes('0%:where'),
    'animation steps cannot contain target selector attributes',
  );
  assert.throws(() => compileCss('@import "https://example.com/theme.css";'));
  assert.throws(() => compileCss('.profile-card { color: definitely-invalid; }'));
  assert.throws(() => compileCss('.profile-card { color: red; '));
});

console.log(
  'UI customization regression covers strict format, byte limits, persistence, recovery, original callbacks, HTML slots and scoped CSS.',
);
