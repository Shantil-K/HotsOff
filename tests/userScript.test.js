// Unit tests for the HotsOff user script. Run: node tests/userScript.test.js
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const path=require('path');
const src=fs.readFileSync(process.argv[2]||path.join(__dirname,'..','resources','hotstar','webOSUserScripts','userScript.js'),'utf8');
// ES5 syntax check
new vm.Script(src);
if (/=>|\blet\b|\bconst\b|`/.test(src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,''))) throw new Error('non-ES5 syntax');

// Minimal XHR mock with accessor props on the prototype (like modern Chromium)
function XHR(){ this._state=0; }
XHR.prototype.open=function(m,u){ this.openedUrl=u; this._state=1; };
XHR.prototype.send=function(b){ this.sentBody=b; };
['responseText','response','responseType','readyState'].forEach(n=>{
  Object.defineProperty(XHR.prototype,n,{configurable:true,get(){ return n==='readyState'?this._state:(n==='responseType'?(this._type||''):(n==='response'&&this._type==='json'?this._json:this._text)); }});
});
const store={}; const ls={get length(){return Object.keys(store).length},key:i=>Object.keys(store)[i],getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}};
store.caps=JSON.stringify({value:{clientCapabilities:{ads:["non_ssai","ssai"],package:["dash"]}}});
let fetched=[];
const win={location:{hostname:'livingroom.hotstar.com',protocol:'https:',host:'livingroom.hotstar.com'},
  XMLHttpRequest:XHR, localStorage:ls, sessionStorage:{getItem(){return null},setItem(){},length:0},
  navigator:{sendBeacon:()=> 'orig'}, console,
  Response:global.Response, Request:global.Request,
  fetch:(i,init)=>{fetched.push([i,init]); const url=typeof i==='string'?i:i.url;
    if(url.includes('vast')) return Promise.resolve(new Response('<?xml version="1.0"?><VAST version="3.0"><Ad id="1"><InLine/></Ad></VAST>',{headers:{'content-type':'application/xml'}}));
    return Promise.resolve(new Response(JSON.stringify({ssai_tag:"abc"}),{headers:{'content-type':'application/json'}}));}};
win.window=win;
vm.runInNewContext(src,Object.assign(win,{Promise,JSON,Array,Object,String,Number,decodeURIComponent,encodeURIComponent}));
const H=win.__HOTSOFF__, I=H.internal;

// URL rewrite
const caps=encodeURIComponent(JSON.stringify({ads:["non_ssai","ssai"],container:["fmp4"]}));
const u=I.rewriteUrl('/api/internal/bff/v2/slugs/in/watch?client_capabilities='+caps+'&x=1#h');
const got=JSON.parse(decodeURIComponent(u.split('client_capabilities=')[1].split('&')[0]));
assert.deepStrictEqual(got.ads,["non_ssai"]); assert(u.endsWith('&x=1#h'));
assert.strictEqual(I.rewriteUrl('/a?b=1'),'/a?b=1');
// ssai-only -> non_ssai
assert.deepStrictEqual(JSON.parse(I.fixCapsString('{"client_capabilities":{"ads":["ssai"]}}')).client_capabilities.ads,["non_ssai"]);
// storage fixed
assert.deepStrictEqual(JSON.parse(store.caps).value.clientCapabilities.ads,["non_ssai"]);

// Response sanitize
const resp={success:{page:{spaces:{tray:{widget_wrappers:[
  {template:"DisplayAdContainerWidget",widget:{}},{template:"HorizontalContentPosterWidget",widget:{data:{}}}]}},
  player:{data:{player_config:{media_asset_v2:{}},live_stream_ad:{ssai_tag:"x"},
   interventions:[{event_time_s:0,meta:{preroll:{url:"vast"}}},{event_time_s:300,meta:{midroll:{}}},{event_time_s:900,meta:{action_handler:{a:1}}},{event_time_s:5,meta:{midroll:{},compose_display:{}}}],
   user:{ssaiTag:"tag1"}},"web.playback.enableSSAI":"true"}}}};
const out=JSON.parse(I.transformText('https://livingroom.hotstar.com/api/internal/bff/v2/page',JSON.stringify(resp)));
const ww=out.success.page.spaces.tray.widget_wrappers; assert.strictEqual(ww.length,1); assert.strictEqual(ww[0].template,"HorizontalContentPosterWidget");
const d=out.success.page.player.data; assert.strictEqual(d.live_stream_ad,null); assert.strictEqual(d.user.ssaiTag,"");
assert.deepStrictEqual(d.interventions.map(x=>x.event_time_s),[900,5]); assert.deepStrictEqual(Object.keys(d.interventions[1].meta),["compose_display"]);
assert.strictEqual(out.success.page.player["web.playback.enableSSAI"],"false");
// unchanged JSON -> null; non hotstar json untouched
assert.strictEqual(I.transformText('https://livingroom.hotstar.com/x','{"a":1}'),null);
assert.strictEqual(I.transformText('https://example.com/x','{"ssai_tag":"a"}'),null);
// VAST / VMAP
assert(/<VAST version="4.0"><\/VAST>/.test(I.transformText('https://ads.x/vast','<?xml version="1.0"?><VAST version="3.0"><Ad id="1"></Ad></VAST>')));
assert(/VMAP/.test(I.transformText('https://ads.x/v','<vmap:VMAP xmlns:vmap="x" version="1.0"><vmap:AdBreak/></vmap:VMAP>')));
assert.strictEqual(I.transformText('https://x/manifest.mpd','<?xml version="1.0"?><MPD></MPD>'),null);


// v0.2: pause ad + upgrade nav
const page2={success:{player:{data:{event_interventions:[
   {event_name:"DELAYED_PAUSE_FOR_ADS",meta:{compose_display:{operation:{add_widget:{widget:{widget_url:"/v2/pages/watch/pause-ad?x=1"}}}}}},
   {event_name:"RESUME",meta:{compose_display:{operation:{remove_widget:{widget:{widget_data:{template:"DisplayAdContainerWidget"}}}}}}},
   {event_name:"FORCE_REFRESH_EVENT",meta:{refresh:{a:1}}},
   {event_name:"INACTIVITY_DETECTED",meta:{action_handler:{x:1}}}]}},
  nav:{menu_items:[{title:"Upgrade",default_icon:"i",actions:{on_click:[{page_navigation:{page_url:"/subscribe"}}]}},
    {title:"Home",default_icon:"h",actions:{}},{title:"Search",default_icon:"s",actions:{}}]},
  header:{widget_wrappers:[{template:"SubscriptionNudgeWidget",widget:{}},{template:"LogoWidget",widget:{}}]},
  content:{items:[{title:"Upgrade",description:"a movie called Upgrade",content_id:1}]}}};
const o2=JSON.parse(I.transformText('https://livingroom.hotstar.com/api/internal/bff/v2/pages/watch',JSON.stringify(page2)));
assert.deepStrictEqual(o2.success.player.data.event_interventions.map(x=>x.event_name),["FORCE_REFRESH_EVENT","INACTIVITY_DETECTED"]);
assert.deepStrictEqual(o2.success.nav.menu_items.map(x=>x.title),["Home","Search"]);
assert.deepStrictEqual(o2.success.header.widget_wrappers.map(x=>x.template),["LogoWidget"]);
assert.strictEqual(o2.success.content.items.length,1, 'movie titled Upgrade must stay');

// XHR hook end-to-end
const x=new win.XMLHttpRequest(); x.open('GET','/api/internal/bff/v2/watch?client_capabilities='+caps);
assert(!x.openedUrl.includes('%22ssai%22') && x.openedUrl.includes('non_ssai'), 'xhr url rewritten');
x.send(null); x._text=JSON.stringify({ssai_tag:"zz"}); x._state=4;
assert.strictEqual(JSON.parse(x.responseText).ssai_tag,""); assert.strictEqual(JSON.parse(x.response).ssai_tag,"");
const xj=new win.XMLHttpRequest(); xj.open('GET','/api/internal/bff/x'); xj.send(); xj._type='json'; xj._json={ssai_tag:"q"}; xj._state=4;
assert.strictEqual(xj.response.ssai_tag,"");
const xt=new win.XMLHttpRequest(); xt.open('POST','https://ingress.ap1.rum-ingress-coralogix.com/browser/v1beta/logs'); assert(xt.openedUrl.includes('127.0.0.1:9'));
const xp=new win.XMLHttpRequest(); xp.open('POST','/api/internal/bff/play'); xp.send('{"client_capabilities":{"ads":["non_ssai","ssai"]}}'); assert.strictEqual(xp.sentBody,'{"client_capabilities":{"ads":["non_ssai"]}}');
// beacon
assert.strictEqual(win.navigator.sendBeacon('https://www.googletagmanager.com/x'),true);
assert.strictEqual(win.navigator.sendBeacon('https://livingroom.hotstar.com/y'),'orig');

(async()=>{
  const r=await win.fetch('https://livingroom.hotstar.com/api/internal/bff/v2/watch?client_capabilities='+caps);
  assert.strictEqual((await r.json()).ssai_tag,"");
  assert(!fetched[0][0].includes('%22ssai%22'));
  const v=await win.fetch('https://adserver.example/vast?x'); assert(/<VAST version="4.0"><\/VAST>/.test(await v.text()));
  const t=await win.fetch('https://cdn.rum-ingress-coralogix.com/x'); assert.strictEqual(t.status,204);
  const p=await win.fetch('/api/internal/bff/play',{method:'POST',body:'{"client_capabilities":{"ads":["ssai","non_ssai"]}}'});
  assert.strictEqual(fetched[fetched.length-1][1].body,'{"client_capabilities":{"ads":["non_ssai"]}}');
  console.log('ALL TESTS PASSED', JSON.stringify(H.stats));
})().catch(e=>{console.error(e);process.exit(1)});
