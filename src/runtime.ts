/**
 * Browser runtime shim injected by `harakah-fix fix` when a composition splits text
 * into per-letter boxes at runtime (GSAP SplitText, Motion splitText, [...str], split(''), anime.js letter wraps).
 * It keeps the SAME elements (so GSAP/HyperFrames timelines still target them) and only
 * pads each letter box with U+200D ZERO WIDTH JOINER so Chrome shapes the contextual form,
 * and folds alef into the preceding lam box so the mandatory لا ligature survives.
 * Idempotent; re-runs on DOM mutations.
 */
export const RUNTIME_SHIM = String.raw`(function(){
if(window.__harakahShim)return;window.__harakahShim=true;
var ZWJ='\u200d',TR=/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/,
AL=/[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF\u0750-\u077F\u08A0-\u08C9]/,
R={},U={0x621:1,0x674:1,0x6d5:1},ALEF={'\u0622':1,'\u0623':1,'\u0625':1,'\u0627':1,'\u0671':1};
[0x622,0x623,0x624,0x625,0x627,0x629,0x62f,0x630,0x631,0x632,0x648,0x671,0x672,0x673,0x675,0x676,0x677,0x6c0,0x6c3,0x6c4,0x6c5,0x6c6,0x6c7,0x6c8,0x6c9,0x6ca,0x6cb,0x6cd,0x6cf,0x6d2,0x6d3,0x6ee,0x6ef].forEach(function(c){R[c]=1});
for(var c=0x688;c<=0x699;c++)R[c]=1;
function jt(ch){var cp=ch.codePointAt(0);if(cp===0x200d||cp===0x640)return'C';if(TR.test(ch))return'T';if(R[cp])return'R';if(U[cp])return'U';if(AL.test(ch))return'D';return'U'}
function edge(s,last){var a=Array.from(s.replace(/\u200d/g,''));if(last)a.reverse();for(var i=0;i<a.length;i++){var t=jt(a[i]);if(t!=='T')return t}return'U'}
function fwd(t){return t==='D'||t==='C'}function back(t){return t==='D'||t==='R'||t==='C'}
var seg=window.Intl&&Intl.Segmenter?new Intl.Segmenter('ar',{granularity:'grapheme'}):null;
function gcount(s){s=s.replace(/\u200d/g,'');if(!seg)return Array.from(s).length;var n=0;for(var x of seg.segment(s))n++;return n}
function bases(s){return Array.from(s.replace(/\u200d/g,'')).filter(function(c){return jt(c)!=='T'})}
function processParent(p){
  var nodes=p.childNodes,parts=[],leafEls=0,single=0,arabic=0;
  for(var i=0;i<nodes.length;i++){var n=nodes[i];
    if(n.nodeType===3){if(/^[\s\u00a0]*$/.test(n.data)){if(n.data.length)parts.push({sep:true});continue}return}
    if(n.nodeType!==1)continue;var t=n.tagName;if(t==='SCRIPT'||t==='STYLE'||t==='BR'){parts.push({sep:true});continue}
    if(n.children.length){return}
    leafEls++;var txt=n.textContent||'';
    if(/^[\s\u00a0]*$/.test(txt)){parts.push({sep:true});continue}
    var g=gcount(txt);if(g<=2)single++;if(AL.test(txt))arabic++;parts.push({el:n,text:txt.replace(/\u200d/g,'')})}
  if(leafEls<2||arabic<2||single/leafEls<0.6)return;
  // a script that prepends each letter (window.__harakahNoDir lists its containers) leaves the DOM in reverse reading order
  var nd=window.__harakahNoDir,rev=!!(nd&&nd.some&&nd.some(function(q){try{return p.closest(q)}catch(e){return false}}));
  // …laid out for an LTR line: if the line is RTL (dir added later), pin the container back to LTR so it still reads right
  if(rev){parts.reverse();if(!p.hasAttribute('dir')&&getComputedStyle(p).direction==='rtl')p.setAttribute('dir','ltr')}
  // lam + alef => keep ligature in the lam box
  for(var j=0;j<parts.length-1;j++){var a=parts[j],b=parts[j+1];if(a.sep||b.sep)continue;var ab=bases(a.text),bb=bases(b.text);
    if(ab.length&&bb.length&&ab[ab.length-1]==='\u0644'&&ALEF[bb[0]]&&gcount(b.text)===1){a.text=a.text+b.text;b.text=''}}
  for(var k=0;k<parts.length;k++){var q=parts[k];if(q.sep)continue;var out=q.text;
    if(out&&AL.test(out)||out.indexOf('\u0640')>=0){var pv=null,nx=null;
      for(var m=k-1;m>=0;m--){if(parts[m].sep){break}if(parts[m].text){pv=parts[m].text;break}}
      for(var m2=k+1;m2<parts.length;m2++){if(parts[m2].sep){break}if(parts[m2].text){nx=parts[m2].text;break}}
      if(pv&&fwd(edge(pv,true))&&back(edge(out,false)))out=ZWJ+out;
      if(nx&&fwd(edge(out,true))&&back(edge(nx,false)))out=out+ZWJ}
    if(q.el.textContent!==out)q.el.textContent=out}
  p.setAttribute('data-harakah-joined','1');
  // letter boxes are atomic for bidi: they line up in the container's direction. An Arabic run split inside an LTR line
  // (an <h1>Input: شكرا</h1>, an LTR page) would read backwards, so give the Arabic container (and its word row) dir=rtl.
  if(!(nd===1||rev)){rtlize(p);var gp=p.parentElement;if(gp&&gp.children.length>=2&&/inline-block|inline-flex/.test(getComputedStyle(p).display))rtlize(gp)}}
function rtlize(el){if(!el||el.hasAttribute('dir')||el===document.body||el===document.documentElement)return;
  if(getComputedStyle(el).direction!=='ltr')return;var t=el.textContent||'',a=(t.match(/[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF\u0750-\u077F\u08A0-\u08C9]/g)||[]).length,l=(t.match(/[A-Za-z]/g)||[]).length;
  if(a>=2&&a>l){el.setAttribute('dir','rtl');var ds=el.querySelectorAll('*');for(var i=0;i<ds.length;i++)latin(ds[i])}}
// a Latin word split into letter boxes inside an RTL line lines its boxes up right-to-left ("gsap" shows as "pasg"); keep it LTR
// unless the page's own helper already pre-reverses Latin words for that (window.__harakahKeepLatin)
function latin(e){if(window.__harakahKeepLatin||e.hasAttribute('dir')||e.children.length<2)return;var k=e.children,n=0;
  for(var i=0;i<k.length;i++){var c=k[i];if(c.children.length)return;var t=(c.textContent||'').replace(/\u200d/g,'');if(!t.trim())continue;if(AL.test(t)||gcount(t)>2)return;n++}
  var t2=e.textContent||'';if(n<2||!/[A-Za-z0-9]/.test(t2)||AL.test(t2))return;if(getComputedStyle(e).direction==='rtl'&&/inline-block|inline-flex|block/.test(getComputedStyle(k[0]).display))e.setAttribute('dir','ltr')}
function run(){var all=document.body?document.body.querySelectorAll('*'):[];for(var i=0;i<all.length;i++){var e=all[i];if(e.children.length>=2){processParent(e);latin(e)}}}
run();var pend=false;
try{new MutationObserver(function(){if(pend)return;pend=true;Promise.resolve().then(function(){pend=false;run()})}).observe(document.documentElement,{childList:true,subtree:true,characterData:false})}catch(e){}
document.addEventListener('DOMContentLoaded',run);window.addEventListener('load',run);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(run);
window.__harakahRun=run;
})();`;
