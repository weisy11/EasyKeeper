//! One streaming call for each supported provider format.
//! The API key is a header only. It is never written into the JSON body.

use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Notify;

#[derive(Clone)]
pub struct Stop {
    flag: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl Stop {
    pub fn new() -> Self {
        Self { flag: Arc::new(AtomicBool::new(false)), notify: Arc::new(Notify::new()) }
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::Relaxed);
        self.notify.notify_one();
    }

    fn cancelled(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }
}

const MAX_OUTPUT_TOKENS: u64 = 2048;

#[derive(Clone)]
pub struct Turn {
    pub role: String,
    pub text: String,
}

pub struct Prepared {
    pub url: String,
    pub bearer: bool,
    pub api_key_header: Option<&'static str>,
    pub extra_headers: Vec<(&'static str, &'static str)>,
    pub body: Value,
}

pub fn prepare(format: &str, address: &str, model: &str, turns: &[Turn]) -> Result<Prepared, String> {
    let address = address.trim().trim_end_matches('/');
    if address.is_empty() {
        return Err("no-address".into());
    }
    if model.trim().is_empty() {
        return Err("no-model".into());
    }
    if turns.is_empty() {
        return Err("empty-reply".into());
    }
    let model = model.trim();
    match format {
        "chat" => Ok(Prepared {
            url: format!("{address}/chat/completions"),
            bearer: true,
            api_key_header: None,
            extra_headers: Vec::new(),
            body: json!({
                "model": model,
                "messages": message_list(turns),
                "max_tokens": MAX_OUTPUT_TOKENS,
                "stream": true,
            }),
        }),
        "responses" => Ok(Prepared {
            url: format!("{address}/responses"),
            bearer: true,
            api_key_header: None,
            extra_headers: Vec::new(),
            body: json!({
                "model": model,
                "input": responses_input(turns),
                "max_output_tokens": MAX_OUTPUT_TOKENS,
                "stream": true,
            }),
        }),
        "interactions" => Ok(Prepared {
            url: format!("{address}/interactions"),
            bearer: false,
            api_key_header: Some("x-goog-api-key"),
            extra_headers: Vec::new(),
            body: json!({
                "model": model,
                "input": interactions_input(turns),
                "generation_config": { "max_output_tokens": MAX_OUTPUT_TOKENS },
                "stream": true,
            }),
        }),
        "messages" => Ok(Prepared {
            url: format!("{address}/v1/messages"),
            bearer: true,
            api_key_header: Some("x-api-key"),
            extra_headers: vec![("anthropic-version", "2023-06-01")],
            body: json!({
                "model": model,
                "max_tokens": MAX_OUTPUT_TOKENS,
                "messages": message_list(turns),
                "stream": true,
            }),
        }),
        _ => Err("bad-format".into()),
    }
}

pub struct OutboundProxy {
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

fn http_client(timeout_secs: u64, proxy: Option<&OutboundProxy>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(timeout_secs));
    if let Some(proxy) = proxy {
        let scheme = if proxy.protocol == "socks5" { "socks5h" } else { "http" };
        let mut node = reqwest::Proxy::all(format!("{scheme}://{}:{}", proxy.host, proxy.port)).map_err(|_| "bad-proxy".to_string())?;
        if !proxy.username.is_empty() {
            node = node.basic_auth(&proxy.username, &proxy.password);
        }
        builder = builder.proxy(node);
    }
    builder.build().map_err(|_| "call-failed".to_string())
}

