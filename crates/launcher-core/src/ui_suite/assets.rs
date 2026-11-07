//! DATA-only container/header checks, mirroring the host inspectors.
use super::model::ASSET;
use anyhow::{Result, ensure};

mod fonts;
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
        "font/woff" | "font/woff2" => fonts::inspect(media, b),
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
#[cfg(test)]
mod tests {
    use super::*;

    fn set32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
    }

    fn woff() -> Vec<u8> {
        let mut bytes = vec![0; 68];
        bytes[..4].copy_from_slice(b"wOFF");
        set32(&mut bytes, 4, 0x10000);
        set32(&mut bytes, 8, 68);
        bytes[12..14].copy_from_slice(&1u16.to_be_bytes());
        set32(&mut bytes, 16, 32);
        bytes[44..48].copy_from_slice(b"cmap");
        set32(&mut bytes, 48, 64);
        set32(&mut bytes, 52, 4);
        set32(&mut bytes, 56, 4);
        bytes
    }

    fn woff2(directory: &[u8], tables: u16, sfnt_size: u32) -> Vec<u8> {
        let mut bytes = vec![0; 48 + directory.len() + 1];
        let len = bytes.len() as u32;
        bytes[..4].copy_from_slice(b"wOF2");
        set32(&mut bytes, 4, 0x10000);
        set32(&mut bytes, 8, len);
        bytes[12..14].copy_from_slice(&tables.to_be_bytes());
        set32(&mut bytes, 16, sfnt_size);
        set32(&mut bytes, 20, 1);
        bytes[48..48 + directory.len()].copy_from_slice(directory);
        bytes
    }

    #[test]
    fn font_formats_accept_valid_directories_and_separate_optional_blocks() {
        inspect("font/woff", &woff()).unwrap();
        inspect("font/woff2", &woff2(&[0, 4], 1, 32)).unwrap();
        let mut with_blocks = woff();
        with_blocks.extend_from_slice(&[0; 8]);
        set32(&mut with_blocks, 8, 76);
        set32(&mut with_blocks, 24, 68);
        set32(&mut with_blocks, 28, 4);
        set32(&mut with_blocks, 32, 4);
        set32(&mut with_blocks, 36, 72);
        set32(&mut with_blocks, 40, 4);
        inspect("font/woff", &with_blocks).unwrap();
        set32(&mut with_blocks, 36, 68);
        assert!(inspect("font/woff", &with_blocks).is_err());
    }

    #[test]
    fn woff_rejects_truncated_misaligned_and_oversized_tables() {
        for (offset, value) in [(48, 63), (52, 5), (56, 8), (16, 33), (28, 4)] {
            let mut bytes = woff();
            set32(&mut bytes, offset, value);
            assert!(inspect("font/woff", &bytes).is_err(), "offset {offset}");
        }
        let mut truncated = woff();
        truncated.truncate(63);
        set32(&mut truncated, 8, 63);
        assert!(inspect("font/woff", &truncated).is_err());
    }

    #[test]
    fn woff2_rejects_alias_duplicates_reserved_transforms_and_bad_collections() {
        for (directory, tables) in [
            (vec![0, 0, 63, b'c', b'm', b'a', b'p', 0], 2),
            (vec![64, 0, 0], 1),
            (vec![74, 0, 0], 1),
            (vec![11, 0, 1], 1),
            (vec![0, 0x80, 0], 1),
        ] {
            assert!(
                inspect(
                    "font/woff2",
                    &woff2(&directory, tables, 12 + 16 * tables as u32)
                )
                .is_err()
            );
        }
        // cmap, TTC version, one font with one table, flavor, table index.
        let mut collection = woff2(&[0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0], 1, 28);
        set32(&mut collection, 4, 0x74746366);
        inspect("font/woff2", &collection).unwrap();
        collection[60] = 1;
        assert!(inspect("font/woff2", &collection).is_err());
    }
}
