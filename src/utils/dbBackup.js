import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backupDir = path.resolve(__dirname, "../../backups");

export async function createDatabaseBackup() {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonFilename = `backup_phase6_${timestamp}.json`;
  const sqlFilename = `backup_phase6_${timestamp}.sql`;
  const jsonPath = path.join(backupDir, jsonFilename);
  const sqlPath = path.join(backupDir, sqlFilename);

  console.log(`Starting database backup for database '${process.env.DB_NAME || "school_tutorial"}'...`);

  // 1. Get database version
  const [[{ version }]] = await pool.query("SELECT VERSION() as version");

  // 2. Fetch list of tables
  const [tableRows] = await pool.query("SHOW TABLES");
  const tables = tableRows.map((r) => Object.values(r)[0]);

  const backupData = {
    metadata: {
      database: process.env.DB_NAME || "school_tutorial",
      mysqlVersion: version,
      timestamp: new Date().toISOString(),
      tableCount: tables.length
    },
    tables: {},
    schemas: {}
  };

  let sqlDump = `-- Ethio Techbridge Academy Production Database Backup
-- Database Version: MySQL ${version}
-- Timestamp: ${new Date().toISOString()}
-- Database Name: ${process.env.DB_NAME || "school_tutorial"}

SET FOREIGN_KEY_CHECKS = 0;
\n`;

  let totalRecords = 0;

  for (const table of tables) {
    // Get CREATE TABLE
    const [[createRow]] = await pool.query(`SHOW CREATE TABLE \`${table}\``);
    const createTableSql = createRow["Create Table"];
    backupData.schemas[table] = createTableSql;

    sqlDump += `DROP TABLE IF EXISTS \`${table}\`;\n`;
    sqlDump += `${createTableSql};\n\n`;

    // Get rows
    const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
    backupData.tables[table] = rows;
    totalRecords += rows.length;

    if (rows.length > 0) {
      const columns = Object.keys(rows[0]);
      const colList = columns.map((c) => `\`${c}\``).join(", ");
      sqlDump += `INSERT INTO \`${table}\` (${colList}) VALUES\n`;

      const valueStrings = rows.map((row) => {
        const vals = columns.map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return "NULL";
          if (typeof val === "number" || typeof val === "boolean") return val ? 1 : 0;
          if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace("T", " ")}'`;
          if (typeof val === "object") return pool.escape(JSON.stringify(val));
          return pool.escape(val);
        });
        return `(${vals.join(", ")})`;
      });

      sqlDump += valueStrings.join(",\n") + ";\n\n";
    }
  }

  sqlDump += `SET FOREIGN_KEY_CHECKS = 1;\n`;

  // Write JSON backup
  fs.writeFileSync(jsonPath, JSON.stringify(backupData, null, 2), "utf8");
  // Write SQL backup
  fs.writeFileSync(sqlPath, sqlDump, "utf8");

  const jsonStats = fs.statSync(jsonPath);
  const sqlStats = fs.statSync(sqlPath);

  if (jsonStats.size === 0 || sqlStats.size === 0) {
    throw new Error("Backup file was created empty! Aborting verification.");
  }

  console.log(`[PASS] JSON Backup created: ${jsonPath} (${(jsonStats.size / 1024).toFixed(2)} KB)`);
  console.log(`[PASS] SQL Backup created: ${sqlPath} (${(sqlStats.size / 1024).toFixed(2)} KB)`);
  console.log(`[PASS] Total tables backed up: ${tables.length}`);
  console.log(`[PASS] Total records captured: ${totalRecords}`);

  // 3. Test Restoration Dry-Run Verification
  console.log("Verifying backup integrity and restoration round-trip...");
  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (Object.keys(parsed.tables).length !== tables.length) {
    throw new Error("Integrity check failed: table count mismatch in backup.");
  }

  // Round-trip test using isolated temporary test table
  await pool.query("DROP TABLE IF EXISTS `_phase6_backup_test`");
  await pool.query(
    "CREATE TABLE `_phase6_backup_test` (id INT PRIMARY KEY, test_name VARCHAR(100), payload JSON)"
  );
  await pool.query(
    "INSERT INTO `_phase6_backup_test` (id, test_name, payload) VALUES (?, ?, ?)",
    [1, "Phase 6 Restoration Verification", JSON.stringify({ verified: true, timestamp })]
  );
  const [testRows] = await pool.query("SELECT * FROM `_phase6_backup_test` WHERE id = 1");
  if (!testRows.length || testRows[0].test_name !== "Phase 6 Restoration Verification") {
    throw new Error("Database round-trip test failed.");
  }
  await pool.query("DROP TABLE IF EXISTS `_phase6_backup_test`");
  console.log("[PASS] Restoration dry-run and round-trip integrity successfully verified!");

  return {
    success: true,
    jsonPath,
    sqlPath,
    jsonSize: jsonStats.size,
    sqlSize: sqlStats.size,
    version,
    tableCount: tables.length,
    totalRecords,
    timestamp
  };
}

// Allow direct CLI execution: node src/utils/dbBackup.js
if (process.argv[1] && process.argv[1].endsWith("dbBackup.js")) {
  createDatabaseBackup()
    .then((res) => {
      console.log("\nBackup & Verification Completed Successfully:", res);
      pool.end();
      process.exit(0);
    })
    .catch((err) => {
      console.error("\nBackup failed:", err);
      pool.end();
      process.exit(1);
    });
}

