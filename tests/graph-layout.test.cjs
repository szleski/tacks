const {test} = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../static/graph-layout.js');
const node = (id, parent_id = null, tags = []) => ({id, parent_id, tags, title: id, status: 'open'});
const edge = (parent_id, child_id) => ({parent_id, child_id});

test('every issue survives layout, including completed, isolated, epic, nested and leaf nodes', () => {
  const tasks = [node('epic', null, ['epic']), node('a', 'epic'), node('b', 'a'), node('solo'), {...node('done'), status: 'done'}];
  const graph = layout(tasks, [edge('done', 'a'), edge('a', 'b')]);
  assert.equal(graph.nodes.length, tasks.length);
  assert.equal(graph.nodes.find(n => n.id === 'b').lane, 'a');
  assert.ok(graph.nodes.find(n => n.id === 'epic').isLaneHeader);
  assert.ok(graph.nodes.find(n => n.id === 'a').isLaneHeader);
  for (const n of graph.nodes) {
    assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.width < graph.width && n.y + n.height < graph.height);
  }
  assert.equal(new Set(graph.nodes.map(n => `${n.x},${n.y}`)).size, tasks.length);
  assert.deepEqual(tasks.map(n => n.rank), tasks.map(() => undefined), 'input is not mutated');
});

test('diamonds and cross-epic chains always point forward, independent of input order', () => {
  const tasks = [node('E1', null, ['epic']), node('E2', null, ['epic']), node('d', 'E2'), node('b', 'E1'), node('c', 'E2'), node('a', 'E1')];
  const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
  const graph = layout(tasks, edges);
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  for (const e of graph.edges) assert.ok(byId.get(e.parent_id).x < byId.get(e.child_id).x);
  assert.equal(byId.get('d').rank, 2);
  assert.equal(graph.groups.length, 2);
  assert.deepEqual(layout([...tasks].reverse(), edges), graph);
});

test('empty graph is usable and malformed edges do not crash layout', () => {
  assert.equal(layout([], []).nodes.length, 0);
  assert.equal(layout([node('a')], [edge('missing', 'a')]).edges.length, 0);
});

test('five epics become headings and only their 25 member issues consume card rows', () => {
  const tasks = Array.from({length: 5}, (_, i) => [node(`e${i}`, null, ['epic']), ...Array.from({length: 5}, (_, j) => node(`e${i}.${j}`, `e${i}`))]).flat();
  const graph = layout(tasks, []);
  assert.equal(graph.nodes.length, 30);
  assert.equal(graph.nodes.filter(n => n.isLaneHeader).length, 5);
  assert.equal(graph.nodes.filter(n => !n.isLaneHeader).length, 25);
  for (const group of graph.groups) {
    const heading = graph.nodes.find(n => n.id === group.id);
    assert.ok(heading.y >= group.y && heading.y + heading.height < group.y + 44);
    const cards = graph.nodes.filter(n => n.lane === group.id && !n.isLaneHeader);
    assert.equal(cards.length, 5);
    assert.equal(Math.min(...cards.map(n => n.y)), group.y + 44);
  }
});

