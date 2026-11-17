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

/// Contents of `static/<name>` with CSS comments removed.
fn static_css(name: &str) -> String {
    let css = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("static")
            .join(name),
    )
    .unwrap();
    let mut out = String::new();
    let mut rest = css.as_str();
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        let comment = &rest[start..];
        rest = &comment[comment.find("*/").expect("unterminated css comment") + 2..];
    }
    out.push_str(rest);
    out
}

/// Whitespace-free bodies of every rule that begins with exactly `opener` (selector plus `{`,
/// at the start of a line or right after another rule), in source order so that later bodies
/// override earlier ones the way equal-specificity rules do in the cascade.
fn css_rule_bodies(css: &str, opener: &str) -> Vec<String> {
    css.match_indices(opener)
        .filter(|(i, _)| *i == 0 || matches!(css.as_bytes()[i - 1], b'\n' | b'}' | b','))
        .map(|(i, _)| {
            let body = &css[i + opener.len()..];
            let body = &body[..body.find('}').expect("unterminated css rule")];
            body.split_whitespace().collect::<String>()
        })
        .collect()
}

/// Resolve `--<name>` to a `#rrggbb` colour across `blocks` (last declaration wins),
/// following `var(--other)` indirections.
fn resolve_css_hex(blocks: &[String], name: &str) -> String {
    let prefix = format!("--{name}:");
    let decl = blocks
        .iter()
        .flat_map(|b| b.split(';'))
        .rfind(|d| d.starts_with(&prefix))
        .unwrap_or_else(|| panic!("css token --{name} is not declared in {blocks:?}"));
    match decl[prefix.len()..]
        .strip_prefix("var(--")
        .and_then(|v| v.strip_suffix(')'))
    {
        Some(other) => resolve_css_hex(blocks, other),
        None => css_hex_token(decl, name).to_string(),
    }
}

// Highlighted blockers (solid) and dependents (dashed) are drawn as edge strokes and card rings
// straight on the graph background (`--pico-card-background-color`). The old blue/purple pair was
// ~1.1:1 apart in lightness, which collapses to dE ~1 under deuteranopia, so the pair must stay
// separable by lightness (not hue alone) and each must stay visible on the background (4.5:1).
// The background is resolved from the CSS cascade (pico.min.css, then app.css overrides): light
// resolves to Pico's `var(--pico-background-color)` as overridden in app.css, dark to
// `var(--surface-raised)`.
#[test]
fn graph_highlight_colours_stay_legible_and_differ_in_lightness() {
    let app = static_css("app.css");
    let pico = static_css("pico.min.css");
    let graph_svg = app
        .lines()
        .find(|l| l.starts_with("#graph-svg {"))
        .expect("no `#graph-svg {` rule in app.css");
    assert!(
        graph_svg.contains("background: var(--pico-card-background-color)"),
        "graph background is no longer --pico-card-background-color; update this test: {graph_svg}"
    );
    let bodies = |css: &str, openers: &[&str]| -> Vec<String> {
        openers
            .iter()
            .flat_map(|o| css_rule_bodies(css, o))
            .collect()
    };
    let mut light_surface = bodies(&pico, &[":root:not([data-theme=dark]),[data-theme=light]{"]);
    light_surface.extend(bodies(&app, &[":root:not([data-theme=\"dark\"]) {"]));
    let mut dark_surface = bodies(&pico, &["[data-theme=dark]{"]);
    dark_surface.extend(bodies(&app, &["[data-theme=\"dark\"] {"]));
    let light_graph = bodies(&app, &["#dependency-graph {"]);
    let mut dark_graph = light_graph.clone();
    dark_graph.extend(bodies(&app, &["[data-theme=\"dark\"] #dependency-graph {"]));

    for (theme, surface, graph) in [
        ("light", &light_surface, &light_graph),
        ("dark", &dark_surface, &dark_graph),
    ] {
        let background = resolve_css_hex(surface, "pico-card-background-color");
        let blocker = resolve_css_hex(graph, "graph-blocker");
        let dependent = resolve_css_hex(graph, "graph-dependent");
        for (role, colour) in [("blocker", &blocker), ("dependent", &dependent)] {
            let ratio = contrast_ratio(colour, &background);
            assert!(
                ratio >= 4.5,
                "{theme} {role} {colour} on graph background {background} has contrast {ratio:.2}:1, need >= 4.5:1"
            );
        }
        let ratio = contrast_ratio(&blocker, &dependent);
        assert!(
            ratio >= 1.5,
            "{theme} blocker {blocker} and dependent {dependent} differ in lightness by only {ratio:.2}:1, need >= 1.5:1 to stay distinguishable without colour"
        );
    }
}

