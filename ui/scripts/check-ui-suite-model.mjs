import { createContext } from './lib/suite-model-context.mjs';
import { checkFramingLineage } from './lib/suite-model-framing-lineage.mjs';
import { checkSchemaPaths } from './lib/suite-model-schema-paths.mjs';
import { checkArchivePreflight } from './lib/suite-model-archive-preflight.mjs';
import { checkCanonicalDeflate } from './lib/suite-model-canonical-deflate.mjs';
import { checkLimitsLibrary } from './lib/suite-model-limits-library.mjs';
import { checkZipMetadata } from './lib/suite-model-zip-metadata.mjs';
import { checkValuesAssets } from './lib/suite-model-values-assets.mjs';
import { checkArchiveOutputFonts } from './lib/suite-model-archive-output-fonts.mjs';

const context = createContext();
await checkFramingLineage(context);
await checkSchemaPaths(context);
await checkArchivePreflight(context);
await checkCanonicalDeflate(context);
await checkLimitsLibrary(context);
await checkZipMetadata(context);
await checkValuesAssets(context);
await checkArchiveOutputFonts(context);
