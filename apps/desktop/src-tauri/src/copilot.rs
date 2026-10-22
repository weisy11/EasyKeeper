//! Local KP Copilot config. Providers and proxies live in `app.sqlite` (see `app_db`); each API
//! key is sealed with a wrapping key derived from a per-install uuid stored beside them.
//! Keys are decrypted once into memory. An older `copilot.json` is imported on first load.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

/// Pre-SQLite config file, imported once and then renamed.
const LEGACY_FILE_NAME: &str = "copilot.json";
const META_UUID: &str = "uuid";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub name: String,
    pub vendor: String,
    pub format: String,
    pub address: String,
    pub has_key: bool,
    pub models: Vec<String>,
    #[serde(default)]
    pub proxy_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInput {
    pub previous_name: Option<String>,
    pub name: String,
    pub vendor: String,
    pub format: String,
    pub address: String,
    pub api_key: Option<String>,
    pub models: Vec<String>,
    #[serde(default)]
    pub proxy_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredProvider {
    name: String,
    vendor: String,
    format: String,
    address: String,
    nonce: String,
    secret: String,
    models: Vec<String>,
    #[serde(default)]
    proxy_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredProxy {
    id: String,
    name: String,
    protocol: String,
    host: String,
    port: u16,
    #[serde(default)]
    auth_nonce: String,
    #[serde(default)]
    auth_secret: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyView {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub has_auth: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyInput {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct FileBody {
    uuid: String,
    providers: Vec<StoredProvider>,
    #[serde(default)]
    proxies: Vec<StoredProxy>,
}

struct Memory {
    key: [u8; 32],
    providers: Vec<LiveProvider>,
    proxies: Vec<LiveProxy>,
}

struct LiveProvider {
    name: String,
    vendor: String,
    format: String,
    address: String,
    api_key: String,
    models: Vec<String>,
    proxy_id: String,
}

struct LiveProxy {
    id: String,
    name: String,
    protocol: String,
    host: String,
    port: u16,
    username: String,
    password: String,
}

static MEMORY: Mutex<Option<Memory>> = Mutex::new(None);
static STOPS: LazyLock<Mutex<HashMap<String, crate::copilot_http::Stop>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static STOP_EARLY: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn wrapping_key(id: &Uuid) -> [u8; 32] {
    Sha256::digest(id.as_bytes()).into()
}

fn seal(key: &[u8; 32], plain: &str) -> Result<(String, String), String> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let secret = cipher
        .encrypt(Nonce::from_slice(&nonce), plain.as_bytes())
        .map_err(|_| "encrypt failed".to_string())?;
    Ok((
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, nonce),
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, secret),
    ))
}

fn open(key: &[u8; 32], nonce: &str, secret: &str) -> Result<String, String> {
    let nonce = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, nonce)
        .map_err(|_| "bad nonce".to_string())?;
    let secret = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, secret)
        .map_err(|_| "bad secret".to_string())?;
    if nonce.len() != 12 {
        return Err("bad nonce".into());
    }
    let cipher = Aes256Gcm::new(key.into());
    let plain = cipher
        .decrypt(Nonce::from_slice(&nonce), secret.as_ref())
        .map_err(|_| "decrypt failed".to_string())?;
    String::from_utf8(plain).map_err(|_| "decrypt failed".to_string())
}

