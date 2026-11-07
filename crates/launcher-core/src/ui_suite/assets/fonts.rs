use std::collections::BTreeSet;

use anyhow::{Result, ensure};

use super::{u16b, u32b};

#[derive(Clone, Copy)]
enum Format {
    Woff,
    Woff2,
}

impl Format {
    fn header_size(self) -> usize {
        match self {
            Self::Woff => 44,
            Self::Woff2 => 48,
        }
    }

    fn signature(self) -> u32 {
        match self {
            Self::Woff => 0x774f4646,
            Self::Woff2 => 0x774f4632,
        }
    }

    fn metadata_offset(self) -> usize {
        match self {
            Self::Woff => 24,
            Self::Woff2 => 28,
        }
    }
}

struct Blocks {
    ranges: Vec<(usize, usize)>,
    header_size: usize,
    file_size: usize,
}

impl Blocks {
    fn add(&mut self, start: usize, size: usize) -> Result<()> {
        ensure!(
            size > 0
                && start >= self.header_size
                && size <= self.file_size
                && start <= self.file_size - size,
            "Invalid font range"
        );
        self.ranges.push((start, start + size));
        Ok(())
    }

    fn validate(mut self) -> Result<()> {
        self.ranges.sort_unstable();
        for pair in self.ranges.windows(2) {
            ensure!(pair[1].0 >= pair[0].1, "Overlapping font blocks");
        }
        Ok(())
    }
}

pub(super) fn inspect(media: &str, bytes: &[u8]) -> Result<()> {
    let format = match media {
        "font/woff" => Format::Woff,
        "font/woff2" => Format::Woff2,
        _ => anyhow::bail!("Unsupported suite asset media type"),
    };
    let count = validate_header(bytes, format)?;
    let mut blocks = Blocks {
        ranges: vec![],
        header_size: format.header_size(),
        file_size: bytes.len(),
    };
    validate_optional_blocks(bytes, format, &mut blocks)?;
    match format {
        Format::Woff => validate_woff_directory(bytes, count, &mut blocks)?,
        Format::Woff2 => validate_woff2_directory(bytes, count, &mut blocks)?,
    }
    blocks.validate()
}

fn validate_header(bytes: &[u8], format: Format) -> Result<usize> {
    ensure!(
        bytes.len() >= format.header_size()
            && u32b(bytes, 0)? == format.signature()
            && u32b(bytes, 8)? as usize == bytes.len()
            && u16b(bytes, 14)? == 0,
        "Invalid font header"
    );
    let count = u16b(bytes, 12)? as usize;
    ensure!(count > 0, "Empty font");
    Ok(count)
}

fn validate_optional_blocks(bytes: &[u8], format: Format, blocks: &mut Blocks) -> Result<()> {
    let offset = format.metadata_offset();
    let metadata_start = u32b(bytes, offset)? as usize;
    let metadata_size = u32b(bytes, offset + 4)? as usize;
    let original_size = u32b(bytes, offset + 8)?;
    let private_start = u32b(bytes, offset + 12)? as usize;
    let private_size = u32b(bytes, offset + 16)? as usize;
    if metadata_start > 0 {
        ensure!(original_size > 0, "Invalid font metadata");
        blocks.add(metadata_start, metadata_size)?;
    } else {
        ensure!(
            metadata_size == 0 && original_size == 0,
            "Invalid font metadata"
        );
    }
    if private_start > 0 {
        blocks.add(private_start, private_size)?;
    } else {
        ensure!(private_size == 0, "Invalid font private block");
    }
    Ok(())
}