pub async fn complete(
    format: &str,
    address: &str,
    api_key: &str,
    model: &str,
    turns: &[Turn],
    proxy: Option<&OutboundProxy>,
    mut on_delta: impl FnMut(&str, &str),
    stop: Stop,
) -> Result<String, String> {
    let prepared = prepare(format, address, model, turns)?;
    if api_key.is_empty() {
        return Err("no-key".into());
    }
    if stop.cancelled() {
        return Ok(String::new());
    }
    let client = http_client(120, proxy)?;
    let mut request = client.post(&prepared.url).header("content-type", "application/json");
    if prepared.bearer {
        request = request.header("authorization", format!("Bearer {api_key}"));
    }
    if let Some(name) = prepared.api_key_header {
        request = request.header(name, api_key);
    }
    for (name, value) in prepared.extra_headers {
        request = request.header(name, value);
    }
    let response = request
        .json(&prepared.body)
        .send()
        .await
        .map_err(|_| "call-failed".to_string())?;
    let status = response.status();
    if !status.is_success() {
        let text = redact(&response.text().await.unwrap_or_default(), api_key);
        let _ = text;
        return Err(format!("http {}", status.as_u16()));
    }
    let mut response = response;
    let mut pending = SsePending::default();
    let mut splitter = ThinkSplitter::default();
    let mut collected = String::new();
    let mut raw = String::new();
    let mut buf = Vec::new();
    loop {
        if stop.cancelled() {
            return Ok(collected);
        }
        let chunk = tokio::select! {
            biased;
            _ = stop.notify.notified() => return Ok(collected),
            chunk = response.chunk() => chunk,
        };
        let chunk = chunk.map_err(|_| "call-failed".to_string())?;
        let Some(chunk) = chunk else { break };
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|byte| *byte == b'\n') {
            let mut line = buf.drain(..=pos).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8_lossy(&line);
            raw.push_str(&line);
            raw.push('\n');
            if let Some((event, data)) = pending.push(&line) {
                if data == "[DONE]" {
                    continue;
                }
                for piece in pieces_from(format, &event, &data) {
                    emit_piece(format, &piece, &mut splitter, &mut collected, &mut on_delta);
                }
            }
        }
    }
    for (kind, text) in splitter.finish() {
        if kind == "text" {
            collected.push_str(&text);
        }
        on_delta(kind, &text);
    }
    if collected.trim().is_empty() {
        let value: Value = serde_json::from_str(raw.trim()).map_err(|_| "bad-response".to_string())?;
        let text = reply_from(format, &value)?;
        let (thinking, answer) = split_think(&text);
        if !thinking.trim().is_empty() {
            on_delta("thinking", thinking.trim());
        }
        let answer = answer.trim().to_string();
        if !answer.is_empty() {
            on_delta("text", &answer);
        }
        return Ok(answer);
    }
    Ok(collected)
}

fn emit_piece(format: &str, piece: &Piece, splitter: &mut ThinkSplitter, collected: &mut String, on_delta: &mut impl FnMut(&str, &str)) {
    if piece.kind == "text" && format == "chat" {
        for (kind, text) in splitter.push(&piece.text) {
            if kind == "text" {
                collected.push_str(&text);
            }
            on_delta(kind, &text);
        }
        return;
    }
    if piece.kind == "text" {
        collected.push_str(&piece.text);
    }
    on_delta(piece.kind, &piece.text);
}

struct Piece {
    kind: &'static str,
    text: String,
}

#[derive(Default)]
struct ThinkSplitter {
    thinking: bool,
    hold: String,
    trim_answer: bool,
}

impl ThinkSplitter {
    fn push(&mut self, input: &str) -> Vec<(&'static str, String)> {
        self.hold.push_str(input);
        let mut out = Vec::new();
        loop {
            let marker = if self.thinking { "</think>" } else { "<think>" };
            if let Some(index) = self.hold.find(marker) {
                let text = self.hold[..index].to_string();
                if !text.is_empty() {
                    out.push((if self.thinking { "thinking" } else { "text" }, text));
                }
                self.hold.drain(..index + marker.len());
                let leaving_think = self.thinking;
                self.thinking = !self.thinking;
                if leaving_think {
                    self.trim_answer = true;
                }
                continue;
            }
            let keep = marker.len() - 1;
            let end = split_before_tail(&self.hold, keep);
            if end > 0 {
                let text = self.hold[..end].to_string();
                self.hold.drain(..end);
                self.push_piece(if self.thinking { "thinking" } else { "text" }, text, &mut out);
            }
            break;
        }
        out
    }