fn read_body(conn: &Connection) -> Result<Option<FileBody>, String> {
    let uuid: Option<String> = conn
        .query_row("SELECT value FROM copilot_meta WHERE key = ?1", params![META_UUID], |row| row.get(0))
        .optional()
        .map_err(|err| err.to_string())?;
    let Some(uuid) = uuid else { return Ok(None) };
    let mut providers = Vec::new();
    {
        let mut statement = conn
            .prepare("SELECT name, vendor, format, address, nonce, secret, models, proxy_id FROM copilot_provider ORDER BY position")
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map([], |row| {
                let models: String = row.get(6)?;
                Ok(StoredProvider {
                    name: row.get(0)?,
                    vendor: row.get(1)?,
                    format: row.get(2)?,
                    address: row.get(3)?,
                    nonce: row.get(4)?,
                    secret: row.get(5)?,
                    models: serde_json::from_str(&models).unwrap_or_default(),
                    proxy_id: row.get(7)?,
                })
            })
            .map_err(|err| err.to_string())?;
        for row in rows {
            providers.push(row.map_err(|err| err.to_string())?);
        }
    }
    let mut proxies = Vec::new();
    {
        let mut statement = conn
            .prepare("SELECT id, name, protocol, host, port, auth_nonce, auth_secret FROM copilot_proxy ORDER BY position")
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(StoredProxy {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    protocol: row.get(2)?,
                    host: row.get(3)?,
                    port: row.get(4)?,
                    auth_nonce: row.get(5)?,
                    auth_secret: row.get(6)?,
                })
            })
            .map_err(|err| err.to_string())?;
        for row in rows {
            proxies.push(row.map_err(|err| err.to_string())?);
        }
    }
    Ok(Some(FileBody { uuid, providers, proxies }))
}

/// Replace the stored providers and proxies in one transaction. Row order is the list order.
fn write_body(conn: &Connection, body: &FileBody) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "INSERT INTO copilot_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![META_UUID, body.uuid],
    )
    .map_err(|err| err.to_string())?;
    tx.execute("DELETE FROM copilot_provider", []).map_err(|err| err.to_string())?;
    for (position, provider) in body.providers.iter().enumerate() {
        let models = serde_json::to_string(&provider.models).map_err(|err| err.to_string())?;
        tx.execute(
            "INSERT INTO copilot_provider (name, position, vendor, format, address, nonce, secret, models, proxy_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                provider.name,
                position as i64,
                provider.vendor,
                provider.format,
                provider.address,
                provider.nonce,
                provider.secret,
                models,
                provider.proxy_id
            ],
        )
        .map_err(|err| err.to_string())?;
    }
    tx.execute("DELETE FROM copilot_proxy", []).map_err(|err| err.to_string())?;
    for (position, proxy) in body.proxies.iter().enumerate() {
        tx.execute(
            "INSERT INTO copilot_proxy (id, position, name, protocol, host, port, auth_nonce, auth_secret)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![proxy.id, position as i64, proxy.name, proxy.protocol, proxy.host, proxy.port, proxy.auth_nonce, proxy.auth_secret],
        )
        .map_err(|err| err.to_string())?;
    }
    tx.commit().map_err(|err| err.to_string())
}

/// Stored config, created on first use. A `copilot.json` from before the database is imported
/// as-is (same uuid, same sealed keys) and renamed so it is not read again.
fn load_or_create_body(app: &AppHandle) -> Result<FileBody, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    crate::app_db::with(app, |conn| ensure_body(conn, &dir))
}

/// Read the stored body; on a fresh install (or first run after `copilot.json`) create it.
fn ensure_body(conn: &Connection, config_dir: &Path) -> Result<FileBody, String> {
    if let Some(body) = read_body(conn)? {
        return Ok(body);
    }
    let legacy = config_dir.join(LEGACY_FILE_NAME);
    let body = match import_legacy(&legacy)? {
        Some(body) => body,
        None => FileBody { uuid: Uuid::new_v4().to_string(), providers: Vec::new(), proxies: Vec::new() },
    };
    write_body(conn, &body)?;
    if legacy.exists() {
        let _ = fs::rename(&legacy, config_dir.join(format!("{LEGACY_FILE_NAME}.migrated")));
    }
    Ok(body)
}

fn import_legacy(path: &Path) -> Result<Option<FileBody>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&text).map(Some).map_err(|err| err.to_string())
}

