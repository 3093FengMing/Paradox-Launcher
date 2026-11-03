//! DATA-only container/header checks, mirroring the host inspectors.
use super::model::ASSET;
use anyhow::{Result, ensure};
fn u16b(b: &[u8], p: usize) -> Result<u16> {
    Ok(u16::from_be_bytes(
        b.get(p..p + 2)
            .ok_or_else(|| anyhow::anyhow!("Truncated suite asset"))?
            .try_into()?,
    ))
}
fn u32b(b: &[u8], p: usize) -> Result<u32> {
    Ok(u32::from_be_bytes(
        b.get(p..p + 4)
            .ok_or_else(|| anyhow::anyhow!("Truncated suite asset"))?
            .try_into()?,
    ))
}
fn u16l(b: &[u8], p: usize) -> Result<u16> {
    Ok(u16b(b, p)?.swap_bytes())
}
fn u32l(b: &[u8], p: usize) -> Result<u32> {
    Ok(u32b(b, p)?.swap_bytes())
}
pub fn inspect(media: &str, b: &[u8]) -> Result<()> {
    ensure!(b.len() <= ASSET, "Suite asset exceeds limit");
    match media {
        "image/png" | "image/jpeg" | "image/webp" => raster(media, b),
        "font/woff" | "font/woff2" => font(media, b),
        "image/svg+xml" => {
            ensure!(std::str::from_utf8(b)?.trim_start_matches(|c: char| matches!(c, '\u{9}'..='\u{d}' | '\u{20}' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')).starts_with('<'), "Invalid SVG header");
            Ok(())
        }
        _ => anyhow::bail!("Unsupported suite asset media type"),
    }
}
fn raster(media: &str, b: &[u8]) -> Result<()> {
    let (mut width, mut height) = (0u32, 0u32);
    match media {
        "image/png" => {
            ensure!(
                b.len() >= 33
                    && b[..8] == [137, 80, 78, 71, 13, 10, 26, 10]
                    && u32b(b, 8)? == 13
                    && u32b(b, 12)? == 0x49484452,
                "Invalid PNG header"
            );
            let depths: &[u8] = match b[25] {
                0 => &[1, 2, 4, 8, 16],
                2 | 4 | 6 => &[8, 16],
                3 => &[1, 2, 4, 8],
                _ => &[],
            };
            ensure!(
                depths.contains(&b[24]) && b[26] == 0 && b[27] == 0 && b[28] <= 1,
                "Invalid PNG IHDR"
            );
            width = u32b(b, 16)?;
            height = u32b(b, 20)?;
        }
        "image/jpeg" => {
            ensure!(b.len() >= 4 && b[..2] == [255, 216], "Invalid JPEG header");
            let mut p = 2;
            while p < b.len() {
                ensure!(b[p] == 255, "Invalid JPEG marker");
                p += 1;
                while b.get(p) == Some(&255) {
                    p += 1;
                }
                let Some(&marker) = b.get(p) else {
                    break;
                };
                p += 1;
                if matches!(marker, 0xd9 | 0xda) {
                    break;
                }
                if marker == 1 || (0xd0..=0xd7).contains(&marker) {
                    continue;
                }
                if p + 2 > b.len() {
                    break;
                }
                let n = u16b(b, p)? as usize;
                ensure!(n >= 2 && p + n <= b.len(), "Truncated JPEG segment");
                if [
                    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
                ]
                .contains(&marker)
                {
                    ensure!(n >= 8, "Invalid JPEG frame");
                    height = u16b(b, p + 3)? as u32;
                    width = u16b(b, p + 5)? as u32;
                    break;
                }
                p += n;
            }
        }
        _ => {
            ensure!(
                b.len() >= 20
                    && u32b(b, 0)? == 0x52494646
                    && u32b(b, 8)? == 0x57454250
                    && u32l(b, 4)? as usize == b.len() - 8,
                "Invalid WebP container"
            );
            let mut p = 12;
            while p + 8 <= b.len() {
                let tag = u32b(b, p)?;
                let size = u32l(b, p + 4)? as usize;
                let s = p + 8;
                ensure!(size <= b.len() - s, "Truncated WebP chunk");
                if tag == 0x56503858 {
                    ensure!(
                        size == 10 && b[s] & 0xc1 == 0 && b[s + 1..s + 4] == [0, 0, 0],
                        "Invalid WebP extended header"
                    );
                    width = 1 + b[s + 4] as u32 + 256 * b[s + 5] as u32 + 65536 * b[s + 6] as u32;
                    height = 1 + b[s + 7] as u32 + 256 * b[s + 8] as u32 + 65536 * b[s + 9] as u32;
                } else if tag == 0x56503820 && width == 0 {
                    ensure!(
                        size >= 10 && b[s + 3..s + 6] == [0x9d, 1, 0x2a],
                        "Invalid WebP frame"
                    );
                    width = (u16l(b, s + 6)? & 0x3fff) as u32;
                    height = (u16l(b, s + 8)? & 0x3fff) as u32;
                } else if tag == 0x5650384c && width == 0 {
                    ensure!(size >= 5 && b[s] == 0x2f, "Invalid WebP lossless");
                    let bits = u32l(b, s + 1)?;
                    width = (bits & 0x3fff) + 1;
                    height = ((bits >> 14) & 0x3fff) + 1;
                }
                p = s + size + size % 2;
            }
            ensure!(p == b.len(), "Invalid WebP end");
        }
    }
    ensure!(
        width > 0
            && height > 0
            && width <= 8192
            && height <= 8192
            && width as u64 * height as u64 <= 33_554_432,
        "Invalid raster dimensions"
    );
    Ok(())
}
fn read(b: &[u8], p: &mut usize) -> Result<u8> {
    let n = *b
        .get(*p)
        .ok_or_else(|| anyhow::anyhow!("Truncated font directory"))?;
    *p += 1;
    Ok(n)
}
fn base128(b: &[u8], p: &mut usize) -> Result<u64> {
    let mut n = 0u64;
    for i in 0..5 {
        let c = read(b, p)?;
        ensure!(
            !(i == 0 && c == 0x80) && n <= 0x1ffffff,
            "Invalid font integer"
        );
        n = n * 128 + (c & 127) as u64;
        if c & 128 == 0 {
            return Ok(n);
        }
    }
    anyhow::bail!("Invalid font integer")
}
fn u255(b: &[u8], p: &mut usize) -> Result<u16> {
    Ok(match read(b, p)? {
        253 => read(b, p)? as u16 * 256 + read(b, p)? as u16,
        254 => read(b, p)? as u16 + 506,
        255 => read(b, p)? as u16 + 253,
        n => n as u16,
    })
}
fn range(
    ranges: &mut Vec<(usize, usize)>,
    start: usize,
    size: usize,
    header: usize,
    len: usize,
) -> Result<()> {
    ensure!(
        size > 0 && start >= header && size <= len && start <= len - size,
        "Invalid font range"
    );
    ranges.push((start, start + size));
    Ok(())
}
fn font(media: &str, b: &[u8]) -> Result<()> {
    let woff = media == "font/woff";
    let header = if woff { 44 } else { 48 };
    ensure!(
        b.len() >= header
            && u32b(b, 0)? == if woff { 0x774f4646 } else { 0x774f4632 }
            && u32b(b, 8)? as usize == b.len()
            && u16b(b, 14)? == 0,
        "Invalid font header"
    );
    let count = u16b(b, 12)? as usize;
    ensure!(count > 0, "Empty font");
    let mut ranges = vec![];
    let mo = u32b(b, if woff { 24 } else { 28 })? as usize;
    let ml = u32b(b, if woff { 28 } else { 32 })? as usize;
    let original = u32b(b, if woff { 32 } else { 36 })?;
    let po = u32b(b, if woff { 36 } else { 40 })? as usize;
    let pl = u32b(b, if woff { 40 } else { 44 })? as usize;
    if mo > 0 {
        ensure!(original > 0, "Invalid font metadata");
        range(&mut ranges, mo, ml, header, b.len())?;
    } else {
        ensure!(ml == 0 && original == 0, "Invalid font metadata");
    }
    if po > 0 {
        range(&mut ranges, po, pl, header, b.len())?;
    } else {
        ensure!(pl == 0, "Invalid font private block");
    }
    let mut sfnt = 12 + 16 * count as u64;
    if woff {
        let end = 44 + 20 * count;
        ensure!(end <= b.len(), "Truncated WOFF directory");
        ranges.push((0, end));
        let mut tags = std::collections::BTreeSet::new();
        for i in 0..count {
            let p = 44 + 20 * i;
            let tag = u32b(b, p)?;
            let offset = u32b(b, p + 4)? as usize;
            let compressed = u32b(b, p + 8)? as usize;
            let length = u32b(b, p + 12)? as usize;
            ensure!(
                tags.insert(tag) && compressed <= length && offset.is_multiple_of(4),
                "Invalid WOFF table"
            );
            if length > 0 {
                range(&mut ranges, offset, compressed, header, b.len())?;
            } else {
                ensure!(
                    compressed == 0 && !(offset > end && offset > b.len()),
                    "Invalid WOFF empty table"
                );
            }
            sfnt += (length as u64).div_ceil(4) * 4;
        }
        ensure!(sfnt == u32b(b, 16)? as u64, "Invalid WOFF sfnt size");
    } else {
        let known: Vec<_>="cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill".split(' ').map(|s|s.replace('_'," ")).collect();
        let mut p = 48;
        let mut tags = std::collections::BTreeSet::new();
        for _ in 0..count {
            let flags = read(b, &mut p)?;
            let index = (flags & 63) as usize;
            let transform = flags >> 6;
            let tag = if index == 63 {
                (0..4)
                    .map(|_| read(b, &mut p).map(char::from))
                    .collect::<Result<String>>()?
            } else {
                known[index].clone()
            };
            ensure!(tags.insert(tag.clone()), "Duplicate font tag");
            let length = base128(b, &mut p)?;
            sfnt += length.div_ceil(4) * 4;
            let glyf = index == 10 || tag == "glyf";
            let loca = index == 11 || tag == "loca";
            let transformed = if glyf || loca {
                transform != 3
            } else {
                transform != 0
            };
            ensure!(
                !(glyf || loca) || transform == 0 || transform == 3,
                "Invalid font transform"
            );
            ensure!(
                glyf || loca || transform == 0 || (tag == "hmtx" && transform == 1),
                "Invalid font transform"
            );
            if transformed {
                let size = base128(b, &mut p)?;
                ensure!(!loca || size == 0, "Invalid transformed loca");
            }
        }
        if u32b(b, 4)? == 0x74746366 {
            for _ in 0..4 {
                read(b, &mut p)?;
            }
            let fonts = u255(b, &mut p)?;
            ensure!(fonts > 0, "Empty font collection");
            for _ in 0..fonts {
                let n = u255(b, &mut p)?;
                for _ in 0..4 {
                    read(b, &mut p)?;
                }
                for _ in 0..n {
                    ensure!(
                        (u255(b, &mut p)? as usize) < count,
                        "Invalid collection index"
                    );
                }
            }
        } else {
            ensure!(sfnt == u32b(b, 16)? as u64, "Invalid WOFF2 sfnt size");
        }
        ranges.push((0, p));
        range(&mut ranges, p, u32b(b, 20)? as usize, header, b.len())?;
    }
    ranges.sort_unstable();
    for pair in ranges.windows(2) {
        ensure!(pair[1].0 >= pair[0].1, "Overlapping font blocks");
    }
    Ok(())
}