    fn push_piece(&mut self, kind: &'static str, text: String, out: &mut Vec<(&'static str, String)>) {
        if kind != "text" || !self.trim_answer {
            if !text.is_empty() {
                out.push((kind, text));
            }
            return;
        }
        let trimmed = text.trim_start();
        if trimmed.is_empty() {
            return;
        }
        self.trim_answer = false;
        out.push(("text", trimmed.to_string()));
    }

    fn finish(&mut self) -> Vec<(&'static str, String)> {
        if self.hold.is_empty() {
            return Vec::new();
        }
        let kind = if self.thinking { "thinking" } else { "text" };
        let text = std::mem::take(&mut self.hold);
        let mut out = Vec::new();
        self.push_piece(kind, text, &mut out);
        out
    }
}

fn split_before_tail(text: &str, keep_bytes: usize) -> usize {
    if text.len() <= keep_bytes {
        return 0;
    }
    let mut end = text.len() - keep_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    end
}

fn split_think(text: &str) -> (String, String) {
    let mut thinking = String::new();
    let mut answer = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("<think>") {
        answer.push_str(&rest[..start]);
        rest = &rest[start + "<think>".len()..];
        if let Some(end) = rest.find("</think>") {
            thinking.push_str(&rest[..end]);
            rest = &rest[end + "</think>".len()..];
        } else {
            thinking.push_str(rest);
            rest = "";
        }
    }
    answer.push_str(rest);
    if !thinking.is_empty() {
        answer = answer.trim_start().to_string();
    }
    (thinking, answer)
}

#[derive(Default)]
struct SsePending {
    event: String,
    data: String,
}

impl SsePending {
    fn push(&mut self, line: &str) -> Option<(String, String)> {
        if line.is_empty() {
            if self.data.is_empty() {
                self.event.clear();
                return None;
            }
            let event = std::mem::take(&mut self.event);
            let data = std::mem::take(&mut self.data);
            return Some((event, data));
        }
        if let Some(rest) = line.strip_prefix("data:") {
            if !self.data.is_empty() {
                self.data.push('\n');
            }
            self.data.push_str(rest.trim_start());
        } else if let Some(rest) = line.strip_prefix("event:") {
            self.event = rest.trim().to_string();
        }
        None
    }
}

pub fn delta_from(format: &str, event: &str, data: &str) -> Option<String> {
    pieces_from(format, event, data).into_iter().find(|piece| piece.kind == "text").map(|piece| piece.text)
}

fn pieces_from(format: &str, event: &str, data: &str) -> Vec<Piece> {
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return Vec::new();
    };
    let mut pieces = Vec::new();
    match format {
        "chat" => {
            if let Some(text) = non_empty(value["choices"][0]["delta"]["reasoning_content"].as_str()) {
                pieces.push(Piece { kind: "thinking", text });
            }
            if let Some(text) = non_empty(value["choices"][0]["delta"]["content"].as_str()) {
                pieces.push(Piece { kind: "text", text });
            }
        }
        "responses" => {
            let kind_name = value["type"].as_str().unwrap_or(event);
            if kind_name.contains("reasoning") {
                if let Some(text) = non_empty(value["delta"].as_str().or_else(|| value["delta"]["text"].as_str())) {
                    pieces.push(Piece { kind: "thinking", text });
                }
            } else if event == "response.output_text.delta" || kind_name == "response.output_text.delta" {
                if let Some(text) = non_empty(value["delta"].as_str()) {
                    pieces.push(Piece { kind: "text", text });
                }
            }
        }
        "interactions" => {
            if value["delta"]["type"] == "thought_summary" {
                if let Some(text) = non_empty(value["delta"]["content"]["text"].as_str()) {
                    pieces.push(Piece { kind: "thinking", text });
                }
            } else if event == "step.delta" || event == "content.delta" || value["event_type"] == "step.delta" || value["delta"]["type"] == "text" {
                if let Some(text) = non_empty(value["delta"]["text"].as_str()) {
                    pieces.push(Piece { kind: "text", text });
                }
            }
        }
        "messages" => {
            if value["delta"]["type"] == "thinking_delta" {
                if let Some(text) = non_empty(value["delta"]["thinking"].as_str()) {
                    pieces.push(Piece { kind: "thinking", text });
                }
            } else if value["delta"]["type"] == "text_delta" {
                if let Some(text) = non_empty(value["delta"]["text"].as_str()) {
                    pieces.push(Piece { kind: "text", text });
                }
            }
        }
        _ => {}
    }
    pieces
}

