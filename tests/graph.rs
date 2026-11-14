use std::sync::{Arc, Mutex, atomic::AtomicI64};
use tacks::{
    db::Database,
    models::{Status, Task},
};

#[tokio::test]
async fn graph_includes_completed_isolated_and_cross_epic_issues() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("graph.db")).unwrap();
    db.migrate().unwrap();
    for (id, parent, done) in [
        ("epic-a", None, false),
        ("epic-b", None, false),
        ("a", Some("epic-a"), true),
        ("b", Some("epic-b"), false),
        ("isolated", None, false),
        ("waiting", Some("epic-b"), false),
    ] {
        let now = chrono::Utc::now();
        db.insert_task(&Task {
            id: id.into(),
            title: format!("Issue {id}"),
            description: None,
            status: if done { Status::Done } else { Status::Open },
            priority: 2,
            assignee: None,
            parent_id: parent.map(str::to_string),
            tags: if id.starts_with("epic") {
                vec!["epic".into()]
            } else {
                vec![]
            },
            created_at: now,
            updated_at: now,
            close_reason: None,
            notes: None,
        })
        .unwrap();
    }
    db.add_dependency("b", "a").unwrap();
    db.add_dependency("waiting", "b").unwrap();
    let app = tacks::web::create_router(tacks::web::AppState {
        db: Arc::new(Mutex::new(db)),
        last_data_version: Arc::new(AtomicI64::new(0)),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::new();
    let data: serde_json::Value = client
        .get(format!("{url}/api/graph"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(data["tasks"].as_array().unwrap().len(), 6);
    assert!(
        data["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == "a" && n["status"] == "done")
    );
    assert!(
        data["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == "isolated")
    );
    assert_eq!(
        data["dependencies"],
        serde_json::json!([{"parent_id":"a", "child_id":"b"}, {"parent_id":"b", "child_id":"waiting"}])
    );
    let html = client
        .get(format!("{url}/graph"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(html.contains("id=\"graph-svg\""));
    assert!(html.contains("id=\"nav-graph\""));
    // Web “All statuses” includes completed issues, including during live polling.
    for (query, includes_done) in [
        ("", true),
        ("?status=done", true),
        ("?all=true", true),
        ("?all=false", false),
        ("?status=open", false),
    ] {
        let page = client
            .get(format!("{url}/tasks{query}"))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(
            page.contains("data-href=\"/tasks/a\""),
            includes_done,
            "completed issue visibility for {query}"
        );
        if query == "?all=false" {
            assert!(
                page.contains("hx-get=\"/tasks?all=false\""),
                "live polling preserves an explicit all=false override"
            );
        }
    }
    // A prerequisite must not silently change the status column of an open issue.
    let board = client
        .get(format!("{url}/board"))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let open_column = board
        .split("data-status=\"open\"")
        .nth(1)
        .unwrap()
        .split("data-status=\"in_progress\"")
        .next()
        .unwrap();
    assert!(open_column.contains("data-task-id=\"waiting\""));
    assert!(open_column.contains("Waiting on prerequisites"));
    for path in [
        "/tasks",
        "/board",
        "/epics",
        "/graph",
        "/tasks/waiting",
        "/epics/epic-b",
    ] {
        let page = client
            .get(format!("{url}{path}"))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .text()
            .await
            .unwrap();
        for status in ["open", "in_progress", "blocked", "done"] {
            assert!(
                page.contains(&format!("id=\"status-{status}-icon\"")),
                "{path} missing shared {status} symbol"
            );
        }
    }
    for asset in ["status.js", "graph.js", "graph-layout.js"] {
        assert!(
            client
                .get(format!("{url}/static/{asset}"))
                .send()
                .await
                .unwrap()
                .status()
                .is_success()
        );
    }
    server.abort();
}

/// WCAG relative luminance of a `#rrggbb` colour.
fn relative_luminance(hex: &str) -> f64 {
    let channel = |i: usize| {
        let c = f64::from(u8::from_str_radix(&hex[1 + 2 * i..3 + 2 * i], 16).unwrap()) / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/// WCAG contrast ratio between two `#rrggbb` colours (always >= 1).
fn contrast_ratio(a: &str, b: &str) -> f64 {
    let (la, lb) = (relative_luminance(a), relative_luminance(b));
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

/// Read a 6-digit hex value for `--<name>` from a single-line CSS token rule.
fn css_hex_token<'a>(rule: &'a str, name: &str) -> &'a str {
    let needle = format!("--{name}:#");
    let start = rule
        .find(&needle)
        .unwrap_or_else(|| panic!("missing css token --{name} in `{rule}`"))
        + needle.len()
        - 1;
    let hex = &rule[start..start + 7];
    assert!(
        hex[1..].chars().all(|c| c.is_ascii_hexdigit()),
        "css token --{name} is not a 6-digit hex colour: {hex}"
    );
    hex
}

// Graph cards are filled with `--status-fill-<status>` and labelled with
// `--status-ink-<status>`. Two properties must survive palette tweaks:
// ink stays readable on its fill (WCAG AA, 4.5:1), and the three "cool"
// statuses differ in lightness. Blue (in_progress) and purple (done) fills with
// similar lightness are only ~ΔE 1 apart under deuteranopia/protanopia, so hue
// alone cannot be relied on by red-green colour blind users.
#[test]
fn graph_status_fills_keep_text_contrast_and_cvd_safe_lightness_steps() {
    let css = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("static/app.css"),
    )
    .unwrap();
    for (theme, selector) in [("light", ":root {"), ("dark", "[data-theme=\"dark\"] {")] {
        let rule = css
            .lines()
            .find(|l| l.starts_with(selector) && l.contains("--status-fill-open"))
            .unwrap_or_else(|| panic!("no {theme} status token rule starting with `{selector}`"));
        let fill = |s: &str| css_hex_token(rule, &format!("status-fill-{s}"));
        let ink = |s: &str| css_hex_token(rule, &format!("status-ink-{s}"));
        for status in ["open", "in_progress", "blocked", "done"] {
            let ratio = contrast_ratio(ink(status), fill(status));
            assert!(
                ratio >= 4.5,
                "{theme} {status}: ink {} on fill {} has contrast {ratio:.2}:1, need >= 4.5:1",
                ink(status),
                fill(status)
            );
        }
        for (a, b) in [
            ("open", "in_progress"),
            ("in_progress", "done"),
            ("open", "done"),
        ] {
            let ratio = contrast_ratio(fill(a), fill(b));
            assert!(
                ratio >= 1.5,
                "{theme} fills {a} ({}) and {b} ({}) differ in lightness by only {ratio:.2}:1, need >= 1.5:1 to stay distinguishable without colour",
                fill(a),
                fill(b)
            );
        }
    }
}
