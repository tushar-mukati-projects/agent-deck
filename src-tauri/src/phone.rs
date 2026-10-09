use std::time::Duration;

use anyhow::{bail, Context};
use serde_json::json;

const SERVER: &str = "https://ntfy.sh";
const TIMEOUT: Duration = Duration::from_secs(10);

pub fn valid_topic(topic: &str) -> bool {
    (8..=64).contains(&topic.len()) && topic.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn ping(topic: &str, title: &str, message: &str, urgent: bool) -> anyhow::Result<()> {
    anyhow::ensure!(valid_topic(topic), "Use 8 to 64 letters, digits, dashes or underscores for the topic.");
    let tls = ureq::tls::TlsConfig::builder().root_certs(ureq::tls::RootCerts::PlatformVerifier).build();
    let agent: ureq::Agent =
        ureq::Agent::config_builder().timeout_global(Some(TIMEOUT)).http_status_as_error(false).tls_config(tls).build().into();
    let body = json!({
        "topic": topic,
        "title": title,
        "message": message,
        "tags": [if urgent { "warning" } else { "white_check_mark" }],
        "priority": if urgent { 4 } else { 3 },
    });
    let response =
        agent.post(SERVER).header("Content-Type", "application/json").send(body.to_string()).context("Couldn't reach ntfy.sh")?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        bail!("ntfy.sh answered with status {status}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_hard_to_guess_url_safe_topics() {
        assert!(valid_topic("deck-k3f9x2m7q1"));
        assert!(!valid_topic("short"));
        assert!(!valid_topic("has space in it"));
        assert!(!valid_topic("../escape-attempt"));
        assert!(!valid_topic(&"x".repeat(65)));
    }
}