fn load_memory(app: &AppHandle) -> Result<(), String> {
    let mut guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    let file = load_or_create_body(app)?;
    let id = Uuid::parse_str(&file.uuid).map_err(|_| "bad config".to_string())?;
    let key = wrapping_key(&id);
    let mut providers = Vec::new();
    for stored in file.providers {
        let api_key = open(&key, &stored.nonce, &stored.secret)?;
        providers.push(LiveProvider {
            name: stored.name,
            vendor: stored.vendor,
            format: stored.format,
            address: stored.address,
            api_key,
            models: stored.models,
            proxy_id: stored.proxy_id,
        });
    }
    let mut proxies = Vec::new();
    for stored in file.proxies {
        let (username, password) = if stored.auth_nonce.is_empty() {
            (String::new(), String::new())
        } else {
            let plain = open(&key, &stored.auth_nonce, &stored.auth_secret)?;
            let value: serde_json::Value = serde_json::from_str(&plain).map_err(|_| "decrypt failed".to_string())?;
            (
                value["username"].as_str().unwrap_or("").to_string(),
                value["password"].as_str().unwrap_or("").to_string(),
            )
        };
        proxies.push(LiveProxy {
            id: stored.id,
            name: stored.name,
            protocol: stored.protocol,
            host: stored.host,
            port: stored.port,
            username,
            password,
        });
    }
    *guard = Some(Memory { key, providers, proxies });
    Ok(())
}

fn views(memory: &Memory) -> Vec<ProviderView> {
    memory
        .providers
        .iter()
        .map(|provider| ProviderView {
            name: provider.name.clone(),
            vendor: provider.vendor.clone(),
            format: provider.format.clone(),
            address: provider.address.clone(),
            has_key: !provider.api_key.is_empty(),
            models: {
                let mut ids = Vec::new();
                for model in &provider.models {
                    let id = crate::copilot_http::bare_model_id(&provider.vendor, model);
                    if !id.is_empty() && !ids.iter().any(|item: &String| item == id) {
                        ids.push(id.to_string());
                    }
                }
                ids
            },
            proxy_id: provider.proxy_id.clone(),
        })
        .collect()
}

