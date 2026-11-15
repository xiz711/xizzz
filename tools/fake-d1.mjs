/**
 * D1 模拟层 —— 用 node:sqlite 实现 Cloudflare D1 的接口，供本地测试使用。
 *
 * D1 的 API 是异步的（prepare/bind/first/all/run 都返回 Promise），
 * 这里用同步的 node:sqlite 包一层 Promise，使 worker/api.js 的**真实代码**
 * 可以在本地被完整测试，而不需要安装 wrangler。
 *
 * 只实现 api.js 用到的那部分：prepare().bind().first()/all()/run()、exec()。
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

class Stmt {
  constructor(stmt) { this._s = stmt; this._args = []; }
  bind(...args) { this._args = args; return this; }
  async first() { return this._s.get(...this._args) ?? null; }
  async all() { return { results: this._s.all(...this._args), success: true }; }
  async run() {
    const info = this._s.run(...this._args);
    return {
      success: true,
      meta: {
        changes: Number(info.changes ?? 0),
        last_row_id: Number(info.lastInsertRowid ?? 0),
      },
    };
  }
}

export class FakeD1 {
  constructor(schemaPath) {
    this.db = new DatabaseSync(':memory:');
    if (schemaPath) this.db.exec(fs.readFileSync(schemaPath, 'utf8'));
  }
  prepare(sql) { return new Stmt(this.db.prepare(sql)); }
  async exec(sql) { this.db.exec(sql); return { count: 0, duration: 0 }; }
  close() { this.db.close(); }
}
