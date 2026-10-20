use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::Context;

use crate::{util::guarded, wsl};

pub fn create(dir: &str, name: &str, is_dir: bool) -> anyhow::Result<String> {
    let target = child(dir, name)?;
    anyhow::ensure!(!target.exists(), "{name} already exists here");
    let created = if is_dir { fs::create_dir(&target) } else { fs::File::create_new(&target).map(drop) };
    created.with_context(|| format!("Couldn't create {name}"))?;
    Ok(Path::new(dir).join(name).to_string_lossy().into_owned())
}

pub fn rename(path: &str, name: &str) -> anyhow::Result<String> {
    let source = Path::new(path);
    guarded(source)?;
    let dir = source.parent().context("A drive can't be renamed")?;
    let target = child(&dir.to_string_lossy(), name)?;
    let case_only = source.file_name().is_some_and(|old| old.to_string_lossy().eq_ignore_ascii_case(name));
    anyhow::ensure!(case_only || !target.exists(), "{name} already exists here");
    fs::rename(source, dir.join(name)).with_context(|| format!("Couldn't rename {path}"))?;
    Ok(dir.join(name).to_string_lossy().into_owned())
}

pub fn delete(path: &str) -> anyhow::Result<()> {
    guarded(Path::new(path))?;
    let meta = fs::symlink_metadata(path).with_context(|| format!("Can't find {path}"))?;
    if wsl::parse_host_path(path).is_none() {
        return trash::delete(path).with_context(|| format!("Couldn't move {path} to the Recycle Bin"));
    }
    let removed = if meta.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path).or_else(|_| fs::remove_dir(path)) };
    removed.with_context(|| format!("Couldn't delete {path}"))
}

fn child(dir: &str, name: &str) -> anyhow::Result<PathBuf> {
    anyhow::ensure!(
        !name.is_empty() && !name.contains(['/', '\\']) && name != "." && name != "..",
        "Enter a name without / or \\"
    );
    let parent = guarded(Path::new(dir))?;
    anyhow::ensure!(parent.is_dir(), "{dir} isn't a folder");
    guarded(&parent.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("agent-deck-entries-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn creates_files_and_folders_and_refuses_bad_or_taken_names() {
        let dir = scratch("create");
        let root = dir.to_string_lossy();
        assert_eq!(create(&root, "a.txt", false).unwrap(), dir.join("a.txt").to_string_lossy());
        assert!(dir.join("a.txt").is_file());
        create(&root, "src", true).unwrap();
        assert!(dir.join("src").is_dir());
        for name in ["a.txt", "src", "", ".", "..", "a/b", "a\\b"] {
            assert!(create(&root, name, false).is_err(), "name: {name}");
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn renames_and_allows_only_a_case_change_onto_itself() {
        let dir = scratch("rename");
        let root = dir.to_string_lossy();
        create(&root, "a.txt", false).unwrap();
        create(&root, "c.txt", false).unwrap();
        let renamed = rename(&dir.join("a.txt").to_string_lossy(), "b.txt").unwrap();
        assert_eq!(renamed, dir.join("b.txt").to_string_lossy());
        assert!(!dir.join("a.txt").exists());
        rename(&renamed, "B.txt").unwrap();
        assert!(fs::read_dir(&dir).unwrap().flatten().any(|e| e.file_name() == "B.txt"));
        assert!(rename(&dir.join("B.txt").to_string_lossy(), "c.txt").is_err());
        assert!(rename(&dir.join("B.txt").to_string_lossy(), "x/y.txt").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
