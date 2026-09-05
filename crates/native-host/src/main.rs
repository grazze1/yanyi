#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Read;

fn main() {
    let arguments = std::env::args().collect::<Vec<_>>();
    if arguments
        .iter()
        .any(|argument| argument == "--test-connection")
    {
        let model = arguments
            .windows(2)
            .find(|pair| pair[0] == "--model")
            .map(|pair| pair[1].clone());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to create smoke-test runtime");
        match runtime.block_on(native_host::test_api_connection(model)) {
            Ok(result) => println!(
                "{}",
                serde_json::to_string(&result).expect("smoke result must serialize")
            ),
            Err(error) => {
                eprintln!("yanyi-native-host connection test: {error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if arguments
        .iter()
        .any(|argument| argument == "--configure-stdin")
        || arguments
            .iter()
            .any(|argument| argument == "--configure-json-stdin")
    {
        let mut api_key = String::new();
        let configure_json = arguments
            .iter()
            .any(|argument| argument == "--configure-json-stdin");
        if let Err(error) = std::io::stdin().read_to_string(&mut api_key).and_then(|_| {
            if configure_json {
                serde_json::from_str::<native_host::ApiConfigInput>(&api_key)
                    .map_err(std::io::Error::other)
                    .and_then(|input| {
                        native_host::configure_api_config(input).map_err(std::io::Error::other)
                    })
            } else {
                native_host::configure_api_key_from_stdin(&api_key).map_err(std::io::Error::other)
            }
        }) {
            eprintln!("yanyi-native-host configuration: {error}");
            std::process::exit(1);
        }
        eprintln!("yanyi-native-host: DPAPI 配置已保存。");
        return;
    }
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    if let Err(error) = native_host::run(&mut stdin.lock(), &mut stdout) {
        eprintln!("yanyi-native-host: {error}");
        std::process::exit(1);
    }
}
