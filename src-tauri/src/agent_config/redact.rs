const MASK: &str = "••••••";
const SECRET_WORDS: &[&str] = &["token", "key", "secret", "password", "passwd", "auth", "cookie", "session", "credential"];

fn secret_name(name: &str) -> bool {
    let name = name.to_lowercase();
    SECRET_WORDS.iter().any(|w| name.contains(w))
}

pub fn looks_secret(text: &str) -> bool {
    text.len() >= 20
        && !text.starts_with(['/', '.', '~'])
        && text.chars().all(|c| c.is_ascii_alphanumeric() || "-_.=+/~".contains(c))
        && text.chars().any(|c| c.is_ascii_digit())
        && text.chars().any(|c| c.is_ascii_alphabetic())
}

pub fn url_host(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    authority.rsplit('@').next().unwrap_or_default().to_string()
}

pub fn mask_url(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else { return url.to_string() };
    let (rest, fragment) = rest.split_once('#').map_or((rest, None), |(r, f)| (r, Some(f)));
    let (rest, query) = rest.split_once('?').map_or((rest, None), |(r, q)| (r, Some(q)));
    let (authority, path) = rest.split_once('/').map_or((rest, None), |(a, p)| (a, Some(p)));
    let authority = match authority.rsplit_once('@') {
        Some((user, host)) => match user.split_once(':') {
            Some((name, _)) => format!("{name}:{MASK}@{host}"),
            None => format!("{MASK}@{host}"),
        },
        None => authority.to_string(),
    };
    let mut out = format!("{scheme}://{authority}");
    if let Some(path) = path {
        let segments: Vec<&str> = path.split('/').map(|s| if looks_secret(s) { MASK } else { s }).collect();
        out.push('/');
        out.push_str(&segments.join("/"));
    }
    if let Some(query) = query {
        let pairs: Vec<String> = query
            .split('&')
            .map(|pair| match pair.split_once('=') {
                Some((key, value)) if !value.is_empty() => format!("{key}={MASK}"),
                _ => pair.to_string(),
            })
            .collect();
        out.push('?');
        out.push_str(&pairs.join("&"));
    }
    if fragment.is_some_and(|f| !f.is_empty()) {
        out.push_str(&format!("#{MASK}"));
    }
    out
}

pub fn mask_header(header: &str) -> String {
    match header.split_once(':') {
        Some((name, _)) if secret_name(name) => format!("{name}: {MASK}"),
        Some((name, value)) => format!("{name}:{}", mask_text(value)),
        None => mask_text(header),
    }
}

fn is_quote(c: char) -> bool {
    c == '"' || c == '\''
}

fn mask_word(word: &str) -> String {
    let core = word.trim_matches(is_quote);
    if core.is_empty() {
        return word.to_string();
    }
    let masked = if core.contains("://") {
        mask_url(core)
    } else if looks_secret(core) {
        MASK.to_string()
    } else {
        match core.split_once('=') {
            Some((name, value)) if !value.is_empty() && secret_name(name) => format!("{name}={MASK}"),
            _ => return word.to_string(),
        }
    };
    word.replacen(core, &masked, 1)
}

fn hide_word(word: &str) -> String {
    let core = word.trim_matches(is_quote);
    if core.is_empty() {
        word.to_string()
    } else {
        word.replacen(core, MASK, 1)
    }
}

pub fn mask_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut hide_next = false;
    for piece in text.split_inclusive(char::is_whitespace) {
        let word = piece.trim_end_matches(char::is_whitespace);
        let space = &piece[word.len()..];
        if word.is_empty() {
            out.push_str(space);
            continue;
        }
        if std::mem::take(&mut hide_next) {
            out.push_str(&hide_word(word));
        } else if matches!(word.trim_matches(is_quote).to_lowercase().as_str(), "bearer" | "basic" | "token") {
            out.push_str(word);
            hide_next = true;
        } else {
            out.push_str(&mask_word(word));
        }
        out.push_str(space);
    }
    out
}

fn is_secret_flag(flag: &str) -> bool {
    flag.starts_with('-') && secret_name(flag)
}

fn is_header_flag(flag: &str) -> bool {
    matches!(flag, "-H" | "--header" | "--headers")
}

pub fn mask_args(args: &[String]) -> Vec<String> {
    let mut masked = Vec::with_capacity(args.len());
    let mut next: Option<fn(&str) -> String> = None;
    for arg in args {
        if let Some(mask) = next.take() {
            masked.push(mask(arg));
            continue;
        }
        if let Some((flag, _)) = arg.split_once('=').filter(|(f, _)| is_secret_flag(f)) {
            masked.push(format!("{flag}={MASK}"));
        } else if let Some((flag, value)) = arg.split_once('=').filter(|(f, _)| is_header_flag(f)) {
            masked.push(format!("{flag}={}", mask_header(value)));
        } else {
            masked.push(mask_text(arg));
            if is_header_flag(arg) {
                next = Some(mask_header);
            } else if is_secret_flag(arg) {
                next = Some(|_| MASK.to_string());
            }
        }
    }
    masked
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_secret_looking_args() {
        let masked = mask_args(&[
            "-y".into(),
            "mcp-server".into(),
            "--api-key".into(),
            "abc".into(),
            "--token=xyz".into(),
            "postgres://u:pw@host/db".into(),
            "--header".into(),
            "Authorization: Bearer sk-live-abc".into(),
            "-H".into(),
            "X-Trace: visible".into(),
            "/home/me/work/project-2024/some/long/path".into(),
        ]);
        assert_eq!(
            masked,
            [
                "-y",
                "mcp-server",
                "--api-key",
                "••••••",
                "--token=••••••",
                "postgres://u:••••••@host/db",
                "--header",
                "Authorization: ••••••",
                "-H",
                "X-Trace: visible",
                "/home/me/work/project-2024/some/long/path"
            ]
        );
    }

    #[test]
    fn masks_urls() {
        assert_eq!(mask_url("https://api.example.com/v1?api_key=abc&mode="), "https://api.example.com/v1?api_key=••••••&mode=");
        assert_eq!(mask_url("https://mcp.zapier.com/api/mcp/sk-ak-12345678901234567890/sse"), "https://mcp.zapier.com/api/mcp/••••••/sse");
        assert_eq!(mask_url("https://ghp_abc@github.com/x"), "https://••••••@github.com/x");
        assert_eq!(mask_url("http://localhost:3000/mcp"), "http://localhost:3000/mcp");
        assert_eq!(url_host("https://user:pw@host.example:8443/path?x=1"), "host.example:8443");
    }

    #[test]
    fn masks_commands() {
        assert_eq!(
            mask_text("curl -H 'Authorization: Bearer abc123' https://hooks.slack.com/services/T0001/B0002/abcdefghijklmnop12345678"),
            "curl -H 'Authorization: Bearer ••••••' https://hooks.slack.com/services/T0001/B0002/••••••"
        );
        assert_eq!(mask_text("echo API_TOKEN=abc && run"), "echo API_TOKEN=•••••• && run");
        assert_eq!(mask_text("npm run lint"), "npm run lint");
    }
}
