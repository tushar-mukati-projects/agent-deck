const UNC_PREFIX: &str = r"\\wsl.localhost\";

pub fn host_path(distro: &str, linux_path: &str) -> String {
    format!("{UNC_PREFIX}{distro}{}", linux_path.replace('/', "\\"))
}

pub fn normalize_path(path: &str) -> String {
    match parse_host_path(path) {
        Some((distro, linux)) => host_path(&distro, &linux),
        None => path.to_string(),
    }
}

pub(super) fn host_of(distro: &str, path: &str) -> String {
    if path.starts_with('/') {
        host_path(distro, path)
    } else {
        path.to_string()
    }
}

pub fn parse_host_path(path: &str) -> Option<(String, String)> {
    let lower = path.to_lowercase();
    let rest = [r"\\wsl.localhost\", r"\\wsl$\", r"\\?\unc\wsl.localhost\", r"\\?\unc\wsl$\", "//wsl.localhost/", "//wsl$/"]
        .iter()
        .find(|prefix| lower.starts_with(*prefix))
        .map(|prefix| &path[prefix.len()..])?;
    let rest = rest.replace('/', "\\");
    let (distro, tail) = rest.split_once('\\').unwrap_or((&rest, ""));
    (!distro.is_empty()).then(|| (distro.to_string(), format!("/{}", tail.replace('\\', "/"))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_between_linux_and_host_paths() {
        let host = host_path("Debian", "/home/me/work");
        assert_eq!(host, r"\\wsl.localhost\Debian\home\me\work");
        assert_eq!(parse_host_path(&host), Some(("Debian".into(), "/home/me/work".into())));
        assert_eq!(parse_host_path(r"\\wsl$\Ubuntu"), Some(("Ubuntu".into(), "/".into())));
        assert_eq!(parse_host_path("//wsl.localhost/Debian/tmp/x"), Some(("Debian".into(), "/tmp/x".into())));
        assert_eq!(parse_host_path(r"\\?\UNC\wsl.localhost\Debian\etc"), Some(("Debian".into(), "/etc".into())));
        assert_eq!(parse_host_path(r"\\wsl.localhost\"), None);
        assert_eq!(parse_host_path(r"C:\Users"), None);
        assert_eq!(host_of("Debian", "src/a.rs"), "src/a.rs");
    }
}
