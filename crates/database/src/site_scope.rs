//! Site-scoped active conversations.
//!
//! A reading session belongs to a website rather than to a single selection.
//! Every URL origin keeps at most one active conversation, so repeated
//! "询问研译" actions append to the same thread. New conversations are created
//! only when the caller explicitly asks for one.

use sqlx::SqlitePool;
use url::Url;

use crate::DatabaseError;

/// Normalises a page URL to its origin: scheme + host + port.
///
/// Distinct origins never share a conversation, and no fuzzy string matching is
/// used. Returns `None` for URLs without a usable origin (`about:`, `file:`,
/// malformed input), which callers treat as "not site scoped".
pub fn site_origin(page_url: &str) -> Option<String> {
    let url = Url::parse(page_url.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?;
    if host.is_empty() {
        return None;
    }
    Some(match url.port() {
        Some(port) => format!("{}://{}:{}", url.scheme(), host, port),
        None => format!("{}://{}", url.scheme(), host),
    })
}

/// Outcome of resolving which conversation a site-scoped request belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveConversation {
    pub conversation_id: String,
    /// False when an existing active conversation was reused.
    pub created: bool,
}

impl super::Repository {
    /// Reads the active conversation for one origin, ignoring rows whose
    /// conversation has since been archived or deleted.
    pub async fn active_conversation_for_site(
        &self,
        origin: &str,
    ) -> Result<Option<String>, DatabaseError> {
        Ok(sqlx::query_scalar(
            "SELECT s.conversation_id FROM site_active_conversations s \
             JOIN conversations c ON c.id=s.conversation_id \
             WHERE s.site_origin=? AND c.status IN ('active','legacy')",
        )
        .bind(origin)
        .fetch_optional(self.pool())
        .await?)
    }

    /// Binds one conversation as the active thread for an origin. Used both when
    /// a conversation is created and when the user opens a historical one.
    pub async fn set_active_conversation_for_site(
        &self,
        origin: &str,
        conversation_id: &str,
        knowledge_mode: &str,
    ) -> Result<(), DatabaseError> {
        sqlx::query(
            "INSERT INTO site_active_conversations(site_origin,conversation_id,knowledge_mode,created_at,updated_at) \
             VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) \
             ON CONFLICT(site_origin) DO UPDATE SET \
               conversation_id=excluded.conversation_id, \
               knowledge_mode=excluded.knowledge_mode, \
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        )
        .bind(origin)
        .bind(conversation_id)
        .bind(knowledge_mode)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    /// Clears the binding for an origin so the next request starts a new thread.
    pub async fn clear_active_conversation_for_site(
        &self,
        origin: &str,
    ) -> Result<(), DatabaseError> {
        sqlx::query("DELETE FROM site_active_conversations WHERE site_origin=?")
            .bind(origin)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    /// Records the page a conversation was most recently used on. Per-message
    /// context stays authoritative; this is only for listing and restoration.
    pub async fn touch_conversation_page(
        &self,
        conversation_id: &str,
        origin: Option<&str>,
        page_url: Option<&str>,
        page_title: Option<&str>,
    ) -> Result<(), DatabaseError> {
        sqlx::query(
            "UPDATE conversations SET \
               site_origin=COALESCE(?,site_origin), \
               last_page_url=COALESCE(?,last_page_url), \
               last_page_title=COALESCE(?,last_page_title), \
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') \
             WHERE id=?",
        )
        .bind(origin)
        .bind(page_url)
        .bind(page_title)
        .bind(conversation_id)
        .execute(self.pool())
        .await?;
        Ok(())
    }
}

/// Test-only helper so integration tests can assert conversation counts per origin.
pub async fn conversation_count_for_site(
    pool: &SqlitePool,
    origin: &str,
) -> Result<i64, DatabaseError> {
    Ok(
        sqlx::query_scalar("SELECT COUNT(*) FROM conversations WHERE site_origin=?")
            .bind(origin)
            .fetch_one(pool)
            .await?,
    )
}

#[cfg(test)]
mod tests {
    use super::site_origin;

    #[test]
    fn origin_is_scheme_host_and_port() {
        assert_eq!(
            site_origin("https://developer.nvidia.com/blog/post-a?x=1#frag").as_deref(),
            Some("https://developer.nvidia.com")
        );
        assert_eq!(
            site_origin("http://127.0.0.1:8080/docs").as_deref(),
            Some("http://127.0.0.1:8080")
        );
    }

    #[test]
    fn different_pages_of_one_site_share_an_origin() {
        assert_eq!(
            site_origin("https://developer.nvidia.com/page-a"),
            site_origin("https://developer.nvidia.com/page-b")
        );
    }

    #[test]
    fn different_sites_never_share_an_origin() {
        assert_ne!(
            site_origin("https://developer.nvidia.com/a"),
            site_origin("https://docs.pytorch.org/a")
        );
        // Scheme and port are part of the identity.
        assert_ne!(
            site_origin("https://example.com/a"),
            site_origin("http://example.com/a")
        );
        assert_ne!(
            site_origin("https://example.com/a"),
            site_origin("https://example.com:8443/a")
        );
    }

    #[test]
    fn unsupported_schemes_are_not_site_scoped() {
        assert_eq!(site_origin("about:blank"), None);
        assert_eq!(site_origin("file:///C:/tmp/a.html"), None);
        assert_eq!(site_origin("edge://settings"), None);
        assert_eq!(site_origin("not a url"), None);
        assert_eq!(site_origin(""), None);
    }
}
