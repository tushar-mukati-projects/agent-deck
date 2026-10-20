use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

use aho_corasick::AhoCorasick;
use rayon::prelude::*;
use serde::Serialize;

use super::{preview, session_files, session_id_of, transcript::line_items};
use crate::util::raw_lines;

const SEARCH_HITS_PER_SESSION: usize = 3;
const SNIPPET_RADIUS: usize = 90;

static SEARCH_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub session_id: String,
    pub role: String,
    pub snippet: String,
}

pub struct Needle {
    pub lower: String,
    pub prefilter: String,
    pub fold_ascii: bool,
    finder: AhoCorasick,
}

impl Needle {
    pub fn new(query: &str) -> Option<Self> {
        let lower = query.trim().to_lowercase();
        if lower.chars().count() < 2 {
            return None;
        }
        let escaped = serde_json::to_string(&lower).ok()?;
        let escaped = &escaped[1..escaped.len() - 1];
        let ascii_run = escaped.split(|c: char| !c.is_ascii()).max_by_key(|run| run.len()).filter(|run| run.len() >= 2);
        let (prefilter, fold_ascii) = match ascii_run {
            Some(run) => (run.to_string(), true),
            None => (escaped.to_string(), false),
        };
        let finder = AhoCorasick::builder().ascii_case_insensitive(fold_ascii).build([&prefilter]).ok()?;
        Some(Self { lower, prefilter, fold_ascii, finder })
    }

    fn may_match(&self, line: &[u8]) -> bool {
        self.finder.is_match(line)
    }
}

fn snippet_around(text: &str, needle_lower: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars.iter().flat_map(|c| c.to_lowercase()).collect();
    let needle: Vec<char> = needle_lower.chars().collect();
    if lower.len() != chars.len() || needle.is_empty() {
        return text.to_lowercase().contains(needle_lower).then(|| preview(text, SNIPPET_RADIUS * 2));
    }
    let index = lower.windows(needle.len()).position(|w| w == needle.as_slice())?;
    let start = index.saturating_sub(SNIPPET_RADIUS);
    let end = (index + needle.len() + SNIPPET_RADIUS).min(chars.len());
    let body = preview(&chars[start..end].iter().collect::<String>(), usize::MAX);
    Some(format!("{}{}{}", if start > 0 { "…" } else { "" }, body, if end < chars.len() { "…" } else { "" }))
}

pub fn search_lines<S: AsRef<str>>(session_id: &str, lines: impl Iterator<Item = S>, needle: &Needle) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    for line in lines {
        let mut items = Vec::new();
        line_items(line.as_ref(), false, &mut items);
        for item in items.into_iter().filter(|i| i.kind == "text") {
            if let Some(snippet) = snippet_around(&item.text, &needle.lower) {
                hits.push(SearchHit { session_id: session_id.to_string(), role: item.role, snippet });
            }
        }
        if hits.len() >= SEARCH_HITS_PER_SESSION {
            break;
        }
    }
    hits.truncate(SEARCH_HITS_PER_SESSION);
    hits
}

fn search_file(path: &Path, needle: &Needle, generation: u64) -> Vec<SearchHit> {
    let Ok(file) = fs::File::open(path) else { return Vec::new() };
    let session_id = session_id_of(&path.to_string_lossy());
    let candidates = raw_lines(file)
        .take_while(|_| SEARCH_GENERATION.load(Ordering::Relaxed) == generation)
        .filter(|line| needle.may_match(line))
        .filter_map(|line| String::from_utf8(line).ok());
    search_lines(&session_id, candidates, needle)
}

pub fn begin_search() -> u64 {
    SEARCH_GENERATION.fetch_add(1, Ordering::Relaxed) + 1
}

pub fn search_is_current(generation: u64) -> bool {
    SEARCH_GENERATION.load(Ordering::Relaxed) == generation
}

pub fn search(needle: &Needle, generation: u64) -> Vec<SearchHit> {
    session_files().par_iter().flat_map_iter(|(path, _, _)| search_file(path, needle, generation)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_needles_match_escaped_json_and_unicode() {
        let needle = Needle::new(r"C:\Users").unwrap();
        let line = serde_json::json!({"type":"user","message":{"content":r"look in C:\Users\me"}}).to_string();
        assert!(needle.may_match(line.as_bytes()));
        assert_eq!(search_lines("s", std::iter::once(line), &needle).len(), 1);
        let cafe = Needle::new("café").unwrap();
        let upper = serde_json::json!({"type":"user","message":{"content":"CAFÉ menu"}}).to_string();
        assert!(cafe.may_match(upper.as_bytes()));
        assert_eq!(search_lines("s", std::iter::once(upper), &cafe)[0].snippet, "CAFÉ menu");
        assert!(Needle::new("x").is_none());
    }
}
