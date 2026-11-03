import type { UiSelector } from '../ui-suite/model';
import type { DomPreviewHandle, DomPreviewSnapshot } from '../ui-editor/public';
import { copySelector } from './selectors';
import { describeTarget } from './target-catalog';
import { resolveSelector, subscribeOwners } from './ownership';
import { getCurrentRootRects, isInspectorArtifact, showTargetRanges } from './highlight';

const blockedTags = new Set(['script', 'style', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'audio', 'video', 'source', 'track', 'animate', 'animatemotion', 'animatetransform', 'set']);
const invisibleTags = new Set(['script', 'style', 'link', 'meta', 'base', 'source', 'track', 'animate', 'animatemotion', 'animatetransform', 'set']);
const urlAttributes = new Set(['src', 'srcset', 'href', 'xlink:href', 'poster', 'action', 'formaction', 'background', 'ping', 'cite', 'data', 'codebase', 'manifest']);
const references = new Set(['for', 'form', 'list', 'headers', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage']);
const rasterData = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i;
const visibleRoot = (root: Element) => getCurrentRootRects(root).length > 0;

/** Reads live pixels only. It never fetches a URL or mounts a business view. */
export function createDomPreview(selector: UiSelector, container: HTMLElement): DomPreviewHandle {
  const selected = copySelector(selector), doc = container.ownerDocument, view = doc.defaultView!;
  const mirror = doc.createElement('div');
  mirror.setAttribute('data-ui-inspector-artifact', 'mirror'); mirror.setAttribute('aria-hidden', 'true'); mirror.inert = true;
  mirror.style.cssText = 'display:block;pointer-events:none;user-select:none;overflow:hidden;min-width:0;';
  const surface = mirror.attachShadow({ mode: 'open' });
  container.append(mirror);
  const suppress = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  for (const type of ['click','submit','keydown','pointerdown']) surface.addEventListener(type, suppress, true);
  const listeners = new Set<() => void>(), ids = new WeakMap<Element, string>();
  const prefix = `ui-mirror-${crypto.randomUUID()}-`; let nextId = 0;
  let snapshot: DomPreviewSnapshot = Object.freeze({ status: 'unmounted', reason: null, rootCount: 0, locations: Object.freeze([]) });
  let disposed = false, frame = 0, signature = '', roots: Element[] = [];
  let watchedRoots: Element[] = [], resizedRoots: Element[] | null = null;
  let scrollShadows = new Set<ShadowRoot>();
  const mutations = new MutationObserver((records) => {
    if (records.some((record) => { const element=record.target instanceof Element ? record.target : record.target.parentElement; return element && !isInspectorArtifact(element) && (record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes].some((node) => !(node instanceof Element) || !isInspectorArtifact(node))); })) schedule();
  });
  const resize = new ResizeObserver(() => schedule());
  function schedule() { if (!disposed && !frame) frame = view.requestAnimationFrame(refresh); }
  const unsubscribe = subscribeOwners(schedule);
  const input = (event: Event) => { if (event.target instanceof Element && !isInspectorArtifact(event.target) && roots.some((root) => root === event.target || root.contains(event.target as Node))) schedule(); };
  const shadowScroll = (event: Event) => { if (event.target instanceof Element && !isInspectorArtifact(event.target)) schedule(); };
  doc.addEventListener('input', input, true); doc.addEventListener('change', input, true); doc.addEventListener('scroll', input, true); view.addEventListener('resize', schedule);
  function observe() {
    mutations.disconnect();
    if (!resizedRoots || resizedRoots.length !== watchedRoots.length || resizedRoots.some((root,index)=>root!==watchedRoots[index])) {
      resize.disconnect(); for(const root of resizedRoots ?? [])root.removeEventListener('scroll',input,true);
      resize.observe(container); for(const root of watchedRoots){resize.observe(root);root.addEventListener('scroll',input,true);} resizedRoots=[...watchedRoots];
    }
    const ancestors = new Set<Element>();
    const nextShadows = new Set<ShadowRoot>();
    for (const root of watchedRoots) {
      mutations.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
      const observeShadows = (element: Element) => { if(isInspectorArtifact(element))return;if(element.shadowRoot){nextShadows.add(element.shadowRoot);mutations.observe(element.shadowRoot,{subtree:true,childList:true,characterData:true,attributes:true});for(const child of element.shadowRoot.querySelectorAll('*'))observeShadows(child);} };
      observeShadows(root); for(const element of root.querySelectorAll('*'))observeShadows(element);
      let current: Element | null = root;
      while (current) { const tree: Node=current.getRootNode(); current=current.parentElement ?? (tree instanceof ShadowRoot ? tree.host : null); if(current && !roots.includes(current))ancestors.add(current); }
    }
    for(const shadow of scrollShadows)if(!nextShadows.has(shadow))shadow.removeEventListener('scroll',shadowScroll,true);
    for(const shadow of nextShadows)if(!scrollShadows.has(shadow))shadow.addEventListener('scroll',shadowScroll,true);
    scrollShadows=nextShadows;
    for (const ancestor of ancestors) mutations.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  }
  function refresh() {
    if (disposed) return; if (frame) view.cancelAnimationFrame(frame); frame = 0;
    const resolution = resolveSelector(selected), issues = new Set<string>();
    const scrollSources = new Map<Element, Element>();
    watchedRoots=[...new Set(resolution.owners.flatMap(owner=>[...owner.roots]))].filter(root=>root.isConnected&&!isInspectorArtifact(root));
    roots = resolution.status === 'resolved' || resolution.status === 'hidden' ? [...new Set(resolution.owners.flatMap((owner) => [...owner.roots]))].filter(visibleRoot) : [];
    const localIds = new Map<string, string | null>();
    for (const root of roots) for (const element of [root, ...root.querySelectorAll('[id]')]) if (element.id && !isInspectorArtifact(element)) {
      if (!ids.has(element)) ids.set(element, prefix + nextId++);
      if (localIds.has(element.id)) { localIds.set(element.id, null); issues.add('Duplicate source IDs cannot be referenced safely.'); }
      else localIds.set(element.id, ids.get(element)!);
    }
    function imagePixels(source: HTMLImageElement): string | null {
      if (!source.complete || !source.naturalWidth) { issues.add('Image pixels are not available yet.'); return null; }
      try { const canvas = doc.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight; canvas.getContext('2d')!.drawImage(source, 0, 0); return canvas.toDataURL(); }
      catch { issues.add('Image pixels are unreadable; the mirror does not reload the image.'); return null; }
    }
    function safeUrl(url: string): string | null {
      if (!url.startsWith('#')) {
        try { const candidate = new URL(url, doc.URL), current = new URL(doc.URL); if (candidate.hash && candidate.origin === current.origin && candidate.pathname === current.pathname && candidate.search === current.search) url = candidate.hash; } catch { /* An invalid URL is rejected below. */ }
      }
      if (url.startsWith('#')) { const mapped = localIds.get(url.slice(1)); if (mapped) return '#' + mapped; issues.add('A local reference has no unique mirrored target.'); return null; }
      if (rasterData.test(url)) return url;
      const image = [...doc.images].find((image) => image.currentSrc === url && image.complete && image.naturalWidth);
      if (image) return imagePixels(image);
      issues.add('External paint resources are unavailable without a new request.'); return null;
    }
    function safePaint(value: string): string {
      return value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (_match, double: string, single: string, bare: string) => {
        const url = safeUrl((double ?? single ?? bare).trim()); return url ? `url("${url}")` : 'none';
      });
    }
    function styles(source: Element, clone: HTMLElement | SVGElement, pseudo?: string) {
      const computed = view.getComputedStyle(source, pseudo);
      for (const property of computed) {
        if (property.startsWith('animation') || property.startsWith('transition') || property === 'content' || property === 'cursor') continue;
        clone.style.setProperty(property, safePaint(computed.getPropertyValue(property)));
      }
      clone.style.setProperty('pointer-events', 'none', 'important'); clone.style.setProperty('user-select', 'none', 'important');
      if (computed.position === 'fixed' || computed.position === 'sticky') {
        clone.style.position = 'static'; clone.style.inset = 'auto';
      }
    }
    function fallback(source: Element, reason: string) {
      issues.add(reason); const node = doc.createElement('span'); node.textContent = `[${source.localName}: ${reason}]`; node.setAttribute('data-ui-preview-unavailable', source.localName); node.style.cssText = 'display:inline-block;font:12px system-ui;color:inherit;overflow-wrap:anywhere;'; return node;
    }
    function cloneNode(source: Node): Node | null {
      if (source.nodeType === Node.TEXT_NODE) return doc.createTextNode(source.textContent ?? '');
      if (!(source instanceof Element) || source === container || isInspectorArtifact(source)) return null;
      const tag = source.localName.toLowerCase();
      if (invisibleTags.has(tag)) return null;
      if (blockedTags.has(tag) || tag.includes('-')) return fallback(source, 'Embedded or active content cannot be mirrored.');
      const clone = source.namespaceURI === 'http://www.w3.org/2000/svg' ? doc.createElementNS(source.namespaceURI, source.localName) : doc.createElement(tag);
      for (const attribute of source.attributes) {
        const name = attribute.name.toLowerCase();
        if (name === 'id') { const mapped = localIds.get(attribute.value); if (mapped) clone.id = mapped; continue; }
        if (name === 'style' || name === 'class' || name.startsWith('on') || name.startsWith('data-ui-') || references.has(name) || ['autofocus','tabindex','contenteditable','draggable','name','is','popover','popovertarget','target','download','formtarget'].includes(name)) continue;
        if (urlAttributes.has(name)) {
          if (source.namespaceURI === 'http://www.w3.org/2000/svg' && ['href','xlink:href'].includes(name)) { const url = safeUrl(attribute.value); if (url) clone.setAttribute(name, url); }
          continue;
        }
        clone.setAttribute(attribute.name, safePaint(attribute.value));
      }
      styles(source, clone);
      if (clone instanceof HTMLElement) { clone.tabIndex = -1; clone.removeAttribute('autofocus'); }
      if (source instanceof HTMLImageElement && clone instanceof HTMLImageElement) { const pixels = imagePixels(source); if (pixels) clone.src = pixels; else return fallback(source, 'Image pixels cannot be mirrored.'); }
      if (source instanceof HTMLCanvasElement && clone instanceof HTMLCanvasElement) {
        try { const pixels = source.getContext('2d')?.getImageData(0,0,Math.max(1,source.width),Math.max(1,source.height)); if (!pixels) throw Error('Canvas is not a readable 2D surface'); clone.width=source.width; clone.height=source.height; clone.getContext('2d')!.putImageData(pixels,0,0); }
        catch { return fallback(source, 'Canvas pixels are unavailable or protected.'); }
      }
      const children = source instanceof HTMLSlotElement ? source.assignedNodes({flatten:true}) : source.shadowRoot?.childNodes ?? source.childNodes;
      for (const child of children) { const copy=cloneNode(child); if(copy) clone.append(copy); }
      if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) { if (source.type !== 'file') clone.value=source.value; else if (source.files?.length) issues.add('File selection cannot be mirrored.'); clone.checked=source.checked; clone.indeterminate=source.indeterminate; try { clone.setSelectionRange(source.selectionStart,source.selectionEnd,source.selectionDirection ?? undefined); } catch { /* Non-text controls have no text selection. */ } }
      if (source instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) { clone.value=source.value; clone.textContent=source.value; clone.setSelectionRange(source.selectionStart,source.selectionEnd,source.selectionDirection); }
      if (source instanceof HTMLSelectElement && clone instanceof HTMLSelectElement) [...clone.options].forEach((option,index)=>{option.selected=source.options[index]?.selected ?? false;});
      for (const pseudo of ['::before','::after']) {
        const content=view.getComputedStyle(source,pseudo).content;
        if (!content || content === 'none' || content === 'normal' || content === '""') continue;
        try { const text: unknown=JSON.parse(content); if(typeof text !== 'string') throw Error('Unsupported pseudo content'); const span=doc.createElement('span'); span.textContent=text; styles(source,span,pseudo); if(pseudo==='::before')clone.prepend(span);else clone.append(span); }
        catch { issues.add('Generated content cannot be serialized faithfully.'); }
      }
      scrollSources.set(clone, source);
      return clone;
    }
    const stages: HTMLElement[]=[];
    for (const root of roots) {
      const clone=cloneNode(root); if(!(clone instanceof Element))continue;
      const rect=root.getBoundingClientRect(), stage=doc.createElement('div'), visible=getCurrentRootRects(root);
      const width=Math.max(1, rect.height > 0 && root instanceof HTMLElement ? root.offsetWidth : Math.max(...visible.map(rect=>rect.right))-Math.min(...visible.map(rect=>rect.left)));
      const height=Math.max(1, rect.height > 0 && root instanceof HTMLElement ? root.offsetHeight : Math.max(...visible.map(rect=>rect.bottom))-Math.min(...visible.map(rect=>rect.top)));
      const scale=Math.min(1, Math.max(1,container.clientWidth || 300)/width, 160/height);
      stage.style.cssText=`position:relative;overflow:hidden;width:${width*scale}px;height:${height*scale}px;margin:0 0 8px;`;
      clone.setAttribute('data-ui-preview-root',''); const styled=clone as HTMLElement;
      styled.style.setProperty('position','static'); styled.style.setProperty('margin','0'); styled.style.setProperty('transform',`scale(${scale})`); styled.style.setProperty('transform-origin','top left'); styled.style.setProperty('width',`${width}px`); styled.style.setProperty('height',`${height}px`);
      stage.append(clone); stages.push(stage);
    }
    // Stable serialization prevents observer feedback when inspecting the editor itself.
    const nextSignature=stages.map(stage=>stage.outerHTML).join('');
    if(signature!==nextSignature){surface.replaceChildren(...stages);signature=nextSignature;}
    else { // Canvas pixels and live form properties are not all serialized in HTML.
      const old=surface.querySelectorAll('canvas'), fresh=stages.flatMap(stage=>[...stage.querySelectorAll('canvas')]);
      old.forEach((canvas,index)=>{const source=fresh[index],context=canvas.getContext('2d');if(source&&context){context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(source,0,0);}});
      const oldInputs=surface.querySelectorAll('input,textarea,select'), freshInputs=stages.flatMap(stage=>[...stage.querySelectorAll('input,textarea,select')]);
      oldInputs.forEach((control,index)=>{const fresh=freshInputs[index];if(control instanceof HTMLInputElement && fresh instanceof HTMLInputElement){if(fresh.type!=='file')control.value=fresh.value;control.checked=fresh.checked;control.indeterminate=fresh.indeterminate;try{control.setSelectionRange(fresh.selectionStart,fresh.selectionEnd);}catch{/* Non-text input. */}}else if(control instanceof HTMLTextAreaElement && fresh instanceof HTMLTextAreaElement){control.value=fresh.value;control.setSelectionRange(fresh.selectionStart,fresh.selectionEnd);}else if(control instanceof HTMLSelectElement && fresh instanceof HTMLSelectElement)[...control.options].forEach((option,i)=>{option.selected=fresh.options[i]?.selected??false;});});
    }
    // Matching serialization preserves node order. Restore live scroll regions only
    // after layout is available, for newly attached and reused nodes alike.
    const freshElements = stages.flatMap(stage => [stage, ...stage.querySelectorAll('*')]);
    surface.querySelectorAll('*').forEach((element, index) => {
      const source = scrollSources.get(freshElements[index]);
      if (!source || !(element instanceof HTMLElement || element instanceof SVGElement)) return;
      const behavior = element.style.scrollBehavior;
      element.style.scrollBehavior = 'auto';
      element.scrollTop = source.scrollTop; element.scrollLeft = source.scrollLeft;
      element.style.scrollBehavior = behavior;
      if (Math.abs(element.scrollTop - source.scrollTop) > 1 || Math.abs(element.scrollLeft - source.scrollLeft) > 1)
        issues.add('Current scroll position cannot be represented faithfully in the mirror.');
    });
    const descriptor=describeTarget(selected);
    const opaque=stages.length>0 && stages.every(stage=>stage.firstElementChild?.hasAttribute('data-ui-preview-unavailable'));
    const status=opaque ? 'unsupported' : roots.length ? 'resolved' : resolution.status === 'resolved' ? 'unsupported' : resolution.status;
    const reason=[descriptor.reason, ...issues].filter(Boolean).join(' ') || (status==='unsupported' ? 'No readable current DOM root is available.' : null);
    const locations=Object.freeze(resolution.owners.map((owner,index)=>Object.freeze({selector:copySelector({kind:'position',target:owner.target,locator:owner.locator}),index,rootCount:[...owner.roots].filter(visibleRoot).length})));
    const next=Object.freeze({status,reason,rootCount:stages.length,locations});
    if(JSON.stringify(next)!==JSON.stringify(snapshot)){snapshot=next;for(const listener of [...listeners])listener();}
    observe();
  }
  const handle: DomPreviewHandle = {
    get status(){return snapshot.status;},get reason(){return snapshot.reason;},getSnapshot:()=>snapshot,
    subscribe(listener){if(disposed)return()=>{};listeners.add(listener);return()=>{listeners.delete(listener);};},refresh:()=>{refresh();schedule();},
    dispose(){if(disposed)return;disposed=true;if(frame)view.cancelAnimationFrame(frame);mutations.disconnect();resize.disconnect();unsubscribe();doc.removeEventListener('input',input,true);doc.removeEventListener('change',input,true);doc.removeEventListener('scroll',input,true);for(const root of resizedRoots ?? [])root.removeEventListener('scroll',input,true);for(const shadow of scrollShadows)shadow.removeEventListener('scroll',shadowScroll,true);scrollShadows.clear();view.removeEventListener('resize',schedule);for(const type of ['click','submit','keydown','pointerdown'])surface.removeEventListener(type,suppress,true);surface.replaceChildren();mirror.remove();roots=[];watchedRoots=[];resizedRoots=null;listeners.clear();},
  };
  refresh(); return handle;
}

