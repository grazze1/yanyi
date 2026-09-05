use thiserror::Error;

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("secret encryption failed")]
    Encrypt,
    #[error("secret decryption failed")]
    Decrypt,
    #[error("secret is not valid UTF-8")]
    InvalidUtf8,
    #[error("DPAPI is only available on Windows")]
    UnsupportedPlatform,
}

pub trait SecretProtector: Send + Sync {
    fn protect(&self, plaintext: &str) -> Result<Vec<u8>, SecretError>;
    fn unprotect(&self, ciphertext: &[u8]) -> Result<String, SecretError>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsDpapi;

#[cfg(target_os = "windows")]
mod windows_dpapi {
    use std::slice;

    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    };
    use windows::core::PCWSTR;

    use super::{SecretError, SecretProtector, WindowsDpapi};

    impl SecretProtector for WindowsDpapi {
        fn protect(&self, plaintext: &str) -> Result<Vec<u8>, SecretError> {
            let input = CRYPT_INTEGER_BLOB {
                cbData: plaintext
                    .len()
                    .try_into()
                    .map_err(|_| SecretError::Encrypt)?,
                pbData: plaintext.as_ptr().cast_mut(),
            };
            let mut output = CRYPT_INTEGER_BLOB::default();
            unsafe {
                CryptProtectData(
                    &input,
                    PCWSTR::null(),
                    None,
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
                .map_err(|_| SecretError::Encrypt)?;
                let encrypted =
                    slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
                let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
                Ok(encrypted)
            }
        }

        fn unprotect(&self, ciphertext: &[u8]) -> Result<String, SecretError> {
            let input = CRYPT_INTEGER_BLOB {
                cbData: ciphertext
                    .len()
                    .try_into()
                    .map_err(|_| SecretError::Decrypt)?,
                pbData: ciphertext.as_ptr().cast_mut(),
            };
            let mut output = CRYPT_INTEGER_BLOB::default();
            unsafe {
                CryptUnprotectData(
                    &input,
                    None,
                    None,
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
                .map_err(|_| SecretError::Decrypt)?;
                let decrypted =
                    slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
                let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
                String::from_utf8(decrypted).map_err(|_| SecretError::InvalidUtf8)
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
impl SecretProtector for WindowsDpapi {
    fn protect(&self, _plaintext: &str) -> Result<Vec<u8>, SecretError> {
        Err(SecretError::UnsupportedPlatform)
    }

    fn unprotect(&self, _ciphertext: &[u8]) -> Result<String, SecretError> {
        Err(SecretError::UnsupportedPlatform)
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{SecretProtector, WindowsDpapi};

    #[test]
    fn dpapi_round_trip_does_not_store_plaintext() {
        let protector = WindowsDpapi;
        let plaintext = "test-key-never-log";
        let encrypted = protector.protect(plaintext).expect("encrypt with DPAPI");
        assert_ne!(encrypted, plaintext.as_bytes());
        assert_eq!(
            protector.unprotect(&encrypted).expect("decrypt with DPAPI"),
            plaintext
        );
    }
}