fn validate_woff_directory(bytes: &[u8], count: usize, blocks: &mut Blocks) -> Result<()> {
    let end = 44 + 20 * count;
    ensure!(end <= bytes.len(), "Truncated WOFF directory");
    blocks.ranges.push((0, end));
    let mut tags = BTreeSet::new();
    let mut sfnt_size = 12 + 16 * count as u64;
    for index in 0..count {
        let position = 44 + 20 * index;
        let tag = u32b(bytes, position)?;
        let offset = u32b(bytes, position + 4)? as usize;
        let compressed = u32b(bytes, position + 8)? as usize;
        let length = u32b(bytes, position + 12)? as usize;
        ensure!(
            tags.insert(tag) && compressed <= length && offset.is_multiple_of(4),
            "Invalid WOFF table"
        );
        if length > 0 {
            blocks.add(offset, compressed)?;
        } else {
            ensure!(
                compressed == 0 && !(offset > end && offset > bytes.len()),
                "Invalid WOFF empty table"
            );
        }
        sfnt_size += (length as u64).div_ceil(4) * 4;
    }
    ensure!(
        sfnt_size == u32b(bytes, 16)? as u64,
        "Invalid WOFF sfnt size"
    );
    Ok(())
}

const KNOWN_TAGS: [&str; 63] = [
    "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca",
    "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
    "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
    "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
    "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
    "Gloc", "Feat", "Sill",
];

fn validate_woff2_directory(bytes: &[u8], count: usize, blocks: &mut Blocks) -> Result<()> {
    let mut position = 48;
    let mut tags = BTreeSet::new();
    let mut sfnt_size = 12 + 16 * count as u64;
    for _ in 0..count {
        let (tag, length) = read_woff2_table(bytes, &mut position)?;
        ensure!(tags.insert(tag), "Duplicate font tag");
        sfnt_size += length.div_ceil(4) * 4;
    }
    if u32b(bytes, 4)? == 0x74746366 {
        validate_woff2_collection(bytes, &mut position, count)?;
    } else {
        ensure!(
            sfnt_size == u32b(bytes, 16)? as u64,
            "Invalid WOFF2 sfnt size"
        );
    }
    blocks.ranges.push((0, position));
    blocks.add(position, u32b(bytes, 20)? as usize)
}

fn read_woff2_table(bytes: &[u8], position: &mut usize) -> Result<(String, u64)> {
    let flags = read(bytes, position)?;
    let index = (flags & 63) as usize;
    let transform = flags >> 6;
    let tag = if index == 63 {
        (0..4)
            .map(|_| read(bytes, position).map(char::from))
            .collect::<Result<String>>()?
    } else {
        KNOWN_TAGS[index].to_owned()
    };
    let length = base128(bytes, position)?;
    let glyf = tag == "glyf";
    let loca = tag == "loca";
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
        let size = base128(bytes, position)?;
        ensure!(!loca || size == 0, "Invalid transformed loca");
    }
    Ok((tag, length))
}

fn validate_woff2_collection(bytes: &[u8], position: &mut usize, count: usize) -> Result<()> {
    for _ in 0..4 {
        read(bytes, position)?;
    }
    let fonts = u255(bytes, position)?;
    ensure!(fonts > 0, "Empty font collection");
    for _ in 0..fonts {
        let tables = u255(bytes, position)?;
        for _ in 0..4 {
            read(bytes, position)?;
        }
        for _ in 0..tables {
            ensure!(
                (u255(bytes, position)? as usize) < count,
                "Invalid collection index"
            );
        }
    }
    Ok(())
}

fn read(bytes: &[u8], position: &mut usize) -> Result<u8> {
    let value = *bytes
        .get(*position)
        .ok_or_else(|| anyhow::anyhow!("Truncated font directory"))?;
    *position += 1;
    Ok(value)
}

fn base128(bytes: &[u8], position: &mut usize) -> Result<u64> {
    let mut value = 0u64;
    for index in 0..5 {
        let byte = read(bytes, position)?;
        ensure!(
            !(index == 0 && byte == 0x80) && value <= 0x1ffffff,
            "Invalid font integer"
        );
        value = value * 128 + (byte & 127) as u64;
        if byte & 128 == 0 {
            return Ok(value);
        }
    }
    anyhow::bail!("Invalid font integer")
}

fn u255(bytes: &[u8], position: &mut usize) -> Result<u16> {
    Ok(match read(bytes, position)? {
        253 => read(bytes, position)? as u16 * 256 + read(bytes, position)? as u16,
        254 => read(bytes, position)? as u16 + 506,
        255 => read(bytes, position)? as u16 + 253,
        value => value as u16,
    })
}
