use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
};

use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    utils::mime_type::MimeType,
};

use crate::util::guarded;

pub const SCHEME: &str = "deckfile";
const MAX_RANGE_BYTES: u64 = 4 * 1024 * 1024;
const SNIFF_BYTES: u64 = 8192;
const SVG_POLICY: &str = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

pub fn respond(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    serve(request).unwrap_or_else(|status| Response::builder().status(status).body(Vec::new()).unwrap_or_default())
}

pub fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let last = len.checked_sub(1)?;
    let spec = header.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (from, to) = spec.split_once('-')?;
    let (start, end) = if from.is_empty() {
        let suffix: u64 = to.parse().ok().filter(|n| *n > 0)?;
        (len.saturating_sub(suffix), last)
    } else {
        let start: u64 = from.parse().ok()?;
        let end = if to.is_empty() { last } else { to.parse::<u64>().ok()?.min(last) };
        (start, end)
    };
    (start <= end).then_some((start, end))
}

fn content_type(head: &[u8], path: &str) -> String {
    let mime = MimeType::parse_with_fallback(head, &path.to_lowercase(), MimeType::OctetStream);
    let essence = mime.split(';').next().unwrap_or_default().trim();
    if matches!(essence, "text/html" | "application/xhtml+xml" | "text/xml" | "application/xml" | "text/javascript") {
        "text/plain; charset=utf-8".into()
    } else {
        mime
    }
}

fn read_span(file: &mut File, start: u64, len: u64) -> io::Result<Vec<u8>> {
    let mut buf = Vec::with_capacity(len as usize);
    file.seek(SeekFrom::Start(start))?;
    file.take(len).read_to_end(&mut buf)?;
    Ok(buf)
}

fn serve(request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, StatusCode> {
    let encoded = request.uri().path().trim_start_matches('/');
    let path = percent_encoding::percent_decode_str(encoded).decode_utf8().map_err(|_| StatusCode::BAD_REQUEST)?.to_string();
    let target = guarded(Path::new(&path)).map_err(|_| StatusCode::FORBIDDEN)?;
    let mut file = File::open(&target).map_err(|e| match e.kind() {
        io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::FORBIDDEN,
    })?;
    let meta = file.metadata().map_err(|_| StatusCode::FORBIDDEN)?;
    if !meta.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    let len = meta.len();
    let head = read_span(&mut file, 0, len.min(SNIFF_BYTES)).map_err(|_| StatusCode::FORBIDDEN)?;
    let mime = content_type(&head, &path);
    let mut response = Response::builder()
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Content-Type-Options", "nosniff");
    if mime.starts_with("image/svg") {
        response = response.header(header::CONTENT_SECURITY_POLICY, SVG_POLICY);
    }
    response = response.header(header::CONTENT_TYPE, mime);
    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
    let built = match range {
        Some(range) => {
            let Some((start, end)) = parse_range(range, len) else {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                    .body(Vec::new())
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
            };
            let end = end.min(start + MAX_RANGE_BYTES - 1);
            let body = read_span(&mut file, start, end + 1 - start).map_err(|_| StatusCode::FORBIDDEN)?;
            response
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                .header(header::CONTENT_LENGTH, body.len())
                .body(body)
        }
        None if request.method() == Method::HEAD => response.header(header::CONTENT_LENGTH, len).body(Vec::new()),
        None => {
            let body = if len <= SNIFF_BYTES { head } else { read_span(&mut file, 0, len).map_err(|_| StatusCode::FORBIDDEN)? };
            response.header(header::CONTENT_LENGTH, body.len()).body(body)
        }
    };
    built.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_byte_ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=90-500", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=0-1, 5-6", 100), Some((0, 1)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("bytes=5-2", 100), None);
        assert_eq!(parse_range("bytes=0-", 0), None);
        assert_eq!(parse_range("items=0-1", 100), None);
    }

    #[test]
    fn never_renders_documents() {
        assert_eq!(content_type(b"<html><script>", r"C:\x\page.html"), "text/plain; charset=utf-8");
        assert_eq!(content_type(b"%PDF-1.7", r"C:\x\a.pdf"), "application/pdf");
        assert_eq!(content_type(b"<svg", r"C:\x\LOGO.SVG"), "image/svg+xml");
        assert_eq!(content_type(b"????", r"C:\x\a.unknown"), "application/octet-stream");
    }

    #[test]
    fn serves_files_and_ranges() {
        let dir = std::env::temp_dir().join(format!("deck-proto-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.bin");
        std::fs::write(&file, b"0123456789").unwrap();
        let uri = format!("http://deckfile.localhost/{}", percent_encoding::utf8_percent_encode(&file.to_string_lossy(), percent_encoding::NON_ALPHANUMERIC));
        let full = respond(&Request::builder().uri(format!("{uri}?v=3")).body(Vec::new()).unwrap());
        assert_eq!((full.status(), full.body().as_slice()), (StatusCode::OK, &b"0123456789"[..]));
        let part = respond(&Request::builder().uri(&uri).header("Range", "bytes=2-4").body(Vec::new()).unwrap());
        assert_eq!((part.status(), part.body().as_slice()), (StatusCode::PARTIAL_CONTENT, &b"234"[..]));
        assert_eq!(part.headers()[header::CONTENT_RANGE], "bytes 2-4/10");
        let unc = percent_encoding::utf8_percent_encode(r"\\attacker\share\a.png", percent_encoding::NON_ALPHANUMERIC);
        let blocked = respond(&Request::builder().uri(format!("http://deckfile.localhost/{unc}")).body(Vec::new()).unwrap());
        assert_eq!(blocked.status(), StatusCode::FORBIDDEN);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
