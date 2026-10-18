// node src/poem.test.js
import assert from 'node:assert/strict'
import { paginate, LINES_PER_PAGE } from './poem.js'

assert.equal(paginate('a\nb').length, 1)
assert.equal(paginate('a\n---\nb').length, 2)
assert.deepEqual(paginate('a\n\n---\n\nb')[1], [{ s: 'b' }])
assert.equal(paginate(Array(LINES_PER_PAGE * 2 + 1).fill('x').join('\n')).length, 3)
// title only with "# ", only on the first page
assert.deepEqual(paginate('# Titolo\nverso\n---\naltro'), [[{ s: 'Titolo', title: true }, { s: '' }, { s: 'verso' }], [{ s: 'altro' }]])
assert.ok(!paginate('Primo verso\nsecondo')[0][0].title)
// a long prose line wraps to several rows without losing words
const prose = Array(60).fill('parola').join(' ')
const rows = paginate(prose)[0]
assert.ok(rows.length > 1)
assert.equal(rows.map((r) => r.s).join(' '), prose)
console.log('ok, lines per page:', LINES_PER_PAGE)
