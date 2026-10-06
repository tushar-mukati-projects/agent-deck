mod claude;
mod codex;
mod ctx;
mod files;
mod redact;
mod remove;
mod servers;

use serde::{Deserialize, Serialize};

pub use files::create_memory_file;
pub use redact::url_host;
pub use remove::{remove, Removal};
pub use servers::{launch, Launch, McpServer, ResolvedServer, Transport};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    #[default]
    User,
    Project,
    Local,
    Plugin,
    Auto,
    System,
}

impl Scope {
    fn as_str(self) -> &'static str {
        match self {
            Scope::User => "user",
            Scope::Project => "project",
            Scope::Local => "local",
            Scope::Plugin => "plugin",
            Scope::Auto => "auto",
            Scope::System => "system",
        }
    }

    fn removable(self) -> bool {
        !matches!(self, Scope::Plugin | Scope::System)
    }
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub scope: Scope,
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub description: Option<String>,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub name: String,
    pub description: Option<String>,
    pub path: String,
    pub scope: Scope,
    pub plugin: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hook {
    pub event: String,
    pub matcher: Option<String>,
    pub command: String,
    pub scope: Scope,
    pub plugin: Option<String>,
    pub source: String,
    pub group: usize,
    pub index: usize,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    pub scope: Scope,
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub error: Option<String>,
    pub model: Option<String>,
    pub default_mode: Option<String>,
    pub allow: Vec<String>,
    pub deny: Vec<String>,
    pub ask: Vec<String>,
    pub env_keys: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub name: String,
    pub version: Option<String>,
    pub scope: String,
    pub enabled: bool,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub home: String,
    pub distro: Option<String>,
    pub memory: Vec<MemoryFile>,
    pub mcp: Vec<McpServer>,
    pub skills: Vec<Item>,
    pub agents: Vec<Item>,
    pub commands: Vec<Item>,
    pub hooks: Vec<Hook>,
    pub settings: Vec<SettingsFile>,
    pub plugins: Vec<Plugin>,
}

pub fn overview(cwd: &str, agent: Agent) -> anyhow::Result<Overview> {
    match agent {
        Agent::Claude => claude::overview(cwd),
        Agent::Codex => codex::overview(cwd),
    }
}

pub fn resolve_server(cwd: &str, id: &str) -> anyhow::Result<ResolvedServer> {
    if id.starts_with(codex::SERVER_PREFIX) {
        codex::resolve_server(cwd, id)
    } else {
        claude::resolve_server(cwd, id)
    }
}
