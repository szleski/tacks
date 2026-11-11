#!/usr/bin/env python3
"""Create an isolated 30-issue graph sample through tk's public CLI."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tk', default='tk', help='tk executable (use target/debug/tk for local builds)')
    parser.add_argument('--db', default='.tacks/graph-demo.db', help='new demo database; existing files are refused')
    args = parser.parse_args()
    db = Path(args.db).resolve()
    if db.exists():
        parser.error(f'refusing to overwrite existing database: {db}')
    env = {**os.environ, 'TACKS_DB': str(db)}

    def tk(*command, json_output=False):
        result = subprocess.run([args.tk, *command, *(['--json'] if json_output else [])],
                                env=env, check=True, capture_output=True, text=True)
        return json.loads(result.stdout) if json_output else result.stdout

    tk('init')
    epics = [
        ('Platform foundation', ['Define service contracts', 'Provision database', 'Build CI pipeline', 'Validate platform', 'Document local setup']),
        ('Identity and access', ['Design permission model', 'Implement sign-in', 'Implement access checks', 'Audit identity flows', 'Write account help']),
        ('Core API', ['Define API schema', 'Implement storage layer', 'Build endpoints', 'Run API integration tests', 'Publish API examples']),
        ('Customer workspace', ['Sketch workspace flows', 'Build navigation', 'Connect API screens', 'Run workspace acceptance', 'Polish empty states']),
        ('Release readiness', ['Draft release checklist', 'Configure monitoring', 'Run staging smoke tests', 'Ship release', 'Prepare release notes']),
    ]
    ids = []
    for title, titles in epics:
        parent = tk('create', title, '-t', 'graph-demo,epic', json_output=True)['id']
        children = [tk('create', title, '--parent', parent, '-t', 'graph-demo', '-p', str(1 if i < 4 else 3),
                       '-d', 'Graph demo fixture. Safe to edit in this isolated database.', json_output=True)['id']
                    for i, title in enumerate(titles)]
        ids.append(children)
        # Diamond with a join, plus an independent task in every epic.
        for child, blocker in [(1, 0), (2, 0), (3, 1), (3, 2)]:
            tk('dep', 'add', children[child], children[blocker])
    for child_epic, child, parent_epic, blocker in [
        (1, 1, 0, 1), (2, 1, 0, 1), (2, 2, 1, 2),
        (3, 2, 2, 2), (3, 1, 1, 1), (4, 2, 3, 3), (4, 3, 2, 3),
    ]:
        tk('dep', 'add', ids[child_epic][child], ids[parent_epic][blocker])
    for epic in (0, 1):
        tk('close', ids[epic][0], '-c', 'Completed prerequisite in graph sample')
    tk('update', ids[0][1], '-s', 'in_progress')
    tk('update', ids[4][2], '-s', 'blocked')
    tasks = tk('list', '--all', json_output=True)
    assert len(tasks) == 30
    print(f'Created 5 epics + 25 tasks, 27 dependency edges (7 cross-epic) in {db}')
    print(f'View: {args.tk} --db {db} serve --port 3001')
    print('Open http://localhost:3001/graph')


if __name__ == '__main__':
    main()
