import type { Database } from "bun:sqlite";

// Sidecar DDL. Bridge-owned, summaries only: no message content is ever stored here.
export const SCHEMA_VERSION = 1;

const DDL = `
create table if not exists meta(k text primary key, v text);
create table if not exists chats(
  key text primary key, origin text not null, kind text not null, session_id text not null,
  host_id text not null, host_name text not null, profile_id text, agent_id text,
  title text not null, cwd text, started_at int not null, last_activity_at int not null,
  message_count int not null, chatable int not null, src_id text not null, gone int not null default 0);
create index if not exists chats_activity on chats(gone, last_activity_at desc, key);
create index if not exists chats_kind on chats(gone, kind, last_activity_at desc, key);
create index if not exists chats_host on chats(gone, host_id, last_activity_at desc, key);
create index if not exists chats_src on chats(origin, src_id);
create virtual table if not exists chats_fts using fts5(title, cwd, content='chats', content_rowid='rowid', tokenize='trigram');
create trigger if not exists chats_ai after insert on chats begin
  insert into chats_fts(rowid, title, cwd) values (new.rowid, new.title, coalesce(new.cwd, ''));
end;
create trigger if not exists chats_ad after delete on chats begin
  insert into chats_fts(chats_fts, rowid, title, cwd) values ('delete', old.rowid, old.title, coalesce(old.cwd, ''));
end;
create trigger if not exists chats_au after update of title, cwd on chats begin
  insert into chats_fts(chats_fts, rowid, title, cwd) values ('delete', old.rowid, old.title, coalesce(old.cwd, ''));
  insert into chats_fts(rowid, title, cwd) values (new.rowid, new.title, coalesce(new.cwd, ''));
end;
`;

const DROP = `
drop trigger if exists chats_ai; drop trigger if exists chats_ad; drop trigger if exists chats_au;
drop table if exists chats_fts; drop table if exists chats; drop table if exists meta;
`;

/** Create or migrate. A schema change rebuilds the sidecar from the sources (it is a cache). */
export function migrate(db: Database): void {
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=1000;");
  let version: string | undefined;
  try { version = db.query<{ v: string }, []>("select v from meta where k='schema'").get()?.v; } catch { version = undefined; }
  if (version !== undefined && version !== String(SCHEMA_VERSION)) db.exec(DROP);
  db.exec(DDL);
  db.query("insert into meta(k, v) values ('schema', ?) on conflict(k) do update set v = excluded.v").run(String(SCHEMA_VERSION));
}