fn non_empty(text: Option<&str>) -> Option<String> {
    text.filter(|value| !value.is_empty()).map(str::to_string)
}

pub fn reply_from(format: &str, value: &Value) -> Result<String, String> {
    let text = match format {
        "chat" => chat_text(value),
        "responses" => responses_text(value),
        "interactions" => interactions_text(value),
        "messages" => messages_text(value),
        _ => None,
    };
    let text = text.unwrap_or_default();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("empty-reply".into());
    }
    Ok(trimmed.to_string())
}

fn message_list(turns: &[Turn]) -> Vec<Value> {
    turns
        .iter()
        .filter(|turn| turn.role == "user" || turn.role == "assistant" || turn.role == "system")
        .map(|turn| json!({ "role": turn.role, "content": turn.text }))
        .collect()
}

fn responses_input(turns: &[Turn]) -> Value {
    if turns.len() == 1 && turns[0].role == "user" {
        return Value::String(turns[0].text.clone());
    }
    Value::Array(message_list(turns))
}

fn interactions_input(turns: &[Turn]) -> String {
    if turns.len() == 1 && turns[0].role == "user" {
        return turns[0].text.clone();
    }
    turns
        .iter()
        .map(|turn| format!("{}: {}", turn.role, turn.text))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn chat_text(value: &Value) -> Option<String> {
    let content = &value["choices"][0]["message"]["content"];
    text_value(content)
}

fn responses_text(value: &Value) -> Option<String> {
    if let Some(text) = value["output_text"].as_str() {
        if !text.trim().is_empty() {
            return Some(text.to_string());
        }
    }
    let mut parts = Vec::new();
    for item in value["output"].as_array()? {
        if item["type"] == "message" {
            if let Some(text) = text_value(&item["content"]) {
                parts.push(text);
            }
        }
    }
    if parts.is_empty() { None } else { Some(parts.join("\n")) }
}

fn interactions_text(value: &Value) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(steps) = value["steps"].as_array() {
        for step in steps {
            if step["type"] == "model_output" {
                if let Some(text) = text_value(&step["content"]) {
                    parts.push(text);
                }
            }
        }
    }
    if parts.is_empty() {
        if let Some(outputs) = value["outputs"].as_array() {
            for output in outputs {
                if let Some(text) = text_value(output) {
                    parts.push(text);
                }
            }
        }
    }
    if parts.is_empty() { None } else { Some(parts.join("\n")) }
}

fn messages_text(value: &Value) -> Option<String> {
    let mut parts = Vec::new();
    for block in value["content"].as_array()? {
        if block["type"] == "text" {
            if let Some(text) = block["text"].as_str() {
                parts.push(text.to_string());
            }
        }
    }
    if parts.is_empty() { None } else { Some(parts.join("\n")) }
}

fn text_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    let mut parts = Vec::new();
    for item in value.as_array()? {
        if let Some(text) = item.as_str() {
            parts.push(text.to_string());
        } else if let Some(text) = item["text"].as_str() {
            parts.push(text.to_string());
        }
    }
    if parts.is_empty() { None } else { Some(parts.join("\n")) }
}

fn redact(body: &str, api_key: &str) -> String {
    if api_key.is_empty() {
        return body.to_string();
    }
    body.replace(api_key, "[redacted]")
}

pub fn model_list_url(format: &str, address: &str, vendor: &str) -> Result<String, String> {
    let address = address.trim().trim_end_matches('/');
    if address.is_empty() {
        return Err("no-address".into());
    }
    if vendor == "deepseek" && format == "messages" {
        return Ok("https://api.deepseek.com/models".into());
    }
    match format {
        "chat" | "responses" | "interactions" => Ok(format!("{address}/models")),
        "messages" => Ok(format!("{address}/v1/models")),
        _ => Err("bad-format".into()),
    }
}

pub fn bare_model_id<'a>(vendor: &str, model: &'a str) -> &'a str {
    if vendor == "gemini" {
        model.strip_prefix("models/").unwrap_or(model)
    } else {
        model
    }
}