/** No implicit first match; revalidate identity after scrolling before drawing. */
export async function locateTarget(selector: UiSelector, index?: number, onHighlight: (dispose: () => void) => void = (dispose) => { setTimeout(dispose,1200); }, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  const resolution=resolveSelector(selector); if(resolution.status!=='resolved')return false;
  const eligible=resolution.owners.filter(owner=>[...owner.roots].some(visibleRoot));
  const owner=index===undefined ? eligible.length===1 ? eligible[0] : null : Number.isInteger(index) && index>=0 ? resolution.owners[index] : null;
  if(!owner)return false; const roots=[...owner.roots].filter(visibleRoot); if(!roots.length)return false;
  const root=roots[0], view=root.ownerDocument.defaultView!;
  const rect=root.getBoundingClientRect(); if(rect.bottom<=0||rect.right<=0||rect.top>=view.innerHeight||rect.left>=view.innerWidth)root.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  await new Promise<void>(resolve=>view.requestAnimationFrame(()=>resolve()));
  const current=resolveSelector(selector); if(signal?.aborted || current.status!=='resolved' || !current.owners.some(row=>row.ownerId===owner.ownerId && roots.every(root=>row.roots.has(root)&&visibleRoot(root))))return false;
  onHighlight(showTargetRanges([owner.ownerId],root.ownerDocument)); return true;
}
