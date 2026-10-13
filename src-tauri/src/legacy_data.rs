use std::{
    fs, io,
    path::{Path, PathBuf},
};

const OLD_IDENTIFIER_PART: &str = "claudedeck";
const NEW_IDENTIFIER_PART: &str = "agentdeck";
const OLD_CACHE_DIR: &str = "claude-deck";
pub const CACHE_DIR: &str = "agent-deck";
const LOCAL_STORAGE: [&str; 3] = ["EBWebView", "Default", "Local Storage"];

pub fn carry_over(identifier: &str) {
    let old = identifier.replace(NEW_IDENTIFIER_PART, OLD_IDENTIFIER_PART);
    if old == identifier {
        return;
    }
    if let Some(roaming) = dirs::data_dir() {
        copy_missing(&roaming.join(&old), &roaming.join(identifier));
    }
    if let Some(local) = dirs::data_local_dir() {
        let storage: PathBuf = LOCAL_STORAGE.iter().collect();
        copy_missing(&local.join(&old).join(&storage), &local.join(identifier).join(&storage));
        copy_missing(&local.join(OLD_CACHE_DIR), &local.join(CACHE_DIR));
    }
}

fn copy_missing(from: &Path, to: &Path) {
    if from.is_dir() && !to.exists() {
        let _ = copy_tree(from, to);
    }
}

fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            let _ = fs::copy(entry.path(), target);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deck-legacy-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn copies_everything_when_the_new_folder_is_missing() {
        let dir = scratch("copy");
        let old = dir.join("old");
        fs::create_dir_all(old.join("notes")).unwrap();
        fs::write(old.join(".window-state.json"), "{}").unwrap();
        fs::write(old.join("notes").join("a.md"), "hello").unwrap();
        copy_missing(&old, &dir.join("new"));
        assert_eq!(fs::read_to_string(dir.join("new").join("notes").join("a.md")).unwrap(), "hello");
        assert_eq!(fs::read_to_string(dir.join("new").join(".window-state.json")).unwrap(), "{}");
        assert_eq!(fs::read_to_string(old.join("notes").join("a.md")).unwrap(), "hello");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn leaves_an_existing_new_folder_alone() {
        let dir = scratch("keep");
        fs::create_dir_all(dir.join("old")).unwrap();
        fs::write(dir.join("old").join("a.txt"), "old").unwrap();
        fs::create_dir_all(dir.join("new")).unwrap();
        fs::write(dir.join("new").join("a.txt"), "new").unwrap();
        copy_missing(&dir.join("old"), &dir.join("new"));
        assert_eq!(fs::read_to_string(dir.join("new").join("a.txt")).unwrap(), "new");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn ignores_a_missing_old_folder() {
        let dir = scratch("none");
        copy_missing(&dir.join("old"), &dir.join("new"));
        assert!(!dir.join("new").exists());
    }
}