pub fn model_ids(format: &str, value: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    let items = if format == "interactions" {
        interaction_ids(value)
    } else {
        data_ids(value)
    };
    for id in items {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

fn data_ids(value: &Value) -> Vec<String> {
    value["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["id"].as_str().map(str::to_string))
        .filter(|id| !id.is_empty())
        .collect()
}

fn interaction_ids(value: &Value) -> Vec<String> {
    value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let methods = item["supportedGenerationMethods"].as_array().or_else(|| item["supportedActions"].as_array());
            let generates = methods.is_some_and(|list| list.iter().any(|method| method.as_str() == Some("generateContent")));
            if !generates {
                return None;
            }
            let name = item["name"].as_str()?;
            let id = name.strip_prefix("models/").unwrap_or(name);
            if id.is_empty() { None } else { Some(id.to_string()) }
        })
        .collect()
}

pub async fn list_models(format: &str, address: &str, vendor: &str, api_key: &str, proxy: Option<&OutboundProxy>) -> Result<Vec<String>, String> {
    if api_key.is_empty() {
        return Err("no-key".into());
    }
    let url = model_list_url(format, address, vendor)?;
    let client = http_client(30, proxy).map_err(|_| "list-failed".to_string())?;
    let mut request = client.get(&url);
    if format == "interactions" {
        request = request.header("x-goog-api-key", api_key);
    } else {
        request = request.header("authorization", format!("Bearer {api_key}"));
        if format == "messages" && vendor != "deepseek" {
            request = request.header("x-api-key", api_key);
        }
    }
    let response = request.send().await.map_err(|_| "list-failed".to_string())?;
    let status = response.status();
    let text = redact(&response.text().await.map_err(|_| "list-failed".to_string())?, api_key);
    if !status.is_success() {
        return Err(format!("http {}", status.as_u16()));
    }
    let value: Value = serde_json::from_str(&text).map_err(|_| "bad-response".to_string())?;
    let parse_as = if vendor == "deepseek" && format == "messages" { "chat" } else { format };
    let mut ids = Vec::new();
    for id in model_ids(parse_as, &value) {
        let id = bare_model_id(vendor, &id).to_string();
        if !id.is_empty() && !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(text: &str) -> Turn {
        Turn { role: "user".into(), text: text.into() }
    }

    #[test]
    fn each_format_uses_its_own_path_and_keeps_the_key_out_of_the_body() {
        let key = "sk-test-secret";
        let turns = [user("pong")];
        let cases = [
            ("chat", "https://api.minimax.cn/v1", "/chat/completions"),
            ("responses", "https://api.minimax.cn/v1", "/responses"),
            ("interactions", "https://generativelanguage.googleapis.com/v1beta", "/interactions"),
            ("messages", "https://api.minimax.cn/anthropic", "/v1/messages"),
        ];
        for (format, address, suffix) in cases {
            let prepared = prepare(format, address, "MiniMax-M3", &turns).unwrap();
            assert!(prepared.url.ends_with(suffix), "{}", prepared.url);
            assert!(!prepared.body.to_string().contains(key));
        }
    }

    #[test]
    fn replies_come_from_the_text_field_of_each_format() {
        let chat = json!({"choices":[{"message":{"content":"pong"}}]});
        let responses = json!({"output_text":"pong","output":[]});
        let interactions = json!({"steps":[{"type":"model_output","content":[{"type":"text","text":"pong"}]}]});
        let messages = json!({"content":[{"type":"thinking","thinking":"secret"},{"type":"text","text":"pong"}]});
        assert_eq!(reply_from("chat", &chat).unwrap(), "pong");
        assert_eq!(reply_from("responses", &responses).unwrap(), "pong");
        assert_eq!(reply_from("interactions", &interactions).unwrap(), "pong");
        assert_eq!(reply_from("messages", &messages).unwrap(), "pong");
    }

    #[test]
    fn cancel_marks_the_call_stopped() {
        let stop = Stop::new();
        assert!(!stop.cancelled());
        stop.cancel();
        assert!(stop.cancelled());
    }

    #[test]
    fn model_lists_follow_the_format_except_deepseek_messages() {
        assert_eq!(model_list_url("chat", "https://api.minimax.cn/v1", "minimax-cn").unwrap(), "https://api.minimax.cn/v1/models");
        assert_eq!(model_list_url("messages", "https://api.minimax.cn/anthropic", "minimax-cn").unwrap(), "https://api.minimax.cn/anthropic/v1/models");
        assert_eq!(model_list_url("messages", "https://api.deepseek.com/anthropic", "deepseek").unwrap(), "https://api.deepseek.com/models");
        assert_eq!(model_list_url("interactions", "https://generativelanguage.googleapis.com/v1beta", "gemini").unwrap(), "https://generativelanguage.googleapis.com/v1beta/models");
        let chat = json!({"data":[{"id":"MiniMax-M3"},{"id":"MiniMax-M3"}]});
        assert_eq!(model_ids("chat", &chat), vec!["MiniMax-M3"]);
        let gemini = json!({"models":[
            {"name":"models/gemini-3.8-flash","supportedGenerationMethods":["generateContent"]},
            {"name":"models/embedding","supportedGenerationMethods":["embedContent"]}
        ]});
        assert_eq!(model_ids("interactions", &gemini), vec!["gemini-3.8-flash"]);
        assert_eq!(bare_model_id("gemini", "models/gemini-4-argon"), "gemini-4-argon");
        assert_eq!(bare_model_id("minimax-cn", "models/MiniMax-M3"), "models/MiniMax-M3");
    }

    #[test]
    fn think_tags_leave_the_answer() {
        let mut splitter = ThinkSplitter::default();
        let mut thinking = String::new();
        let mut answer = String::new();
        for (kind, text) in splitter.push("<think>plan</think>pong") {
            if kind == "thinking" {
                thinking.push_str(&text);
            } else {
                answer.push_str(&text);
            }
        }
        for (kind, text) in splitter.finish() {
            if kind == "thinking" {
                thinking.push_str(&text);
            } else {
                answer.push_str(&text);
            }
        }
        assert_eq!(thinking, "plan");
        assert_eq!(answer, "pong");
        let mut spaced = ThinkSplitter::default();
        let mut answer = String::new();
        for (kind, text) in spaced.push("<think>plan</think>\n\npong") {
            if kind == "text" {
                answer.push_str(&text);
            }
        }
        for (kind, text) in spaced.finish() {
            if kind == "text" {
                answer.push_str(&text);
            }
        }
        assert_eq!(answer, "pong");
    }

    #[test]
    fn think_splitter_does_not_cut_inside_a_chinese_character() {
        let mut splitter = ThinkSplitter::default();
        splitter.thinking = true;
        let mut thinking = String::new();
        for (kind, text) in splitter.push("我来看") {
            assert_eq!(kind, "thinking");
            thinking.push_str(&text);
        }
        for (kind, text) in splitter.finish() {
            assert_eq!(kind, "thinking");
            thinking.push_str(&text);
        }
        assert_eq!(thinking, "我来看");
    }

    #[test]
    fn stream_deltas_keep_only_visible_text() {
        assert_eq!(delta_from("chat", "", r#"{"choices":[{"delta":{"content":"po"}}]}"#).as_deref(), Some("po"));
        assert_eq!(delta_from("chat", "", r#"{"choices":[{"delta":{"reasoning_content":"think"}}]}"#), None);
        assert_eq!(delta_from("responses", "response.output_text.delta", r#"{"type":"response.output_text.delta","delta":"ng"}"#).as_deref(), Some("ng"));
        assert_eq!(delta_from("messages", "content_block_delta", r#"{"delta":{"type":"thinking_delta","thinking":"x"}}"#), None);
        assert_eq!(delta_from("messages", "content_block_delta", r#"{"delta":{"type":"text_delta","text":"pong"}}"#).as_deref(), Some("pong"));
        assert_eq!(delta_from("interactions", "step.delta", r#"{"delta":{"type":"text","text":"pong"}}"#).as_deref(), Some("pong"));
    }
}
