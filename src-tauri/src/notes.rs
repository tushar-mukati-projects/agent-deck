use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::Context;
use serde::Serialize;

use crate::util::{mtime_ms, path_mtime_ms};

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub text: String,
    pub modified_ms: u64,
}

pub fn list(dir: &Path) -> anyhow::Result<Vec<Note>> {
    let entries = fs::read_dir(dir).context("Couldn't read the notes folder")?;
    let mut notes: Vec<Note> = entries.flatten().filter_map(|entry| read(&entry.path())).collect();
    notes.sort_by_key(|note| std::cmp::Reverse(note.modified_ms));
    Ok(notes)
}

fn read(path: &Path) -> Option<Note> {
    let id = path.file_stem()?.to_str()?;
    if path.extension()? != "md" || !valid_id(id) {
        return None;
    }
    let meta = fs::metadata(path).ok()?;
    let text = String::from_utf8_lossy(&fs::read(path).ok()?).into_owned();
    Some(Note { id: id.to_string(), text, modified_ms: mtime_ms(&meta) })
}

pub fn save(dir: &Path, id: &str, text: &str) -> anyhow::Result<u64> {
    let path = note_path(dir, id)?;
    let tmp = dir.join(format!(".{id}.tmp"));
    let saved = fs::write(&tmp, text).and_then(|()| fs::rename(&tmp, &path));
    if saved.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    saved.context("Couldn't save the note")?;
    Ok(path_mtime_ms(&path))
}

pub fn delete(dir: &Path, id: &str) -> anyhow::Result<()> {
    let path = note_path(dir, id)?;
    if !path.exists() {
        return Ok(());
    }
    trash::delete(path).context("Couldn't move the note to the Recycle Bin")
}

fn note_path(dir: &Path, id: &str) -> anyhow::Result<PathBuf> {
    anyhow::ensure!(valid_id(id), "Invalid note id: {id}");
    Ok(dir.join(format!("{id}.md")))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("agent-deck-notes-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saves_and_lists_newest_first() {
        let dir = scratch("list");
        save(&dir, "2026-01-01-000000-000", "older").unwrap();
        let file = fs::File::options().write(true).open(dir.join("2026-01-01-000000-000.md")).unwrap();
        file.set_modified(std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1)).unwrap();
        save(&dir, "2026-01-02-000000-000", "newer\nline").unwrap();
        fs::write(dir.join("ignored.txt"), "x").unwrap();
        fs::write(dir.join("bad id.md"), "x").unwrap();
        let notes = list(&dir).unwrap();
        let ids: Vec<&str> = notes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, ["2026-01-02-000000-000", "2026-01-01-000000-000"]);
        assert_eq!(notes[0].text, "newer\nline");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn overwrites_without_leaving_temp_files() {
        let dir = scratch("overwrite");
        save(&dir, "note-1", "first").unwrap();
        save(&dir, "note-1", "second").unwrap();
        assert_eq!(fs::read_to_string(dir.join("note-1.md")).unwrap(), "second");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_ids_that_escape_the_folder() {
        let dir = scratch("ids");
        for id in ["", "../x", "a/b", "a.b", "a\\b"] {
            assert!(save(&dir, id, "x").is_err(), "{id:?} should be rejected");
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn deleting_an_unsaved_note_is_a_no_op() {
        let dir = scratch("delete");
        assert!(delete(&dir, "never-saved").is_ok());
        fs::remove_dir_all(&dir).unwrap();
    }
}
