# Pinned Unicode 15.1 NFC

All data are from https://www.unicode.org/Public/15.1.0/ucd/ , downloaded 2026-11-01. Official UTF-8 source SHA-256:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| UnicodeData.txt | 1914200 | `2fc713e6a31a87c4850a37fe2caffa4218180fadb5de86b43a143ddb4581fb86` |
| DerivedNormalizationProps.txt | 1355530 | `8875dccee2bc1a7c1fe568a3b502a9e78c9e0495afd96b6568b4294d0ed1f7e1` |
| NormalizationTest.txt | 2625136 | `871238e37e3be0696ec2bd0891119a041b052da1a84485eda05a5438724b223e` |

Extraction: UnicodeData field 5 supplies the 2061 canonical decompositions (exclude any compatibility tag beginning `<`), and field 3 supplies 922 nonzero canonical combining classes. Expand every `Full_Composition_Exclusion` interval from DerivedNormalizationProps into the 1120 exclusion scalars. Sort order is the official source order. JSON schema is `{unicode_version, decompositions: [[scalar,[scalars...]],...], combining_classes:[[scalar,ccc],...], composition_exclusions:[scalar,...]}`. No source uses “latest”.

The private helper computes Hangul decomposition/composition algorithmically. Other pair compositions derive only from length-two canonical decompositions outside the full exclusion set. Canonical ordering is stable and bounded by the input sequence; scalar values absent from this version's data remain unchanged. General strings and JSON are not normalized, and compatibility decomposition is never used.

The shared official `ui/scripts/fixtures/ui-suite/NormalizationTest-15.1.0.txt` preserves exact source bytes for the JS/Rust contract tests. This data and test file are Unicode data under the retained adjacent `unicode-license.txt` (Unicode License V3; https://www.unicode.org/license.txt). Copyright © 1991–2023 Unicode, Inc. All rights reserved.
