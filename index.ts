import type {
  Adapter,
  DatabaseSession,
  DatabaseUser,
  RegisteredDatabaseSessionAttributes,
  RegisteredDatabaseUserAttributes,
} from "lucia";
import type { TableNames } from "./base";
import { Database } from "duckdb-async";

export class DuckDBAdapter implements Adapter {
  private escapedUserTableName: string;
  private escapedSessionTableName: string;
  private db: Database;

  constructor(db: Database, tableNames: TableNames) {
    this.db = db;
    this.escapedSessionTableName = escapeName(tableNames.session);
    this.escapedUserTableName = escapeName(tableNames.user);
  }

  async getSessionAndUser(
    sessionId: string
  ): Promise<[session: DatabaseSession | null, user: DatabaseUser | null]> {
    const [databaseSession, databaseUser] = await Promise.all([
      this.getSession(sessionId),
      this.getUserFromSessionId(sessionId),
    ]);
    return [databaseSession, databaseUser];
  }

  getUserSessions(userId: string): Promise<DatabaseSession[]> {
    throw new Error("Method not implemented.");
  }

  private async getSession(sessionId: string): Promise<DatabaseSession | null> {
    const result = (
      await this.db.all(
        `SELECT * FROM ${this.escapedSessionTableName} WHERE id = ?`,
        [sessionId]
      )
    )[0] as SessionSchema;
    if (!result) return null;
    return transformIntoDatabaseSession(result);
  }

  private async getUserFromSessionId(
    sessionId: string
  ): Promise<DatabaseUser | null> {
    const result = (
      await this.db.all(
        `SELECT ${this.escapedUserTableName}.* FROM ${this.escapedSessionTableName} INNER JOIN ${this.escapedUserTableName} ON ${this.escapedUserTableName}.id = ${this.escapedSessionTableName}.user_id WHERE ${this.escapedSessionTableName}.id = ?`,
        [sessionId]
      )
    )[0] as UserSchema;
    if (!result) return null;
    return transformIntoDatabaseUser(result);
  }

  setSession(databaseSession: DatabaseSession): Promise<void> {
    const value: SessionSchema = {
      id: databaseSession.id,
      user_id: databaseSession.userId,
      expires_at: Math.floor(databaseSession.expiresAt.getTime() / 1000),
      ...databaseSession.attributes,
    };
    const entries = Object.entries(value).filter(([_, v]) => v !== undefined);
    const columns = entries.map(([k]) => escapeName(k));
    const placeholders = Array(columns.length).fill("?");
    const values = entries.map(([_, v]) => v);
    return this.db.exec(
      `INSERT INTO ${this.escapedSessionTableName} (${columns.join(
        ", "
      )}) VALUES (${placeholders.join(", ")})`,
      values
    );
  }

  updateSessionExpiration(sessionId: string, expiresAt: Date): Promise<void> {
    return this.db.exec(
      `UPDATE ${this.escapedSessionTableName} SET expires_at = ? WHERE id = ?`,
      [Math.floor(expiresAt.getTime() / 1000), sessionId]
    );
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.db.exec(
      `DELETE FROM ${this.escapedSessionTableName} WHERE id = ?`,
      [sessionId]
    );
  }

  deleteUserSessions(userId: string): Promise<void> {
    return this.db.exec(
      `DELETE FROM ${this.escapedSessionTableName} WHERE user_id = ?`,
      [userId]
    );
  }

  deleteExpiredSessions(): Promise<void> {
    return this.db.exec(
      `DELETE FROM ${this.escapedSessionTableName} WHERE expires_at <= ?`,
      [Math.floor(Date.now() / 1000)]
    );
  }
}

interface SessionSchema extends RegisteredDatabaseSessionAttributes {
  id: string;
  user_id: string;
  expires_at: number;
}

interface UserSchema extends RegisteredDatabaseUserAttributes {
  id: string;
}

function transformIntoDatabaseSession(raw: SessionSchema): DatabaseSession {
  const { id, user_id: userId, expires_at: expiresAtUnix, ...attributes } = raw;
  return {
    userId,
    id,
    expiresAt: new Date(expiresAtUnix * 1000),
    attributes,
  };
}

function transformIntoDatabaseUser(raw: UserSchema): DatabaseUser {
  const { id, ...attributes } = raw;
  return {
    id,
    attributes,
  };
}

function escapeName(val: string): string {
  return "`" + val + "`";
}
