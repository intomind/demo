//! Pairing on Linux, so a device can be paired without a person at the
//! computer's Bluetooth settings.
//!
//! The system's Bluetooth service completes a pairing only when some
//! program has registered an agent to answer for the computer. The
//! desktop's settings register one while they are open. A plain program
//! does not, and then pairing fails quietly and the first encrypted
//! operation waits. So this registers an agent for this program and asks
//! the system to pair over the same connection, and the system uses that
//! agent for this pairing and nothing else. It is never the system's
//! default agent. It accepts the pairing an IntoMind One asks for, which
//! needs no passkey and no display, and refuses anything that would need
//! one. A device already paired is left as it is.

use std::time::Duration;

use tokio::sync::OnceCell;
use zbus::fdo::ObjectManagerProxy;
use zbus::zvariant::{ObjectPath, OwnedObjectPath};
use zbus::{interface, Connection, Proxy};

const AGENT: &str = "/com/intomind/demos/agent";

/// The connection the agent lives on, kept for the life of the program.
static BUS: OnceCell<Connection> = OnceCell::const_new();

#[derive(Debug, zbus::DBusError)]
#[zbus(prefix = "org.bluez.Error")]
enum AgentError {
    #[zbus(error)]
    ZBus(zbus::Error),
    Rejected(String),
}

struct Agent;

#[interface(name = "org.bluez.Agent1")]
impl Agent {
    fn release(&self) {}
    fn request_pin_code(&self, _device: OwnedObjectPath) -> Result<String, AgentError> {
        Err(AgentError::Rejected("no IntoMind device asks for a PIN".into()))
    }
    fn display_pin_code(&self, _device: OwnedObjectPath, _pincode: String) {}
    fn request_passkey(&self, _device: OwnedObjectPath) -> Result<u32, AgentError> {
        Err(AgentError::Rejected("no IntoMind device asks for a passkey".into()))
    }
    fn display_passkey(&self, _device: OwnedObjectPath, _passkey: u32, _entered: u16) {}
    fn request_confirmation(&self, _device: OwnedObjectPath, _passkey: u32) {}
    fn request_authorization(&self, _device: OwnedObjectPath) {}
    fn authorize_service(&self, _device: OwnedObjectPath, _uuid: String) {}
    fn cancel(&self) {}
}

async fn bus() -> zbus::Result<&'static Connection> {
    BUS.get_or_try_init(|| async {
        let conn = Connection::system().await?;
        conn.object_server().at(AGENT, Agent).await?;
        let manager = Proxy::new(&conn, "org.bluez", "/org/bluez", "org.bluez.AgentManager1").await?;
        manager.call_method("RegisterAgent", &(ObjectPath::try_from(AGENT)?, "NoInputNoOutput")).await?;
        Ok(conn)
    })
    .await
}

async fn device_path(conn: &Connection, address: &str) -> zbus::Result<Option<OwnedObjectPath>> {
    let objects = ObjectManagerProxy::builder(conn).destination("org.bluez")?.path("/")?.build().await?.get_managed_objects().await?;
    for (path, interfaces) in objects {
        for (name, props) in interfaces {
            if name.as_str() != "org.bluez.Device1" {
                continue;
            }
            let at = props.get("Address").and_then(|v| String::try_from(v.clone()).ok());
            if at.is_some_and(|a| a.eq_ignore_ascii_case(address)) {
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}

/// Pair the device at this address, answering for the computer. Returns a
/// short note of what happened. A pairing that fails is reported in the
/// note rather than raised: the first encrypted operation is the test that
/// matters, and it is bounded.
pub async fn pair(address: &str, timeout: Duration) -> String {
    let attempt = async {
        let conn = bus().await?;
        let Some(path) = device_path(conn, address).await? else { return Ok("the system does not know the device".to_string()) };
        let device = Proxy::new(conn, "org.bluez", path, "org.bluez.Device1").await?;
        if device.get_property::<bool>("Paired").await? {
            return Ok("already paired".to_string());
        }
        Ok(match tokio::time::timeout(timeout, device.call_method("Pair", &())).await {
            Err(_) => format!("pairing did not complete within {} s", timeout.as_secs()),
            Ok(Err(e)) if e.to_string().contains("AlreadyExists") => "already paired".to_string(),
            Ok(Err(e)) => format!("pairing reported {e}"),
            Ok(Ok(_)) => "pairing completed".to_string(),
        })
    };
    attempt.await.unwrap_or_else(|e: zbus::Error| format!("pairing could not start: {e}"))
}
