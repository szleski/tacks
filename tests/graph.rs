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
