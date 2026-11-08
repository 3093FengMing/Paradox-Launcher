/** @jsxImportSource react */
/* eslint-disable react-refresh/only-export-components -- Mode-only fixture API. */
import { cloneElement, createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { UiEditorProvider as ControllerOwner, UiEditorSourceContext, useUiEditorController } from '../ui-editor/controller';
import { getBuiltinBundle, getPreparedBuiltin } from '../ui-suite/builtins';
import { SuiteProvider } from '../ui-suite/SuiteProvider';
import type { PreparedUiSuite } from '../ui-suite/prepared';
import type { UiTargetOverride } from '../ui-suite/model';

interface PreviewFixture {
  preview(payload: { views: Record<string, { source: string }> }): Promise<void>;
  revert(): Promise<void>;
}
const PreviewContext = createContext<PreviewFixture | null>(null);
export function usePreviewFixture() { const value=useContext(PreviewContext); if(!value)throw Error('Preview fixture owner missing'); return value; }
function Sources({ children }: {children: ReactNode}) {
  const controller=useUiEditorController();
  const [fallback,setFallback]=useState<PreparedUiSuite|null>(null);
  useEffect(()=>{let owned:PreparedUiSuite|null=null,alive=true;void getPreparedBuiltin('modern').then(value=>{if(!alive){value.dispose();return;}owned=value;setFallback(value);});return()=>{alive=false;queueMicrotask(()=>owned?.dispose());};},[]);
  const actions=useMemo<PreviewFixture>(()=>({
    async preview(payload) {
      await controller.whenInitialized();
      if(!controller.getSnapshot().draft || controller.getSnapshot().selectedSuiteId?.startsWith('builtin.'))await controller.actions.copyBuiltin('modern','Public API fixture');
      const draft=controller.getSnapshot().draft!;
      const views={...draft.manifest.views},overrides:UiTargetOverride[]=[];
      for(const [target,row]of Object.entries(payload.views)){
        const path='fixture/'+target+'.tsx';if(!draft.files[path])controller.actions.createFile(path,'tsx');controller.actions.patchFile(path,row.source);
        if(target.endsWith('.original-instance'))overrides.push({selector:{kind:'business',target:target.slice(0,-'.original-instance'.length),identity:{namespace:'profile',value:'original-instance'}},entry:path,enabled:true,stylesheet:null});
        else views[target]=path;
      }
      const routes=draft.manifest.routes.map(route=>({...route,entry:views['page.'+route.id]??route.entry}));
      controller.actions.patchManifest({views,routes,overrides});
      if(!await controller.actions.preview())throw Error(controller.getSnapshot().diagnostics.join('\n'));
    },
    async revert(){await controller.actions.revert();},
  }),[controller]);
  return <PreviewContext.Provider value={actions}>{fallback?<SuiteProvider fallback={fallback}>{children}</SuiteProvider>:children}</PreviewContext.Provider>;
}
function Owner({children}:{children:ReactNode}){return <UiEditorSourceContext.Provider value={{getBuiltinBundle}}><ControllerOwner><Sources>{children}</Sources></ControllerOwner></UiEditorSourceContext.Provider>;}
// Existing test launchers remain sole business owners; insert the new suite owner inside them.
export function UiEditorProvider({children}:{children:ReactElement<{children:ReactNode}>}){
  return cloneElement(children,{children:<Owner>{children.props.children}</Owner>});
}