fn persist(app: &AppHandle, memory: &Memory) -> Result<(), String> {
    let id = crate::app_db::with(app, |conn| {
        conn.query_row("SELECT value FROM copilot_meta WHERE key = ?1", params![META_UUID], |row| row.get::<_, String>(0))
            .optional()
            .map_err(|err| err.to_string())
    })?
    .ok_or_else(|| "config missing".to_string())?;
    let providers = memory
        .providers
        .iter()
        .map(|provider| {
            let (nonce, secret) = seal(&memory.key, &provider.api_key)?;
            Ok(StoredProvider {
                name: provider.name.clone(),
                vendor: provider.vendor.clone(),
                format: provider.format.clone(),
                address: provider.address.clone(),
                nonce,
                secret,
                models: provider.models.clone(),
                proxy_id: provider.proxy_id.clone(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let proxies = memory
        .proxies
        .iter()
        .map(|proxy| {
            let (auth_nonce, auth_secret) = if proxy.username.is_empty() && proxy.password.is_empty() {
                (String::new(), String::new())
            } else {
                let plain = serde_json::json!({ "username": proxy.username, "password": proxy.password }).to_string();
                seal(&memory.key, &plain)?
            };
            Ok(StoredProxy {
                id: proxy.id.clone(),
                name: proxy.name.clone(),
                protocol: proxy.protocol.clone(),
                host: proxy.host.clone(),
                port: proxy.port,
                auth_nonce,
                auth_secret,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let body = FileBody { uuid: id, providers, proxies };
    crate::app_db::with(app, |conn| write_body(conn, &body))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    pub request_id: String,
    /// The user turn (with its prompt) is already appended; the context is read from the chat.
    pub chat_id: String,
    pub service: String,
    pub model: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamDelta {
    request_id: String,
    kind: String,
    delta: String,
}

/// Emitted when a background compression finishes, so an open panel can show the divider.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SummaryEvent {
    chat_id: String,
    covers_to: i64,
    text: String,
}

/// Once the messages after the latest summary exceed this many estimated tokens, they are folded
/// into a new summary in the background. Counts only the history, not the scenario context that
/// rides along in the final prompt.
pub const COMPRESS_AFTER_TOKENS: u64 = 128_000;
/// Output budget for a summary; longer than a normal reply so details survive.
const SUMMARY_OUTPUT_TOKENS: u64 = 4096;

const SUMMARY_INSTRUCTIONS: &str = "You are compressing the history of a conversation between a tabletop game keeper and an assistant so it can continue with less context. Write a dense summary that keeps every fact the assistant would need later: decisions made, names, numbers, places, clues, rulings, open questions, and the user's stated preferences. Keep the language of the conversation. Output only the summary.";

static COMPRESSING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListModelsInput {
    pub service: Option<String>,
    pub api_key: Option<String>,
    pub vendor: String,
    pub format: String,
    pub address: String,
    #[serde(default)]
    pub proxy_id: String,
}

#[tauri::command]
pub async fn copilot_list_models(app: AppHandle, input: ListModelsInput) -> Result<Vec<String>, String> {
    load_memory(&app)?;
    let typed = input.api_key.unwrap_or_default();
    let api_key = if !typed.trim().is_empty() {
        typed
    } else {
        let service = input.service.unwrap_or_default();
        let guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
        let memory = guard.as_ref().ok_or("config missing")?;
        memory
            .providers
            .iter()
            .find(|provider| provider.name == service.trim())
            .map(|provider| provider.api_key.clone())
            .unwrap_or_default()
    };
    let proxy = outbound_proxy(&app, &input.proxy_id)?;
    crate::copilot_http::list_models(&input.format, &input.address, &input.vendor, &api_key, proxy.as_ref()).await
}

#[tauri::command]
pub fn copilot_stop(request_id: String) {
    let request_id = request_id.trim().to_string();
    if request_id.is_empty() {
        return;
    }
    let stops = match STOPS.lock() {
        Ok(stops) => stops,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(stop) = stops.get(&request_id) {
        stop.cancel();
        return;
    }
    if let Ok(mut early) = STOP_EARLY.lock() {
        early.insert(request_id);
    }
}

struct Endpoint {
    vendor: String,
    format: String,
    address: String,
    api_key: String,
    proxy_id: String,
}

fn endpoint(service: &str) -> Result<Endpoint, String> {
    let guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
    let memory = guard.as_ref().ok_or("config missing")?;
    let provider = memory.providers.iter().find(|provider| provider.name == service).ok_or("no-model")?;
    if provider.api_key.is_empty() {
        return Err("no-key".into());
    }
    Ok(Endpoint {
        vendor: provider.vendor.clone(),
        format: provider.format.clone(),
        address: provider.address.clone(),
        api_key: provider.api_key.clone(),
        proxy_id: provider.proxy_id.clone(),
    })
}

/// What the model gets for a chat: the latest summary folded into the first following user turn,
/// then every message after that summary. The newest user turn is sent as its full `prompt`.
fn context_turns(conn: &rusqlite::Connection, chat_id: &str) -> Result<Vec<crate::copilot_http::Turn>, String> {
    let summary = crate::copilot_chats::latest_summary(conn, chat_id)?;
    let after = summary.as_ref().map(|item| item.covers_to).unwrap_or(-1);
    let messages = crate::copilot_chats::messages_after(conn, chat_id, after)?;
    let last = messages.len().saturating_sub(1);
    let mut turns = Vec::with_capacity(messages.len());
    let mut pending_summary = summary.map(|item| item.text);
    for (index, stored) in messages.into_iter().enumerate() {
        let message = stored.message;
        let mut text = if index == last && message.role == "user" {
            message.prompt.unwrap_or(message.text)
        } else {
            message.text
        };
        if message.role == "user" {
            if let Some(summary) = pending_summary.take() {
                text = format!("[Summary of the earlier conversation]\n{summary}\n\n{text}");
            }
        }
        turns.push(crate::copilot_http::Turn { role: message.role, text });
    }
    if let Some(summary) = pending_summary {
        // Only assistant turns after the summary (should not happen); still hand the summary over.
        turns.insert(0, crate::copilot_http::Turn { role: "user".into(), text: format!("[Summary of the earlier conversation]\n{summary}") });
    }
    Ok(turns)
}

#[tauri::command]
pub async fn copilot_complete(app: AppHandle, request: CompleteRequest) -> Result<String, String> {
    load_memory(&app)?;
    let service = request.service.trim().to_string();
    let model = request.model.trim().to_string();
    if service.is_empty() || model.is_empty() {
        return Err("no-model".into());
    }
    let chat_id = request.chat_id.trim().to_string();
    let Endpoint { vendor, format, address, api_key, proxy_id } = endpoint(&service)?;
    let model = crate::copilot_http::bare_model_id(&vendor, &model).to_string();
    let proxy = outbound_proxy(&app, &proxy_id)?;
    let turns = {
        let app = app.clone();
        let chat_id = chat_id.clone();
        crate::blocking::run(move || crate::app_db::with(&app, |conn| context_turns(conn, &chat_id))).await?
    };
    let request_id = request.request_id.trim().to_string();
    if STOP_EARLY.lock().map(|mut early| early.remove(&request_id)).unwrap_or(false) {
        return Ok(String::new());
    }
    let stop = crate::copilot_http::Stop::new();
    if let Ok(mut stops) = STOPS.lock() {
        stops.insert(request_id.clone(), stop.clone());
    }
    if STOP_EARLY.lock().map(|mut early| early.remove(&request_id)).unwrap_or(false) {
        stop.cancel();
    }
    let result = crate::copilot_http::complete(
        &format,
        &address,
        &api_key,
        &model,
        &turns,
        crate::copilot_http::MAX_OUTPUT_TOKENS,
        proxy.as_ref(),
        |kind, delta| {
            let _ = app.emit(
                "copilot-stream",
                StreamDelta { request_id: request_id.clone(), kind: kind.to_string(), delta: delta.to_string() },
            );
        },
        stop,
    )
    .await;
    if let Ok(mut stops) = STOPS.lock() {
        stops.remove(&request_id);
    }
    result
}

/// Called after an assistant turn is stored. When the messages after the latest summary are over
/// the budget, fold them into a new summary in the background. One compression per chat at a time;
/// a failure is logged and the next assistant turn tries again.
pub fn maybe_compress(app: &AppHandle, chat_id: &str) {
    let chat_id = chat_id.to_string();
    let plan = crate::app_db::with(app, |conn| {
        let summary = crate::copilot_chats::latest_summary(conn, &chat_id)?;
        let after = summary.as_ref().map(|item| item.covers_to).unwrap_or(-1);
        let messages = crate::copilot_chats::messages_after(conn, &chat_id, after)?;
        let tokens: u64 = messages.iter().map(|item| crate::copilot_chats::estimate_tokens(&item.message.text)).sum();
        if tokens <= COMPRESS_AFTER_TOKENS {
            return Ok(None);
        }
        let (service, model): (String, String) = conn
            .query_row("SELECT service, model FROM copilot_chat WHERE id = ?1", rusqlite::params![chat_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|err| err.to_string())?;
        Ok(Some((summary.map(|item| item.text), messages, service, model)))
    });
    let Ok(Some((previous, messages, service, model))) = plan else { return };
    let Some(covers_to) = messages.last().map(|item| item.pos) else { return };
    if service.trim().is_empty() || model.trim().is_empty() {
        return;
    }
    {
        let Ok(mut busy) = COMPRESSING.lock() else { return };
        if !busy.insert(chat_id.clone()) {
            return;
        }
    }
    let turns = summary_turns(previous.as_deref(), &messages);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = compress(&app, &chat_id, &service, &model, &turns, covers_to).await;
        if let Ok(mut busy) = COMPRESSING.lock() {
            busy.remove(&chat_id);
        }
        if let Err(err) = outcome {
            eprintln!("[RUST] copilot: compressing chat {chat_id} failed: {err}");
        }
    });
}

/// The single user turn asking the model for a summary: the earlier summary, if any, followed by
/// every message after it. Merging both into one request is what keeps the chain of summaries short.
fn summary_turns(previous: Option<&str>, messages: &[crate::copilot_chats::StoredMessage]) -> Vec<crate::copilot_http::Turn> {
    let mut body = String::new();
    if let Some(previous) = previous {
        body.push_str("[Earlier summary]\n");
        body.push_str(previous);
        body.push_str("\n\n");
    }
    body.push_str("[Conversation to compress]\n");
    for item in messages {
        body.push_str(&item.message.role);
        body.push_str(": ");
        body.push_str(&item.message.text);
        body.push_str("\n\n");
    }
    vec![crate::copilot_http::Turn { role: "user".into(), text: format!("{SUMMARY_INSTRUCTIONS}\n\n{body}") }]
}

async fn compress(
    app: &AppHandle,
    chat_id: &str,
    service: &str,
    model: &str,
    turns: &[crate::copilot_http::Turn],
    covers_to: i64,
) -> Result<(), String> {
    load_memory(app)?;
    let Endpoint { vendor, format, address, api_key, proxy_id } = endpoint(service)?;
    let model = crate::copilot_http::bare_model_id(&vendor, model).to_string();
    let proxy = outbound_proxy(app, &proxy_id)?;
    let text = crate::copilot_http::complete(
        &format,
        &address,
        &api_key,
        &model,
        turns,
        SUMMARY_OUTPUT_TOKENS,
        proxy.as_ref(),
        |_, _| {},
        crate::copilot_http::Stop::new(),
    )
    .await?;
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty summary".into());
    }
    {
        let app = app.clone();
        let chat_id = chat_id.to_string();
        let text = text.clone();
        crate::blocking::run(move || crate::app_db::with(&app, |conn| crate::copilot_chats::insert_summary(conn, &chat_id, covers_to, &text))).await?;
    }
    let _ = app.emit("copilot-summary", SummaryEvent { chat_id: chat_id.to_string(), covers_to, text });
    Ok(())
}

#[tauri::command]
pub fn copilot_providers(app: AppHandle) -> Result<Vec<ProviderView>, String> {
    load_memory(&app)?;
    let guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
    Ok(views(guard.as_ref().ok_or("config missing")?))
}

#[tauri::command]
pub fn copilot_save_provider(
    app: AppHandle,
    input: ProviderInput,
) -> Result<Vec<ProviderView>, String> {
    load_memory(&app)?;
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("empty-name".into());
    }
    let mut guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
    let memory = guard.as_mut().ok_or("config missing")?;
    let previous = input
        .previous_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if memory
        .providers
        .iter()
        .any(|provider| provider.name == name && Some(provider.name.as_str()) != previous)
    {
        return Err("duplicate-name".into());
    }
    let kept = previous.and_then(|old| {
        memory
            .providers
            .iter()
            .find(|provider| provider.name == old)
    });
    let api_key = match input.api_key {
        Some(value) if !value.is_empty() => value,
        _ => kept
            .map(|provider| provider.api_key.clone())
            .unwrap_or_default(),
    };
    let next = LiveProvider {
        name: name.clone(),
        vendor: input.vendor,
        format: input.format,
        address: input.address.trim().to_string(),
        api_key,
        models: input.models,
        proxy_id: input.proxy_id.trim().to_string(),
    };
    if let Some(old) = previous {
        if let Some(slot) = memory
            .providers
            .iter_mut()
            .find(|provider| provider.name == old)
        {
            *slot = next;
        } else {
            memory.providers.push(next);
        }
    } else {
        memory.providers.push(next);
    }
    persist(&app, memory)?;
    let _ = app.emit("copilot-providers-changed", ());
    Ok(views(memory))
}

#[tauri::command]
pub fn copilot_delete_provider(app: AppHandle, name: String) -> Result<Vec<ProviderView>, String> {
    load_memory(&app)?;
    let name = name.trim().to_string();
    let mut guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
    let memory = guard.as_mut().ok_or("config missing")?;
    memory.providers.retain(|provider| provider.name != name);
    persist(&app, memory)?;
    let _ = app.emit("copilot-providers-changed", ());
    Ok(views(memory))
}

fn proxy_views(memory: &Memory) -> Vec<ProxyView> {
    memory
        .proxies
        .iter()
        .map(|proxy| ProxyView {
            id: proxy.id.clone(),
            name: proxy.name.clone(),
            protocol: proxy.protocol.clone(),
            host: proxy.host.clone(),
            port: proxy.port,
            has_auth: !proxy.username.is_empty() || !proxy.password.is_empty(),
        })
        .collect()
}

fn outbound_proxy(app: &AppHandle, proxy_id: &str) -> Result<Option<crate::copilot_http::OutboundProxy>, String> {
    let id = proxy_id.trim();
    if id.is_empty() {
        return Ok(None);
    }
    load_memory(app)?;
    let guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
    let memory = guard.as_ref().ok_or("config missing")?;
    Ok(memory.proxies.iter().find(|proxy| proxy.id == id).map(|proxy| crate::copilot_http::OutboundProxy {
        protocol: proxy.protocol.clone(),
        host: proxy.host.clone(),
        port: proxy.port,
        username: proxy.username.clone(),
        password: proxy.password.clone(),
    }))
}

#[tauri::command]
pub fn copilot_proxies(app: AppHandle) -> Result<Vec<ProxyView>, String> {
    load_memory(&app)?;
    let guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
    Ok(proxy_views(guard.as_ref().ok_or("config missing")?))
}

#[tauri::command]
pub fn copilot_save_proxy(app: AppHandle, input: ProxyInput) -> Result<Vec<ProxyView>, String> {
    load_memory(&app)?;
    let name = input.name.trim().to_string();
    let host = input.host.trim().to_string();
    let id = input.id.trim().to_string();
    if name.is_empty() {
        return Err("empty-name".into());
    }
    if id.is_empty() || host.is_empty() || host.chars().any(|ch| ch.is_whitespace() || ch == '/' || ch == '@') || input.port == 0 {
        return Err("bad-proxy".into());
    }
    if input.protocol != "http" && input.protocol != "socks5" {
        return Err("bad-proxy".into());
    }
    let mut guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
    let memory = guard.as_mut().ok_or("config missing")?;
    if memory.proxies.iter().any(|proxy| proxy.name == name && proxy.id != id) {
        return Err("duplicate-name".into());
    }
    let kept = memory.proxies.iter().find(|proxy| proxy.id == id);
    let username = input.username.unwrap_or_default();
    let password = input.password.unwrap_or_default();
    let (username, password) = if username.trim().is_empty() && password.is_empty() {
        kept.map(|proxy| (proxy.username.clone(), proxy.password.clone())).unwrap_or_default()
    } else if password.is_empty() {
        (username.trim().to_string(), kept.map(|proxy| proxy.password.clone()).unwrap_or_default())
    } else {
        (username.trim().to_string(), password)
    };
    let next = LiveProxy {
        id,
        name,
        protocol: input.protocol,
        host,
        port: input.port,
        username,
        password,
    };
    if let Some(slot) = memory.proxies.iter_mut().find(|proxy| proxy.id == next.id) {
        *slot = next;
    } else {
        memory.proxies.push(next);
    }
    persist(&app, memory)?;
    Ok(proxy_views(memory))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_uses_a_fresh_nonce() {
        let key = wrapping_key(&Uuid::new_v4());
        let (nonce_a, secret_a) = seal(&key, "sk-test").unwrap();
        let (nonce_b, secret_b) = seal(&key, "sk-test").unwrap();
        assert_ne!(nonce_a, nonce_b);
        assert_ne!(secret_a, secret_b);
        assert_eq!(open(&key, &nonce_a, &secret_a).unwrap(), "sk-test");
    }

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("memory db");
        for sql in crate::app_db::SCHEMA {
            conn.execute_batch(sql).expect("schema");
        }
        conn
    }

    #[test]
    fn context_turns_fold_the_summary_into_the_next_user_turn_and_use_the_prompt_last() {
        use crate::copilot_chats::{append, insert_summary, ChatMessage, ChatMeta};
        let conn = memory_db();
        let meta = ChatMeta { id: "x".into(), title: "t".into(), module_path: String::new(), module_name: String::new(), service: "s".into(), model: "m".into() };
        let msg = |role: &str, text: &str, prompt: Option<&str>| ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: role.into(),
            text: text.into(),
            prompt: prompt.map(str::to_string),
            thinking: None,
            thought_seconds: None,
        };
        append(&conn, &meta, &msg("user", "q0", Some("P0"))).unwrap();
        append(&conn, &meta, &msg("assistant", "a0", None)).unwrap();
        append(&conn, &meta, &msg("user", "q1", Some("P1"))).unwrap();
        append(&conn, &meta, &msg("assistant", "a1", None)).unwrap();
        append(&conn, &meta, &msg("user", "q2", Some("P2"))).unwrap();

        let turns = context_turns(&conn, "x").unwrap();
        let texts: Vec<&str> = turns.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(texts, ["q0", "a0", "q1", "a1", "P2"], "history uses text, the newest user turn uses its prompt");

        insert_summary(&conn, "x", 1, "SUM").unwrap();
        let turns = context_turns(&conn, "x").unwrap();
        assert_eq!(turns.len(), 3);
        assert!(turns[0].text.starts_with("[Summary of the earlier conversation]\nSUM"));
        assert!(turns[0].text.ends_with("q1"));
        assert_eq!(turns[1].text, "a1");
        assert_eq!(turns[2].text, "P2");
    }

    #[test]
    fn fresh_install_creates_a_stable_uuid_and_empty_lists() {
        let dir = std::env::temp_dir().join(format!("ek-copilot-fresh-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let conn = memory_db();
        let first = ensure_body(&conn, &dir).unwrap();
        assert!(Uuid::parse_str(&first.uuid).is_ok());
        assert!(first.providers.is_empty() && first.proxies.is_empty());
        let second = ensure_body(&conn, &dir).unwrap();
        assert_eq!(first.uuid, second.uuid, "the wrapping key must not change between runs");
        assert!(!dir.join(format!("{LEGACY_FILE_NAME}.migrated")).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_file_round_trips_through_the_database() {
        let dir = std::env::temp_dir().join(format!("ek-copilot-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let legacy = dir.join(LEGACY_FILE_NAME);
        let uuid = Uuid::new_v4();
        let key = wrapping_key(&uuid);
        let (nonce, secret) = seal(&key, "sk-test").unwrap();
        let (auth_nonce, auth_secret) = seal(&key, r#"{"username":"u","password":"p"}"#).unwrap();
        fs::write(
            &legacy,
            serde_json::to_string(&FileBody {
                uuid: uuid.to_string(),
                providers: vec![StoredProvider {
                    name: "openai".into(),
                    vendor: "openai".into(),
                    format: "chat".into(),
                    address: "https://api.openai.com".into(),
                    nonce,
                    secret,
                    models: vec!["gpt-4o".into(), "o3".into()],
                    proxy_id: "px".into(),
                }],
                proxies: vec![StoredProxy {
                    id: "px".into(),
                    name: "home".into(),
                    protocol: "socks5".into(),
                    host: "127.0.0.1".into(),
                    port: 7897,
                    auth_nonce,
                    auth_secret,
                }],
            })
            .unwrap(),
        )
        .unwrap();

        let conn = memory_db();
        assert!(read_body(&conn).unwrap().is_none());
        let body = ensure_body(&conn, &dir).unwrap();
        assert!(!legacy.exists(), "legacy file is renamed after import");
        assert!(dir.join(format!("{LEGACY_FILE_NAME}.migrated")).exists());
        assert_eq!(read_body(&conn).unwrap().expect("stored body").uuid, body.uuid);
        assert_eq!(body.uuid, uuid.to_string());
        assert_eq!(body.providers.len(), 1);
        assert_eq!(body.providers[0].models, vec!["gpt-4o".to_string(), "o3".to_string()]);
        assert_eq!(body.providers[0].proxy_id, "px");
        assert_eq!(open(&key, &body.providers[0].nonce, &body.providers[0].secret).unwrap(), "sk-test");
        assert_eq!(body.proxies.len(), 1);
        assert_eq!(body.proxies[0].port, 7897);
        assert!(open(&key, &body.proxies[0].auth_nonce, &body.proxies[0].auth_secret).unwrap().contains("\"username\":\"u\""));

        // A second write replaces the lists instead of appending.
        let mut next = body;
        next.providers.clear();
        write_body(&conn, &next).unwrap();
        assert!(read_body(&conn).unwrap().unwrap().providers.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
