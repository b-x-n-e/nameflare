const appPath = /^\/(?:discover|following|artists|profiles|studio|collection|account|analytics|moderation|integrations|guide|donate)(?:\/[a-zA-Z0-9_-]{1,100})?\/?$/;
export function isAppPath(path) { return path === '/' || path === '/index.html' || appPath.test(path); }
export function currentRoute(url = location) {
  return url.pathname === '/' || url.pathname === '/index.html' ? '/discover' : url.pathname.replace(/\/$/,'');
}
export function legacyRoute(url = location) {
  const path='/' + (url.hash || '').slice(1);
  return appPath.test(path) ? path.replace(/\/$/,'') : null;
}
export function navigate(path, { replace=false, notify=true } = {}) {
  if(!isAppPath(path))throw new Error('Invalid application route.');
  const next=path.replace(/\/$/,'') || '/discover';
  if(location.pathname!==next || location.hash || location.search)history[replace?'replaceState':'pushState'](null,'',next);
  if(notify)window.dispatchEvent(new PopStateEvent('popstate'));
}
// Keep the feed tabs at the same viewport position when headers/results shrink,
// as far as the new page height allows.
export function preserveFeedScroll(anchor, container, viewport = window, page = document) {
  const top=anchor.getBoundingClientRect().top,oldMinHeight=container.style.minHeight,oldAnchor=container.style.overflowAnchor;
  let scroll=viewport.scrollY;
  container.style.minHeight=`${container.offsetHeight}px`;
  container.style.overflowAnchor='none';
  function restore() {
    const target=Math.max(0,viewport.scrollY+anchor.getBoundingClientRect().top-top);
    viewport.scrollTo({top:target,left:viewport.scrollX,behavior:'instant'});scroll=viewport.scrollY;
  }
  return {
    restore,
    cancel() { container.style.minHeight=oldMinHeight;container.style.overflowAnchor=oldAnchor; },
    finish() {
      // Do not pull the reader back if they scrolled while the request was pending.
      const target=viewport.scrollY===scroll?Math.max(0,viewport.scrollY+anchor.getBoundingClientRect().top-top):viewport.scrollY;
      // Never pad short results with blank space to hold the tabs in place: that
      // scrolled the header and showcase away and left an empty-looking page.
      container.style.minHeight=oldMinHeight;container.style.overflowAnchor=oldAnchor;
      const max=Math.max(0,page.scrollingElement.scrollHeight-viewport.innerHeight);
      viewport.scrollTo({top:Math.min(target,max),left:viewport.scrollX,behavior:'instant'});
    }
  };
}
export function installNavigation() {
  const old=legacyRoute();
  if(old)navigate(old,{replace:true,notify:false});
  document.addEventListener('click',event=>{
    const anchor=event.target.closest?.('a[href]');
    if(!anchor || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.hasAttribute('download') || (anchor.target && anchor.target!=='_self'))return;
    const url=new URL(anchor.href,location.href);
    if(url.origin!==location.origin || url.hash || url.search || !isAppPath(url.pathname))return;
    event.preventDefault();navigate(url.pathname);
  });
  window.addEventListener('hashchange',()=>{const old=legacyRoute();if(old)navigate(old,{replace:true});});
}