test('empty epic and actual dependencies on epics stay represented as headings', () => {
  const tasks = [node('empty', null, ['epic']), node('epic', null, ['epic']), node('before'), node('after', 'epic')];
  const edges = [edge('before', 'epic'), edge('epic', 'after')];
  const graph = layout(tasks, edges);
  assert.deepEqual(graph.edges, edges);
  assert.ok(graph.nodes.find(n => n.id === 'empty').isLaneHeader);
  assert.ok(graph.nodes.find(n => n.id === 'epic').isLaneHeader);
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  for (const e of edges) assert.ok(byId.get(e.parent_id).x < byId.get(e.child_id).x);
  for (const n of graph.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
});

// "Hide completed epics": a pure display filter that runs before layout. An epic is a task tagged `epic` or referenced as
// another task's parent; its lane is the epic plus every task whose nearest epic ancestor it is. A lane is hidden only when
// every task in it, the heading included, is done. Independent tasks (the '' lane) are never hidden.
const {hideCompletedEpics} = layout;
const finished = (id, parent_id = null, tags = []) => ({...node(id, parent_id, tags), status: 'done'});
const ids = tasks => tasks.map(t => t.id);
const deepFreeze = tasks => { tasks.forEach(t => { Object.freeze(t.tags); Object.freeze(t); }); return Object.freeze(tasks); };

test('hideCompletedEpics hangs off the layout export and is published globally like layoutTacksGraph', () => {
  assert.equal(typeof layout, 'function');
  assert.equal(typeof hideCompletedEpics, 'function');
  assert.equal(globalThis.hideCompletedEpics, hideCompletedEpics);
  assert.equal(globalThis.layoutTacksGraph, layout);
});

test('no tasks yields an empty result', () => {
  assert.deepEqual(hideCompletedEpics([]), {tasks: [], hiddenEpicIds: [], hiddenIds: []});
});

test('a lane whose epic heading and tickets are all done is hidden and reported', () => {
  const tasks = [finished('epic-a', null, ['backend', 'epic']), finished('epic-a.1', 'epic-a'), finished('epic-a.2', 'epic-a'), node('keep')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(Object.keys(result).sort(), ['hiddenEpicIds', 'hiddenIds', 'tasks']);
  assert.deepEqual(ids(result.tasks), ['keep']);
  assert.deepEqual(result.hiddenEpicIds, ['epic-a']);
  assert.deepEqual(result.hiddenIds, ['epic-a', 'epic-a.1', 'epic-a.2']);
});

for (const status of ['open', 'in_progress', 'blocked']) {
  test(`a done epic keeps its lane while one of its tickets is ${status}`, () => {
    const tasks = [finished('epic', null, ['epic']), finished('epic.1', 'epic'), {...node('epic.2', 'epic'), status}];
    const result = hideCompletedEpics(tasks);
    assert.deepEqual(ids(result.tasks), ['epic', 'epic.1', 'epic.2']);
    assert.deepEqual(result.hiddenEpicIds, []);
    assert.deepEqual(result.hiddenIds, []);
  });
}

test('an open epic heading keeps its lane even when every ticket under it is done', () => {
  const tasks = [node('epic', null, ['epic']), finished('epic.1', 'epic'), finished('epic.2', 'epic')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(ids(result.tasks), ['epic', 'epic.1', 'epic.2']);
  assert.deepEqual(result.hiddenEpicIds, []);
  assert.deepEqual(result.hiddenIds, []);
});

test('an open parent without the epic tag is still an epic heading and keeps its done tickets', () => {
  const tasks = [node('parent'), finished('parent.1', 'parent'), finished('parent.2', 'parent')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(ids(result.tasks), ['parent', 'parent.1', 'parent.2']);
  assert.deepEqual(result.hiddenEpicIds, []);
  assert.deepEqual(result.hiddenIds, []);
});

test('a done parent without the epic tag is hidden with its done tickets because a parent counts as an epic', () => {
  const tasks = [finished('parent'), finished('parent.1', 'parent'), finished('parent.2', 'parent')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.hiddenEpicIds, ['parent']);
  assert.deepEqual(result.hiddenIds, ['parent', 'parent.1', 'parent.2']);
});

test('done independent tickets are never hidden, including ones whose parent is missing', () => {
  const tasks = [finished('solo-a'), finished('solo-b', null, ['bug']), finished('orphan', 'ghost')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(result.tasks, tasks);
  assert.deepEqual(result.hiddenEpicIds, []);
  assert.deepEqual(result.hiddenIds, []);
});

test('done independent tickets stay next to a hidden epic lane', () => {
  const tasks = [finished('epic', null, ['epic']), finished('epic.1', 'epic'), finished('solo-a'), finished('orphan', 'ghost')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(ids(result.tasks), ['solo-a', 'orphan']);
  assert.deepEqual(result.hiddenEpicIds, ['epic']);
  assert.deepEqual(result.hiddenIds, ['epic', 'epic.1']);
});

test('an empty done epic is hidden while an empty open epic stays', () => {
  const tasks = [finished('empty-done', null, ['epic']), node('empty-open', null, ['epic'])];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(ids(result.tasks), ['empty-open']);
  assert.deepEqual(result.hiddenEpicIds, ['empty-done']);
  assert.deepEqual(result.hiddenIds, ['empty-done']);
});

test('a hidden nested epic leaves its live parent epic and the parent tickets in place', () => {
  const tasks = [node('parent', null, ['epic']), node('parent.1', 'parent'), finished('nested', 'parent', ['epic']), finished('nested.1', 'nested')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(ids(result.tasks), ['parent', 'parent.1']);
  assert.deepEqual(result.hiddenEpicIds, ['nested']);
  assert.deepEqual(result.hiddenIds, ['nested', 'nested.1']);
  const graph = layout(result.tasks, []);
  assert.ok(graph.nodes.find(n => n.id === 'parent').isLaneHeader);
  assert.equal(graph.nodes.find(n => n.id === 'parent.1').lane, 'parent');
  assert.deepEqual(graph.groups.map(g => g.id), ['parent']);
});

test('a parent that was only an epic heading because of a hidden nested epic stays a lane header', () => {
  const tasks = [node('parent'), finished('nested', 'parent', ['epic']), finished('nested.1', 'nested')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(ids(result.tasks), ['parent']);
  assert.deepEqual(result.hiddenEpicIds, ['nested']);
  assert.deepEqual(result.tasks[0].tags, ['epic']);
  assert.deepEqual(tasks[0].tags, [], 'the input task keeps its original tags');
  const graph = layout(result.tasks, []);
  assert.ok(graph.nodes[0].isLaneHeader);
  assert.deepEqual(graph.groups.map(g => g.id), ['parent']);
});

test('a parent epic that still has a visible child is returned untouched', () => {
  const tasks = [node('parent'), node('parent.1', 'parent'), finished('nested', 'parent', ['epic']), finished('nested.1', 'nested')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(result.tasks, [tasks[0], tasks[1]]);
  assert.deepEqual(result.tasks[0].tags, []);
});

test('a done parent and its done nested epic are both hidden', () => {
  const tasks = [finished('parent'), finished('nested', 'parent', ['epic']), finished('nested.1', 'nested')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.hiddenEpicIds, ['nested', 'parent']);
  assert.deepEqual(result.hiddenIds, ['nested', 'nested.1', 'parent']);
});

test('nested epics are judged independently, so an open nested epic stays when its done parent is hidden', () => {
  const tasks = [finished('parent', null, ['epic']), node('nested', 'parent', ['epic']), finished('nested.1', 'nested')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(ids(result.tasks), ['nested', 'nested.1']);
  assert.deepEqual(result.hiddenEpicIds, ['parent']);
  assert.deepEqual(result.hiddenIds, ['parent']);
  const graph = layout(result.tasks, []);
  assert.ok(graph.nodes.find(n => n.id === 'nested').isLaneHeader);
  assert.deepEqual(graph.groups.map(g => g.id), ['nested']);
});

test('the input array and its task objects are not mutated', () => {
  const tasks = deepFreeze([
    node('parent'), finished('nested', 'parent', ['epic']), finished('nested.1', 'nested'),
    finished('solo'), finished('other', null, ['epic']), finished('other.1', 'other'),
  ]);
  const before = JSON.parse(JSON.stringify(tasks));
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(tasks, before);
  assert.equal(tasks.length, 6);
  assert.notEqual(result.tasks, tasks);
  assert.deepEqual(ids(result.tasks), ['parent', 'solo']);
  assert.deepEqual(result.tasks[0].tags, ['epic'], 'the heading fix-up is applied to a copy');
  assert.notEqual(result.tasks[0], tasks[0]);
  assert.deepEqual(tasks[0].tags, []);
});

test('filtering already filtered tasks hides nothing more', () => {
  const tasks = [
    node('parent'), finished('nested', 'parent', ['epic']), finished('nested.1', 'nested'),
    finished('solo'), finished('other', null, ['epic']), finished('other.1', 'other'),
  ];
  const once = hideCompletedEpics(tasks);
  assert.deepEqual(ids(once.tasks), ['parent', 'solo']);
  assert.deepEqual(hideCompletedEpics(once.tasks), {tasks: once.tasks, hiddenEpicIds: [], hiddenIds: []});
});

test('dependencies on hidden tickets are dropped and the visible tickets close up', () => {
  const tasks = [finished('alpha', null, ['epic']), finished('alpha.1', 'alpha'), node('zeta', null, ['epic']), node('zeta.1', 'zeta')];
  const deps = [edge('alpha.1', 'zeta.1')];
  const unfiltered = layout(tasks, deps);
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(ids(result.tasks), ['zeta', 'zeta.1']);
  const filtered = layout(result.tasks, deps);
  const at = (graph, id) => graph.nodes.find(n => n.id === id);
  assert.deepEqual(unfiltered.edges, deps);
  assert.deepEqual(filtered.edges, []);
  assert.equal(at(unfiltered, 'zeta.1').rank, 1);
  assert.equal(at(filtered, 'zeta.1').rank, 0);
  assert.ok(at(filtered, 'zeta.1').x < at(unfiltered, 'zeta.1').x);
  assert.ok(at(filtered, 'zeta').y < at(unfiltered, 'zeta').y, 'rows close up where the hidden lane was');
  assert.ok(filtered.height < unfiltered.height);
  assert.deepEqual(filtered, layout(result.tasks, []), 'no trace of the dropped dependency remains');
});

test('an all-done graph hides every lane and the empty remainder still lays out', () => {
  const tasks = [finished('alpha', null, ['epic']), finished('alpha.1', 'alpha'), finished('beta', null, ['epic']), finished('beta.1', 'beta')];
  const deps = [edge('alpha.1', 'beta.1')];
  const result = hideCompletedEpics(tasks);
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.hiddenEpicIds, ['alpha', 'beta']);
  assert.deepEqual(result.hiddenIds, ['alpha', 'alpha.1', 'beta', 'beta.1']);
  const graph = layout(result.tasks, deps);
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.groups, []);
  assert.ok(Number.isFinite(graph.width) && graph.width > 0);
  assert.ok(Number.isFinite(graph.height) && graph.height > 0);
  assert.deepEqual(graph, layout([], []));
});

test('hidden ids are sorted and remaining tasks keep input order, whatever the input order', () => {
  const tasks = [
    finished('beta', null, ['epic']), finished('beta.1', 'beta'), node('open-1'),
    finished('alpha.2', 'alpha'), finished('alpha', null, ['epic']), finished('alpha.1', 'alpha'),
    node('gamma', null, ['epic']),
  ];
  const deps = [edge('alpha.1', 'open-1'), edge('open-1', 'gamma')];
  const forward = hideCompletedEpics(tasks);
  const backward = hideCompletedEpics([...tasks].reverse());
  for (const result of [forward, backward]) {
    assert.deepEqual(result.hiddenEpicIds, ['alpha', 'beta']);
    assert.deepEqual(result.hiddenIds, ['alpha', 'alpha.1', 'alpha.2', 'beta', 'beta.1']);
  }
  assert.deepEqual(ids(forward.tasks), ['open-1', 'gamma']);
  assert.deepEqual(ids(backward.tasks), ['gamma', 'open-1']);
  assert.deepEqual(layout(backward.tasks, deps), layout(forward.tasks, deps));
  assert.deepEqual(hideCompletedEpics(tasks), forward, 'the result is deterministic');
});
