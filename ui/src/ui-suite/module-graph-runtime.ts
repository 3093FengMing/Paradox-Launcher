/** TypeScript-free graph metadata and blob factory serialization. No user code runs here. */
export interface GraphModule {
  path: string;
  kind: 'ts' | 'tsx' | 'css' | 'asset';
  code: string;
  dependencies: Record<string, string>;
  runtimeDependencies: string[];
}
export interface SuiteModuleGraph {
  readonly modules: ReadonlyMap<string, GraphModule>;
  readonly entries: readonly string[];
  readonly identity: string;
  stylesFor(entry: string): readonly string[];
}
export interface SerializedSuiteModuleGraph {
  readonly modules: readonly GraphModule[];
  readonly entries: readonly string[];
  readonly identity: string;
}
export function createModuleGraph(
  modules: ReadonlyMap<string, GraphModule>,
  entries: readonly string[],
  identity: string,
): SuiteModuleGraph {
  const styles = new Map<string, readonly string[]>();
  return {
    modules, entries, identity,
    stylesFor(entry) {
      let found = styles.get(entry);
      if (found) return found;
      const seen = new Set<string>(), result: string[] = [];
      const scan = (path: string) => {
        if (seen.has(path)) return;
        seen.add(path);
        const module = modules.get(path);
        if (!module) return;
        if (module.kind === 'css') result.push(path);
        else for (const dependency of module.runtimeDependencies) scan(dependency);
      };
      scan(entry);
      found = Object.freeze(result);
      styles.set(entry, found);
      return found;
    },
  };
}
export function serializeModuleGraph(graph: SuiteModuleGraph): SerializedSuiteModuleGraph {
  return { modules: [...graph.modules.values()], entries: graph.entries, identity: graph.identity };
}
/** Only host build-generated plans use this; imported bundles cannot supply executable metadata. */
export function restoreModuleGraph(plan: SerializedSuiteModuleGraph): SuiteModuleGraph {
  return createModuleGraph(new Map(plan.modules.map(module => [module.path, module])), plan.entries, plan.identity);
}
/** Blob evaluation only defines factories. User code begins inside initialize. */
export function moduleBlobSource(graph: SuiteModuleGraph): string {
  const factories = [...graph.modules.values()].map((m) => {
    const code = m.kind === 'asset'
      ? `module.exports={__esModule:true,default:assets[${JSON.stringify(m.path)}]};`
      : m.kind === 'css' ? '' : m.code;
    return `[${JSON.stringify(m.path)},function(module,exports,require,assets){\n${code}\n}]`;
  });
  const dependencies = Object.fromEntries([...graph.modules].map(([id, m]) => [id, m.dependencies]));
  return `const factories=Object.fromEntries([${factories.join(',\n')}]);
const dependencies=${JSON.stringify(dependencies)};
export function initialize(publicModules,assets){
 const cache=Object.create(null);
 const load=(id)=>{
  if(Object.hasOwn(cache,id))return cache[id].exports;
  if(!Object.hasOwn(factories,id))throw Error('Missing suite module: '+id);
  const module={exports:{}};cache[id]=module;
  const require=(name)=>{const dep=dependencies[id][name];if(dep===undefined)throw Error('Unsupported module: '+name);return Object.hasOwn(publicModules,dep)?publicModules[dep]:load(dep);};
  try{factories[id](module,module.exports,require,assets);}catch(error){delete cache[id];throw error;}
  return module.exports;
 };
 return Object.fromEntries(${JSON.stringify(graph.entries)}.map(id=>[id,load(id)]));
}`;
}
