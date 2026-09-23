async function initDatabase() {
  console.log("🔄 Database checking started...");

  /* =========================
     USERS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      token TEXT,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  /* =========================
     PRIVATE MESSAGES
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id SERIAL PRIMARY KEY,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  /* =========================
     FOLLOWS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follows (
      id SERIAL PRIMARY KEY,
      follower TEXT NOT NULL,
      following TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(follower, following)
    )
  `);

  /* =========================
     NOTIFICATIONS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      username TEXT,
      type TEXT,
      from_user TEXT,
      message TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  /* =========================
     BLOCKS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id SERIAL PRIMARY KEY,
      username TEXT,
      blocked_username TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(username, blocked_username)
    )
  `);

  /* =========================
     GIFTS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gifts (
      id SERIAL PRIMARY KEY,
      sender TEXT,
      receiver TEXT,
      gift TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  /* =====================================================
     DATABASE MIGRATIONS
     Kun table duraan jiru irratti columns dabala.
     Data duraan jiru hin haqu.
  ===================================================== */

  console.log("🔧 Running database migrations...");

  /* =========================
     USERS MIGRATION
  ========================= */

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS salt TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS token TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `);

  /* =========================
     PRIVATE MESSAGES MIGRATION
  ========================= */

  await pool.query(`
    ALTER TABLE private_messages
    ADD COLUMN IF NOT EXISTS sender TEXT
  `);

  await pool.query(`
    ALTER TABLE private_messages
    ADD COLUMN IF NOT EXISTS receiver TEXT
  `);

  await pool.query(`
    ALTER TABLE private_messages
    ADD COLUMN IF NOT EXISTS message TEXT
  `);

  await pool.query(`
    ALTER TABLE private_messages
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE private_messages
    ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE private_messages
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `);

  /* =========================
     FOLLOWS MIGRATION
  ========================= */

  await pool.query(`
    ALTER TABLE follows
    ADD COLUMN IF NOT EXISTS follower TEXT
  `);

  await pool.query(`
    ALTER TABLE follows
    ADD COLUMN IF NOT EXISTS following TEXT
  `);

  await pool.query(`
    ALTER TABLE follows
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `);

  /* =========================
     NOTIFICATIONS MIGRATION
  ========================= */

  await pool.query(`
    ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS username TEXT
  `);

  await pool.query(`
    ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS type TEXT
  `);

  await pool.query(`
    ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS from_user TEXT
  `);

  await pool.query(`
    ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS message TEXT
  `);

  await pool.query(`
    ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `);

  /* =========================
     BLOCKS MIGRATION
  ========================= */

  await pool.query(`
    ALTER TABLE blocks
    ADD COLUMN IF NOT EXISTS username TEXT
  `);

  await pool.query(`
    ALTER TABLE blocks
    ADD COLUMN IF NOT EXISTS blocked_username TEXT
  `);

  await pool.query(`
    ALTER TABLE blocks
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `);

  /* =========================
     GIFTS MIGRATION
  ========================= */

  await pool.query(`
    ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS sender TEXT
  `);

  await pool.query(`
    ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS receiver TEXT
  `);

  await pool.query(`
    ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS gift TEXT
  `);

  await pool.query(`
    ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `);

  /* =========================
     DEFAULT VALUES
     =========================
     Yoo columns haaraan NULL ta'an,
     application keenya akka hin cabsineef
     default/empty values kennina.
  ========================= */

  await pool.query(`
    UPDATE notifications
    SET username = COALESCE(username, '')
    WHERE username IS NULL
  `);

  await pool.query(`
    UPDATE notifications
    SET type = COALESCE(type, 'system')
    WHERE type IS NULL
  `);

  await pool.query(`
    UPDATE notifications
    SET is_read = COALESCE(is_read, FALSE)
    WHERE is_read IS NULL
  `);

  await pool.query(`
    UPDATE gifts
    SET sender = COALESCE(sender, '')
    WHERE sender IS NULL
  `);

  await pool.query(`
    UPDATE gifts
    SET receiver = COALESCE(receiver, '')
    WHERE receiver IS NULL
  `);

  await pool.query(`
    UPDATE gifts
    SET gift = COALESCE(gift, '')
    WHERE gift IS NULL
  `);

  await pool.query(`
    UPDATE private_messages
    SET is_read = COALESCE(is_read, FALSE)
    WHERE is_read IS NULL
  `);

  await pool.query(`
    UPDATE private_messages
    SET deleted = COALESCE(deleted, FALSE)
    WHERE deleted IS NULL
  `);

  console.log("✅ Database tables checked.");
  console.log("✅ Database migrations completed.");
    }
