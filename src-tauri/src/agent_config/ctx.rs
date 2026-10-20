use std::path::{Path, PathBuf};

use crate::{sessions::claude_home, wsl};

pub struct Ctx {
    pub distro: Option<String>,
    pub home: PathBuf,
    pub claude_home: PathBuf,
}

pub struct Project {
    pub ctx: Ctx,
    pub cwd: PathBuf,
    pub dirs: Vec<PathBuf>,
}

impl Project {
    pub fn load(cwd: &str) -> anyhow::Result<Self> {
        let cwd = PathBuf::from(wsl::normalize_path(cwd));
        let ctx = Ctx::for_cwd(&cwd)?;
        Ok(Self { dirs: project_dirs(&ctx, &cwd), ctx, cwd })
    }

    pub fn native_cwd(&self) -> String {
        self.ctx.native(&self.cwd)
    }
}

impl Ctx {
    pub fn for_cwd(cwd: &Path) -> anyhow::Result<Self> {
        let Some((distro, linux)) = wsl::parse_host_path(&cwd.to_string_lossy()) else {
            return Ok(Self { distro: None, home: dirs::home_dir().unwrap_or_default(), claude_home: claude_home() });
        };
        anyhow::ensure!(wsl::is_running(&distro), "WSL {distro} is stopped");
        let home = PathBuf::from(wsl::host_path(&distro, &wsl::home_for(&distro, &linux)?));
        let claude_home = wsl::login_var(&distro, "CLAUDE_CONFIG_DIR")
            .filter(|dir| dir.starts_with('/'))
            .map(|dir| PathBuf::from(wsl::host_path(&distro, &dir)))
            .unwrap_or_else(|| home.join(".claude"));
        Ok(Self { claude_home, home, distro: Some(distro) })
    }

    pub fn host(&self, path: &str) -> PathBuf {
        match &self.distro {
            Some(distro) if path.starts_with('/') => PathBuf::from(wsl::host_path(distro, path)),
            _ => PathBuf::from(path),
        }
    }

    pub fn native(&self, path: &Path) -> String {
        let text = path.to_string_lossy().to_string();
        if self.distro.is_none() {
            return text;
        }
        wsl::parse_host_path(&text).map(|(_, linux)| linux).unwrap_or(text)
    }

    pub fn codex_home(&self) -> PathBuf {
        let custom = wsl::env_var(self.distro.as_deref(), "CODEX_HOME").filter(|dir| self.distro.is_none() || dir.starts_with('/'));
        custom.map(|dir| self.host(&dir)).unwrap_or_else(|| self.home.join(".codex"))
    }
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}

pub fn project_dirs(ctx: &Ctx, cwd: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut current = Some(cwd);
    while let Some(dir) = current {
        if same_path(dir, &ctx.home) {
            break;
        }
        dirs.push(dir.to_path_buf());
        current = dir.parent();
    }
    dirs
}

pub fn project_key(path: &str) -> String {
    path.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_key_matches_claude_code() {
        assert_eq!(project_key(r"C:\Users\me\my-files"), "C--Users-me-my-files");
        assert_eq!(project_key("/home/me/work/app"), "-home-me-work-app");
    }

    #[test]
    fn normalizes_wsl_dollar_paths() {
        assert_eq!(wsl::normalize_path(r"\\wsl$\Debian\home\me\work"), r"\\wsl.localhost\Debian\home\me\work");
        assert_eq!(wsl::normalize_path(r"C:\work"), r"C:\work");
    }

    #[test]
    fn stops_walking_at_home() {
        let ctx = Ctx { distro: None, home: PathBuf::from(r"C:\Users\me"), claude_home: PathBuf::new() };
        let dirs = project_dirs(&ctx, Path::new(r"C:\Users\me\my-files\dev"));
        assert_eq!(dirs, [PathBuf::from(r"C:\Users\me\my-files\dev"), PathBuf::from(r"C:\Users\me\my-files")]);
    }
}
