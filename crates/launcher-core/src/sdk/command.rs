//! JVM native search paths and profile environment additions, preserving argument order.
use super::*;

pub(super) fn include_profile_environment(
    command: &mut LaunchCommand,
    settings: &Settings,
    profile: &GameProfile,
) {
    if let Some(id) = &profile.overrides.argument_template
        && let Some(template) = settings
            .argument_templates
            .iter()
            .find(|template| &template.id == id)
    {
        crate::preferences::merge_environment(&mut command.env, &template.environment);
    }
    crate::preferences::merge_environment(&mut command.env, &profile.overrides.environment);
}

pub(super) fn include_extracted_natives(
    command: &mut LaunchCommand,
    natives: &Path,
    native_files: &[PathBuf],
) -> Result<()> {
    let natives = java_compatible_path(natives);
    // Metadata can select a nested directory while another JNI library lives at
    // the extraction root. Use the prepared instance's public layout and files
    // so both upstream compatibility copies and original nested entries work.
    if let Some(argument) = command
        .jvm_arguments
        .iter_mut()
        .rev()
        .find(|argument| argument.starts_with("-Djava.library.path="))
    {
        let mut paths: Vec<_> =
            std::env::split_paths(argument.trim_start_matches("-Djava.library.path="))
                .map(|path| java_compatible_path(&path))
                .collect();
        let mut extracted_roots = vec![natives.clone()];
        for file in native_files {
            let file = java_compatible_path(file);
            if file.starts_with(&natives)
                && let Some(parent) = file.parent()
            {
                extracted_roots.push(parent.to_owned());
            }
        }
        extracted_roots.sort();
        extracted_roots.dedup();
        for root in extracted_roots {
            if !paths.contains(&root) {
                paths.push(root);
            }
        }
        let paths = std::env::join_paths(paths).context("原生库搜索路径无效")?;
        *argument = format!(
            "-Djava.library.path={}",
            paths.to_str().context("原生库搜索路径编码无效")?
        );
    }
    Ok(())
}
