use std::io::{BufRead, BufReader, Read};

use anyhow::{anyhow, bail, Context};
use parking_lot::Mutex;
use serde_json::Value;

use super::{is_valid_reply, CALL_TIMEOUT, PROTOCOL_VERSION};
use crate::{
    agent_config::{url_host, Launch},
    util::http_agent,
};

const MAX_BODY_BYTES: u64 = 32 * 1024 * 1024;
const ERROR_BODY_BYTES: u64 = 4096;
const ERROR_BODY_CHARS: usize = 300;

pub(super) struct HttpTransport {
    url: String,
    headers: Vec<(String, String)>,
    agent: ureq::Agent,
    session: Mutex<Option<String>>,
}

pub(super) fn http_transport(launch: &Launch) -> anyhow::Result<HttpTransport> {
    let url = launch.url.clone().filter(|u| !u.is_empty()).context("server has no url")?;
    Ok(HttpTransport { url, headers: launch.headers.clone(), agent: http_agent(CALL_TIMEOUT), session: Mutex::new(None) })
}

fn sse_message(reader: impl BufRead, id: u64) -> anyhow::Result<Option<Value>> {
    let mut data = String::new();
    for line in reader.lines() {
        let line = line?;
        if let Some(chunk) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(chunk.strip_prefix(' ').unwrap_or(chunk));
            continue;
        }
        if line.is_empty() && !data.is_empty() {
            let event = std::mem::take(&mut data);
            if let Ok(value) = serde_json::from_str::<Value>(&event) {
                if value.get("id").and_then(Value::as_u64) == Some(id) && is_valid_reply(&value) {
                    return Ok(Some(value));
                }
            }
        }
    }
    if let Ok(value) = serde_json::from_str::<Value>(&data) {
        if value.get("id").and_then(Value::as_u64) == Some(id) {
            return Ok(Some(value));
        }
    }
    Ok(None)
}

pub(super) enum HttpReply {
    Message(Option<Value>),
    SessionExpired,
}

impl HttpTransport {
    pub(super) fn post(&self, message: &Value, id: Option<u64>) -> anyhow::Result<HttpReply> {
        let host = url_host(&self.url);
        let mut request = self
            .agent
            .post(&self.url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", PROTOCOL_VERSION);
        for (name, value) in &self.headers {
            request = request.header(name, value);
        }
        let session = self.session.lock().clone();
        if let Some(session) = &session {
            request = request.header("Mcp-Session-Id", session);
        }
        let mut response = request.send(message.to_string()).map_err(|e| anyhow!("Couldn't reach {host}: {}", describe_http_error(&e)))?;
        let status = response.status().as_u16();
        if let Some(value) = response.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
            *self.session.lock() = Some(value.to_string());
        }
        if status == 404 && session.is_some() {
            *self.session.lock() = None;
            return Ok(HttpReply::SessionExpired);
        }
        if status == 401 || status == 403 {
            bail!("This server needs you to sign in. Connect it once from Claude Code (/mcp), because Deck can't reuse that login.");
        }
        let content_type = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or_default().to_lowercase();
        let body = response.body_mut().as_reader().take(MAX_BODY_BYTES);
        if !(200..300).contains(&status) {
            let mut text = String::new();
            let _ = BufReader::new(body).take(ERROR_BODY_BYTES).read_to_string(&mut text);
            bail!("HTTP {status} from {host}: {}", text.chars().take(ERROR_BODY_CHARS).collect::<String>());
        }
        let Some(id) = id else { return Ok(HttpReply::Message(None)) };
        reply_from(body, &content_type, id)
    }
}

fn reply_from(body: impl Read, content_type: &str, id: u64) -> anyhow::Result<HttpReply> {
    if content_type.contains("text/event-stream") {
        return match sse_message(BufReader::new(body), id)? {
            Some(value) => Ok(HttpReply::Message(Some(value))),
            None => bail!("The server's event stream ended without a response"),
        };
    }
    let mut text = String::new();
    BufReader::new(body).read_to_string(&mut text)?;
    if text.trim().is_empty() {
        return Ok(HttpReply::Message(None));
    }
    Ok(HttpReply::Message(Some(serde_json::from_str(&text).context("The server returned invalid JSON")?)))
}

fn describe_http_error(error: &ureq::Error) -> String {
    match error {
        ureq::Error::BadUri(_) => "the address isn't valid".into(),
        ureq::Error::Timeout(_) => "the connection timed out".into(),
        ureq::Error::HostNotFound => "the host wasn't found".into(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_matching_sse_event_without_waiting_for_the_stream_to_end() {
        let stream = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"log\"}\n\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\n data:\"result\":{\"ok\":true}}\n\n";
        let stream = stream.replace("\n data:", "\ndata:");
        let reader = std::io::Cursor::new(format!("{stream}data: never-ending"));
        let value = sse_message(BufReader::new(reader), 7).unwrap().unwrap();
        assert_eq!(value["result"]["ok"], true);
    }
}
