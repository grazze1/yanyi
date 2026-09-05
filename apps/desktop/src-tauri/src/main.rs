#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const EDGE_EXTENSION_ID: &str = "ajpiobadehjdkionkgfkpipjfgdgopjn";
const CHROME_EXTENSION_ID: &str = "clneblfdkkemjfehjgolimihblegcice";
const HOST_NAME: &str = "cn.yanyi.native_host";

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn local_app_data() -> Result<PathBuf, String> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "LOCALAPPDATA 不可用。".to_owned())
}

fn reg(arguments: &[&str]) -> Result<(), String> {
    let status = hidden_command("reg.exe")
        .args(arguments)
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("reg.exe 退出码：{status}"))
    }
}

fn write_manifest(path: &Path, host_path: &Path, extension_id: &str) -> Result<(), String> {
    let manifest = serde_json::json!({
        "name": HOST_NAME,
        "description": "Yanyi local translation native host",
        "path": host_path,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{extension_id}/")],
    });
    let parent = path
        .parent()
        .ok_or_else(|| "Manifest 路径无效。".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(
        path,
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

// Windows exposes the read-only file attribute through this cross-platform API. Clearing it is
// required before replacing or removing the installed Native Host; the Unix-specific warning does
// not apply to this Windows installer binary.
#[allow(clippy::permissions_set_readonly_false)]
fn make_writable(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let mut permissions = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .permissions();
    if permissions.readonly() {
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Stages a host beside its destination and rolls back the previous executable
/// if the final same-volume rename fails. This also makes same-version repair
/// installs reliable after the installed host was marked read-only.
fn replace_installed_host(source: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "Native Host destination is invalid.".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let suffix = std::process::id();
    let staged = parent.join(format!("yanyi-native-host.exe.new-{suffix}"));
    let previous = parent.join(format!("yanyi-native-host.exe.old-{suffix}"));
    for path in [&staged, &previous] {
        if path.exists() {
            make_writable(path)?;
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    fs::copy(source, &staged).map_err(|error| error.to_string())?;
    let mut staged_permissions = fs::metadata(&staged)
        .map_err(|error| error.to_string())?
        .permissions();
    staged_permissions.set_readonly(true);
    fs::set_permissions(&staged, staged_permissions).map_err(|error| error.to_string())?;

    let had_destination = destination.exists();
    if had_destination {
        make_writable(destination)?;
        fs::rename(destination, &previous).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&staged, destination) {
        if had_destination {
            let _ = fs::rename(&previous, destination);
        }
        let _ = make_writable(&staged);
        let _ = fs::remove_file(&staged);
        return Err(error.to_string());
    }
    if had_destination {
        make_writable(&previous)?;
        fs::remove_file(&previous).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn remove_installed_binaries(root: &Path) -> Result<(), String> {
    let bin = root.join("bin");
    if !bin.exists() {
        return Ok(());
    }
    for version in fs::read_dir(&bin).map_err(|error| error.to_string())? {
        let version = version.map_err(|error| error.to_string())?.path();
        if version.is_dir() {
            for file in fs::read_dir(&version).map_err(|error| error.to_string())? {
                make_writable(&file.map_err(|error| error.to_string())?.path())?;
            }
        } else {
            make_writable(&version)?;
        }
    }
    fs::remove_dir_all(bin).map_err(|error| error.to_string())
}

fn register_native_host() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let install_root = executable
        .parent()
        .ok_or_else(|| "安装目录无效。".to_owned())?;
    let bundled_host = install_root
        .join("resources")
        .join("native-host")
        .join("yanyi-native-host.exe");
    if !bundled_host.is_file() {
        return Err(format!(
            "找不到安装包内 Native Host：{}",
            bundled_host.display()
        ));
    }
    let root = local_app_data()?.join("Yanyi");
    let versioned_dir = root.join("bin").join(env!("CARGO_PKG_VERSION"));
    let installed_host = versioned_dir.join("yanyi-native-host.exe");
    replace_installed_host(&bundled_host, &installed_host)?;
    for (browser, extension_id, registry_root) in [
        (
            "edge",
            EDGE_EXTENSION_ID,
            r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\cn.yanyi.native_host",
        ),
        (
            "chrome",
            CHROME_EXTENSION_ID,
            r"HKCU\Software\Google\Chrome\NativeMessagingHosts\cn.yanyi.native_host",
        ),
    ] {
        let manifest_path = root
            .join("NativeMessagingHosts")
            .join(browser)
            .join("cn.yanyi.native_host.json");
        write_manifest(&manifest_path, &installed_host, extension_id)?;
        let manifest_value = manifest_path.to_string_lossy().into_owned();
        reg(&[
            "add",
            registry_root,
            "/ve",
            "/t",
            "REG_SZ",
            "/d",
            &manifest_value,
            "/f",
        ])?;
    }
    Ok(())
}

fn unregister_native_host() -> Result<(), String> {
    for registry_root in [
        r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\cn.yanyi.native_host",
        r"HKCU\Software\Google\Chrome\NativeMessagingHosts\cn.yanyi.native_host",
    ] {
        let _ = reg(&["delete", registry_root, "/f"]);
    }
    let root = local_app_data()?.join("Yanyi");
    let manifests = root.join("NativeMessagingHosts");
    if manifests.exists() {
        fs::remove_dir_all(manifests).map_err(|error| error.to_string())?;
    }
    remove_installed_binaries(&root)?;
    Ok(())
}

fn main() {
    let arguments = std::env::args().collect::<Vec<_>>();
    let command = if arguments
        .iter()
        .any(|argument| argument == "--register-native-host")
    {
        Some(register_native_host())
    } else if arguments
        .iter()
        .any(|argument| argument == "--unregister-native-host")
    {
        Some(unregister_native_host())
    } else {
        None
    };
    if let Some(result) = command {
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    yanyi_desktop_lib::run();
}

#[cfg(test)]
mod tests {
    use super::{make_writable, remove_installed_binaries, replace_installed_host};

    #[test]
    fn staged_host_replacement_supports_read_only_repair_and_binary_cleanup() {
        let root = std::env::temp_dir().join(format!(
            "yanyi-native-registration-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let source = root.join("bundle").join("host.exe");
        let destination = root
            .join("Yanyi")
            .join("bin")
            .join("0.1.0")
            .join("host.exe");
        std::fs::create_dir_all(source.parent().expect("source parent")).expect("source directory");
        std::fs::write(&source, b"first").expect("source executable");
        replace_installed_host(&source, &destination).expect("first install");
        assert_eq!(
            std::fs::read(&destination).expect("installed host"),
            b"first"
        );
        assert!(
            std::fs::metadata(&destination)
                .expect("installed metadata")
                .permissions()
                .readonly()
        );

        std::fs::write(&source, b"second").expect("updated source executable");
        replace_installed_host(&source, &destination).expect("repair install");
        assert_eq!(
            std::fs::read(&destination).expect("repaired host"),
            b"second"
        );

        let yanyi_root = root.join("Yanyi");
        std::fs::create_dir_all(yanyi_root.join("data")).expect("data directory");
        std::fs::write(yanyi_root.join("data").join("yanyi.db"), b"user-data").expect("user data");
        remove_installed_binaries(&yanyi_root).expect("remove executable artifacts");
        assert!(!yanyi_root.join("bin").exists());
        assert!(yanyi_root.join("data").join("yanyi.db").exists());
        make_writable(&destination).expect("missing destination is harmless");
        std::fs::remove_dir_all(root).expect("cleanup test directory");
    }
}