/// Insert a task with an explicit status, optional parent and tags. Parents must be inserted first.
fn insert_task(db: &Database, id: &str, parent: Option<&str>, status: Status, tags: &[&str]) {
    let now = chrono::Utc::now();
    db.insert_task(&Task {
        id: id.into(),
        title: format!("Issue {id}"),
        description: None,
        status,
        priority: 2,
        assignee: None,
        parent_id: parent.map(str::to_string),
        tags: tags.iter().map(|t| t.to_string()).collect(),
        created_at: now,
        updated_at: now,
        close_reason: None,
        notes: None,
    })
    .unwrap();
}

/// Serve the web app for `db` on an ephemeral local port; returns the base url and the server task.
async fn serve(db: Database) -> (String, tokio::task::JoinHandle<()>) {
    let app = tacks::web::create_router(tacks::web::AppState {
        db: Arc::new(Mutex::new(db)),
        last_data_version: Arc::new(AtomicI64::new(0)),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
    (url, server)
}

/// GET `url` and return the body, failing on a non-success status.
async fn get_text(client: &reqwest::Client, url: &str) -> String {
    client
        .get(url)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap()
}

/// The opening tag (from `<` to `>`) of the element carrying `id="<id>"`.
fn html_tag<'a>(html: &'a str, id: &str) -> &'a str {
    let at = html
        .find(&format!("id=\"{id}\""))
        .unwrap_or_else(|| panic!("no element with id {id}"));
    let start = html[..at].rfind('<').unwrap();
    let end = at + html[at..].find('>').unwrap();
    &html[start..=end]
}

// "Hide completed epics" is a display choice made in the browser (static/graph.js filters with
// hideCompletedEpics from static/graph-layout.js). The server must keep returning every issue and
// dependency from /api/graph and only ship the controls and scripts that apply the choice.
#[tokio::test]
async fn graph_hide_completed_epics_is_a_client_side_option() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("graph-hide.db")).unwrap();
    db.migrate().unwrap();
    insert_task(&db, "done-epic", None, Status::Done, &["epic"]);
    insert_task(&db, "done-1", Some("done-epic"), Status::Done, &[]);
    insert_task(&db, "done-2", Some("done-epic"), Status::Done, &[]);
    insert_task(&db, "open-epic", None, Status::Open, &["epic"]);
    insert_task(&db, "open-1", Some("open-epic"), Status::Open, &[]);
    db.add_dependency("open-1", "done-1").unwrap();
    let (url, server) = serve(db).await;
    let client = reqwest::Client::new();

    // The page ships the toggle (unchecked by default) and a hidden empty-state message.
    let html = get_text(&client, &format!("{url}/graph")).await;
    assert!(html.contains("id=\"graph-hide-done\""));
    assert!(html.contains("Hide completed epics"));
    assert!(html.contains("id=\"graph-empty\""));
    let toggle = html_tag(&html, "graph-hide-done");
    assert!(
        toggle.contains("type=\"checkbox\""),
        "toggle is a checkbox: {toggle}"
    );
    assert!(
        !toggle.contains("checked"),
        "hiding must be off until the browser restores a saved choice: {toggle}"
    );
    let empty = html_tag(&html, "graph-empty");
    assert!(
        empty
            .trim_end_matches('>')
            .split_whitespace()
            .any(|attr| attr == "hidden"),
        "empty-state message starts hidden: {empty}"
    );

    // The API is unaffected: the completed epic and its children are still returned in full.
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
    let tasks = data["tasks"].as_array().unwrap();
    let mut task_ids: Vec<&str> = tasks.iter().map(|t| t["id"].as_str().unwrap()).collect();
    task_ids.sort_unstable();
    assert_eq!(
        task_ids,
        ["done-1", "done-2", "done-epic", "open-1", "open-epic"]
    );
    for (id, status) in [
        ("done-epic", "done"),
        ("done-1", "done"),
        ("done-2", "done"),
        ("open-epic", "open"),
        ("open-1", "open"),
    ] {
        let task = tasks.iter().find(|t| t["id"] == id).unwrap();
        assert_eq!(task["status"], status, "status of {id}");
    }
    assert_eq!(
        data["dependencies"],
        serde_json::json!([{"parent_id": "done-1", "child_id": "open-1"}])
    );

    // The scripts that implement and persist the option are served.
    let layout_js = get_text(&client, &format!("{url}/static/graph-layout.js")).await;
    assert!(layout_js.contains("hideCompletedEpics"));
    let graph_js = get_text(&client, &format!("{url}/static/graph.js")).await;
    assert!(
        graph_js.contains("graph-hide-done"),
        "graph.js must bind the checkbox id from the template"
    );
    assert!(
        graph_js.contains("graph-hide-completed-epics"),
        "the saved-choice storage key is part of users' saved state"
    );
    server.abort();
}
