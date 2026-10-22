//! Local KP Copilot config. The wrapping key and each API key live in one file
//! under the OS app-config directory. Keys are decrypted once into memory.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

const FILE_NAME: &str = "copilot.json";

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

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(FILE_NAME))
}

fn restrict(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

fn read_file(path: &PathBuf) -> Result<Option<FileBody>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|err| err.to_string())
}

fn write_file(path: &PathBuf, body: &FileBody) -> Result<(), String> {
    let text = serde_json::to_string_pretty(body).map_err(|err| err.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, text).map_err(|err| err.to_string())?;
    restrict(&temp);
    fs::rename(&temp, path).map_err(|err| err.to_string())?;
    restrict(path);
    Ok(())
}

fn load_memory(app: &AppHandle) -> Result<(), String> {
    let path = config_path(app)?;
    let mut guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    let file = match read_file(&path)? {
        Some(file) => file,
        None => {
            let created = FileBody {
                uuid: Uuid::new_v4().to_string(),
                providers: Vec::new(),
                proxies: Vec::new(),
            };
            write_file(&path, &created)?;
            created
        }
    };
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
    let path = config_path(app)?;
    let id = match read_file(&path)? {
        Some(file) => file.uuid,
        None => return Err("config missing".into()),
    };
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
    write_file(
        &path,
        &FileBody {
            uuid: id,
            providers,
            proxies,
        },
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    pub request_id: String,
    pub service: String,
    pub model: String,
    pub messages: Vec<CompleteTurn>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamDelta {
    request_id: String,
    kind: String,
    delta: String,
}

#[derive(Deserialize)]
pub struct CompleteTurn {
    pub role: String,
    pub text: String,
}

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

#[tauri::command]
pub async fn copilot_complete(app: AppHandle, request: CompleteRequest) -> Result<String, String> {
    load_memory(&app)?;
    let service = request.service.trim().to_string();
    let model = request.model.trim().to_string();
    if service.is_empty() || model.is_empty() {
        return Err("no-model".into());
    }
    let provider = {
        let guard = MEMORY.lock().map_err(|_| "config busy".to_string())?;
        let memory = guard.as_ref().ok_or("config missing")?;
        let provider = memory
            .providers
            .iter()
            .find(|provider| provider.name == service)
            .ok_or("no-model")?;
        if provider.api_key.is_empty() {
            return Err("no-key".into());
        }
        (
            provider.vendor.clone(),
            provider.format.clone(),
            provider.address.clone(),
            provider.api_key.clone(),
            provider.proxy_id.clone(),
        )
    };
    let (vendor, format, address, api_key, proxy_id) = provider;
    let model = crate::copilot_http::bare_model_id(&vendor, &model).to_string();
    let proxy = outbound_proxy(&app, &proxy_id)?;
    let turns = request
        .messages
        .into_iter()
        .map(|turn| crate::copilot_http::Turn { role: turn.role, text: turn.text })
        .collect::<Vec<_>>();
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
    let result = crate::copilot_http::complete(&format, &address, &api_key, &model, &turns, proxy.as_ref(), |kind, delta| {
        let _ = app.emit(
            "copilot-stream",
            StreamDelta { request_id: request_id.clone(), kind: kind.to_string(), delta: delta.to_string() },
        );
    }, stop)
    .await;
    if let Ok(mut stops) = STOPS.lock() {
        stops.remove(&request_id);
    }
    result
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

#[tauri::command]
pub fn open_copilot_editor(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("copilot-editor") {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    let main = app.get_webview_window("main").ok_or("no-window")?;
    let mut url = main.url().map_err(|err| err.to_string())?;
    url.set_query(Some("copilot=editor"));
    WebviewWindowBuilder::new(&app, "copilot-editor", WebviewUrl::External(url))
        .title("EasyKeeper")
        .inner_size(440.0, 640.0)
        .min_inner_size(360.0, 420.0)
        .center()
        .build()
        .map_err(|err| err.to_string())?;
    Ok(())
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
}
